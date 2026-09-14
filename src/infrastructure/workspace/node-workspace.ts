import { open, opendir, realpath, stat } from "node:fs/promises";
import * as path from "node:path";
import { TextDecoder } from "node:util";
import type {
    Workspace,
    WorkspaceDirectory,
    WorkspaceEntry,
    WorkspaceTextFile,
} from "../../core/workspace/workspace.js";
import {
    WorkspaceError,
    type WorkspaceErrorCode,
} from "../../core/workspace/workspace-error.js";
import type {
    SearchWorkspace,
    WorkspaceGlobRequest,
    WorkspaceGlobResult,
    WorkspaceTextMatch,
    WorkspaceTextSearchRequest,
    WorkspaceTextSearchResult,
} from "../../core/workspace/workspace-search.js";

import {
    runRipgrepDelimited,
    type RipgrepRunResult,
} from "./ripgrep-runner.js";
import {
    matchesWorkspaceGlob,
} from "./workspace-glob-matcher.js";
// 单文件读取上限256 KB
export const MAX_FILE_BYTES = 256 * 1024;
// 单次列目录上限200项目
export const MAX_DIRECTORY_ENTRIES = 200;
// 限制一次搜索最多返回1000条结果
export const MAX_SEARCH_RESULTS =
    1_000;
// 限制一次搜索结果最多返回1200字符
export const MAX_SEARCH_LINE_CHARS =
    1_200;
export class NodeWorkspace implements Workspace,SearchWorkspace {
    // 构造方法声明为私有
    private constructor(public readonly root: string) {}
    // 工厂方法：产生一个NodeWorkSpace
    public static async create(
        root: string,
        signal: AbortSignal,
    ): Promise<NodeWorkspace> {
        return withFsErrors(signal, async () => {
            const canonicalRoot = await realpath(path.resolve(root));

            if (!(await stat(canonicalRoot)).isDirectory()) {
                throw new WorkspaceError(
                    "not_directory",
                    "Workspace root must be a directory",
                );
            }

            return new NodeWorkspace(canonicalRoot);
        });
    }

    /**
     * 读取文本文件
     * @param input
     * @param signal
     */
    public async readTextFile(
        input: string,
        signal: AbortSignal,
    ): Promise<WorkspaceTextFile> {
        return withFsErrors(signal, async () => {
            // 先解析路径
            const target = await this.resolveExistingPath(input);
            // 判断是否是普通文件
            if (!(await stat(target)).isFile()) {
                throw new WorkspaceError(
                    "not_file",
                    "Path must be a regular file",
                );
            }

            signal.throwIfAborted();
            // 以只读方式打开这个文件
            const handle = await open(target, "r");

            try {
                // 再次检查是否是文件，防止第一次stat到真正的open之间，其他进程把文件替换为软链接、超大文件
                const metadata = await handle.stat();

                if (!metadata.isFile()) {
                    throw new WorkspaceError(
                        "not_file",
                        "Path must be a regular file",
                    );
                }
                // 如果文件大小超过限额最大长度
                if (metadata.size > MAX_FILE_BYTES) {
                    throw fileTooLarge();
                }

                // 多分配一个字节，作用是继续检查stat之后文件继续增长的情况
                const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
                let length = 0;

                while (length < buffer.length) {
                    signal.throwIfAborted();

                    const { bytesRead } = await handle.read(
                        buffer,
                        length,
                        // 每次读的块的大小是64kb，如果剩下的buffer空间不足64kb就把剩下的buffer空间读满
                        Math.min(64 * 1024, buffer.length - length),
                        length,
                    );

                    if (bytesRead === 0) {
                        break;
                    }

                    length += bytesRead;
                }

                signal.throwIfAborted();
                // 全部读完之后，再次判断，是否超出文件大小的限制
                if (length > MAX_FILE_BYTES) {
                    throw fileTooLarge();
                }
                // 创建Buffer视图
                const bytes = buffer.subarray(0, length);
                // NULL字节检测：文本文件几乎不含有\0，而二进制文件这种几乎必然含有\0，这是廉价的二进制检查
                if (bytes.includes(0)) {
                    throw new WorkspaceError(
                        "binary_file",
                        "File contains NUL bytes; only UTF-8 text is supported",
                    );
                }

                let content: string;

                try {

                    content = new TextDecoder("utf-8", {
                        fatal: true,// 遇到非法UTF-8序列的时候报错，保证读入的内容是可信文本
                        ignoreBOM: false,// 忽略BOM
                    }).decode(bytes);
                } catch (error) {
                    if (!(error instanceof TypeError)) {
                        throw error;
                    }

                    throw new WorkspaceError(
                        "invalid_encoding",
                        "File is not valid UTF-8 text",
                    );
                }
                // 检测不应该出现在正常文本中的控制字符，有些“伪文本”不含\0但是含大量其他控制符
                if (
                    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(content)
                ) {
                    throw new WorkspaceError(
                        "binary_file",
                        "File contains unsupported control characters",
                    );
                }

                return {
                    path: this.relativePath(target),// 相对于工作区的路径
                    content,
                    byteLength: length,// 实际的字节数
                };
            } finally {
                await handle.close();
            }
        });
    }

    /**
     * 安全列出目录
     * @param input
     * @param signal
     */
    public async listDirectory(
        input: string,
        signal: AbortSignal,
    ): Promise<WorkspaceDirectory> {
        return withFsErrors(signal, async () => {
            // 解析路径
            const target = await this.resolveExistingPath(input);
            // 验证是否是目录
            if (!(await stat(target)).isDirectory()) {
                throw new WorkspaceError(
                    "not_directory",
                    "Path must be a directory",
                );
            }

            signal.throwIfAborted();
            // readdir会一次性把所有条目读进内存，而opendir返回一个异步迭代器
            const directory = await opendir(target);
            const entries: WorkspaceEntry[] = [];
            let truncated = false;

            // 异步迭代器在结束、break 或抛错时关闭目录。
            for await (const entry of directory) {
                signal.throwIfAborted();
                // 当列出的目录数量已经达到最大目录数量限额
                if (entries.length === MAX_DIRECTORY_ENTRIES) {
                    truncated = true;
                    break;
                }
                // 将当前的entry放入
                entries.push({
                    name: entry.name,
                    // symlink也算是directory或file，因此先判断symlink
                    kind: entry.isSymbolicLink() ? "symlink"
                        : entry.isDirectory() ? "directory"
                            : entry.isFile() ? "file"
                                : "other",
                });
            }
            // 按字典序排序
            entries.sort(
                (a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
            );

            return {
                path: this.relativePath(target),
                entries,
                truncated,
            };
        });
    }

    /**
     * 负责路径合法性和越界保护，并给出最后的解析路径
     * @param input
     * @private
     */
    private async resolveExistingPath(input: string): Promise<string> {
        // 快速拒绝明确非法输入
        if (
            input.length === 0 || // 输入为0
            /^[\\/]/u.test(input) || // 绝对路径
            /[<>:"|?*\u0000-\u001f]/u.test(input)  // 路径中有保留字符和控制字符
        ) {
            throw new WorkspaceError(
                "invalid_path",
                "Use a workspace-relative path without drive letters or special characters",
            );
        }
        //逐段校验目录片段
        const segments = input.split(/[\\/]/u);

        for (const segment of segments) {
            if (
                segment === "." ||
                segment === ".." ||
                segment === ""
            ) {
                continue;
            }

            if (
                /[. ]$/u.test(segment) || // Windows不允许文件名以点或空格结尾
                /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(segment)
            ) {
                throw new WorkspaceError(
                    "invalid_path",
                    "Path contains an unsupported Windows filename",
                );
            }
        }
        //拼接并按字符串层面检查越界
        const candidate = path.resolve(this.root, ...segments);
        this.assertInside(candidate);

        // realpath 会解析目录链接与符号链接，再检查一次真实位置，防止软链接越界
        const canonical = await realpath(candidate);
        this.assertInside(canonical);

        return canonical;
    }

    /**
     * 确保路径没有越界
     * @param target
     * @private
     */
    private assertInside(target: string): void {
        // 计算workspace到目标的相对路径
        const relative = path.relative(this.root, target);

        if (
            relative === ".." ||
            relative.startsWith(`..${path.sep}`) || // 如果以..或者../开头说明目标在跟的上级，越界
            path.isAbsolute(relative)// 如果relative是绝对路径，说明不在同一个挂载上，也算越界
        ) {
            throw new WorkspaceError(
                "outside_workspace",
                "Path resolves outside the workspace",
            );
        }
    }

    /**
     * 输出归一化
     * @param target
     * @private
     */
    private relativePath(target: string): string {
        // 将要给LLM 看的绝对路径转为相对于workspace的相对路径，而是去POSIX风格
        return path.relative(this.root, target)
            .split(path.sep)
            .join("/") || ".";
    }

    public async globFiles(
        request: WorkspaceGlobRequest,
        signal: AbortSignal,
    ): Promise<WorkspaceGlobResult> {
        return withFsErrors(
            signal,
            async () => {
                // 校验
                validateSearchLimit(
                    request.maxResults,
                );
                // 规划化glob pattern
                const pattern =
                    normalizeGlobPattern(
                        request.pattern,
                    );
                // 解析真实的路径
                const target =
                    await this
                        .resolveExistingPath(
                            request.basePath,
                        );
                // 对应路径不是目录，直接抛错
                if (
                    !(
                        await stat(
                            target,
                        )
                    ).isDirectory()
                ) {
                    throw new WorkspaceError(
                        "not_directory",
                        "Search base path must be a directory",
                    );
                }
                // 获得相对于workspace的相对路径
                const basePath =
                    this.relativePath(
                        target,
                    );
                // 文件结果集合
                const paths:
                    string[] = [];

                let sawAdditionalMatch =
                    false;

                const result =
                    await runSearch(
                        {
                            cwd:
                            this.root,

                            args: [
                                // --glob pattern将pattern绑定到ripgrep的glob方言
                                "--files",// 文件遍历，ripgrep只复制高速遍历文件，而pattern语义由node自己控制

                                "--hidden",// 搜索隐藏文件

                                ...ripgrepDirectoryExcludes(),

                                "--sort",
                                "path", // 按路径排序

                                "--null",// 文件路径之间通过\0分割，因为合法文件名中经可能存在换行符，所以不使用换行符作为分割

                                "--",

                                basePath,
                            ],

                            delimiter:
                                "\0",

                            signal,

                            onRecord:
                                (
                                    record,
                                ) => {
                                    // 规范化路径
                                    const workspacePath =
                                        normalizeSearchPath(
                                            record,
                                        );
                                    //
                                    const candidate =
                                        relativeToBase(
                                            workspacePath,
                                            basePath,
                                        );
                                    // 是否匹配
                                    let matched:
                                        boolean;

                                    try {
                                        //判断候选文件是否符合pattern,
                                        matched =
                                            matchesWorkspaceGlob(
                                                candidate,
                                                pattern,
                                            );
                                    } catch (
                                        error
                                        ) {
                                        throw new WorkspaceError(
                                            "invalid_pattern",
                                            getErrorMessage(
                                                error,
                                            ),
                                        );
                                    }

                                    if (
                                        !matched
                                    ) {
                                        return true;
                                    }

                                    if (
                                        paths.length <
                                        request.maxResults
                                    ) {
                                        paths.push(
                                            workspacePath,
                                        );

                                        return true;
                                    }
                                    //确认至少还有一条结果，但不需要继续搜索了
                                    sawAdditionalMatch =
                                        true;

                                    return false;
                                },
                        },
                        signal,
                    );

                assertSearchExit(
                    result,
                    "glob",
                    false,
                );

                return {
                    basePath,

                    pattern,

                    paths,

                    truncated:
                        sawAdditionalMatch ||
                        result
                            .terminatedEarly,
                };
            },
        );
    }
    public async searchText(
        request:
        WorkspaceTextSearchRequest,
        signal: AbortSignal,
    ): Promise<WorkspaceTextSearchResult> {
        return withFsErrors(
            signal,
            async () => {
                // 限制搜索长度
                validateSearchLimit(
                    request.maxResults,
                );
                // 限制query的长度
                if (
                    request.query.length ===
                    0 ||
                    request.query.length >
                    4_096
                ) {
                    throw new WorkspaceError(
                        "invalid_pattern",
                        "Search query must contain between 1 and 4096 characters",
                    );
                }
                // 解析真实路径
                const target =
                    await this
                        .resolveExistingPath(
                            request.basePath,
                        );
                // 判断真实路径是不是目录
                if (
                    !(
                        await stat(
                            target,
                        )
                    ).isDirectory()
                ) {
                    throw new WorkspaceError(
                        "not_directory",
                        "Search base path must be a directory",
                    );
                }
                // 获得到worksapce的相对路径
                const basePath =
                    this.relativePath(
                        target,
                    );

                const matches:
                    WorkspaceTextMatch[] =
                    [];

                let sawAdditionalMatch =
                    false;

                const args:
                    string[] =
                    [
                        "--json",// 转为json结构化

                        "--hidden",// 查询隐藏文件

                        ...ripgrepDirectoryExcludes(),// 排除的目录

                        "--sort",// 根据路径排序
                        "path",

                        "--max-columns",// 某个 minified JS 一行 500 KB
                        String(
                            MAX_SEARCH_LINE_CHARS,
                        ),

                        "--max-columns-preview",

                        "--max-filesize",// 不搜索大于MAX_FILE_BYTE的文件
                        String(
                            MAX_FILE_BYTES,
                        ),

                        request.caseSensitive
                            ? "--case-sensitive"
                            : "--ignore-case",
                    ];
                // 如果模式的literal
                if (
                    request.mode ===
                    "literal"
                ) {
                    args.push(
                        "--fixed-strings",
                    );
                }
                // 防止shell注入，将request.query只理解为搜索字符串
                args.push(
                    "--",
                    request.query,
                    basePath,
                );

                const result =
                    await runSearch(
                        {
                            cwd:
                            this.root,

                            args,

                            delimiter:
                                "\n",

                            signal,

                            onRecord:
                                (
                                    record,
                                ) => {
                                    const match =
                                        parseRipgrepMatch(
                                            record,
                                        );

                                    if (
                                        match ===
                                        null
                                    ) {
                                        return true;
                                    }
                                    //如果matches的长度合法，直接放入matches数组
                                    if (
                                        matches.length <
                                        request.maxResults
                                    ) {
                                        matches.push(
                                            match,
                                        );

                                        return true;
                                    }

                                    sawAdditionalMatch =
                                        true;

                                    return false;
                                },
                        },
                        signal,
                    );

                assertSearchExit(
                    result,

                    "grep",

                    request.mode ===
                    "regex",
                );

                return {
                    basePath,

                    query:
                    request.query,

                    mode:
                    request.mode,

                    caseSensitive:
                    request
                        .caseSensitive,

                    matches,

                    truncated:
                        sawAdditionalMatch ||
                        result
                            .terminatedEarly,
                };
            },
        );
    }
}

function fileTooLarge(): WorkspaceError {
    return new WorkspaceError(
        "file_too_large",
        `File exceeds the ${MAX_FILE_BYTES}-byte read limit`,
    );
}

/**
 * 错误归一化与取消传播
 * @param signal
 * @param operation
 */
async function withFsErrors<T>(
    signal: AbortSignal,
    operation: () => Promise<T>,
): Promise<T> {
    signal.throwIfAborted();

    try {
        const result = await operation();
        signal.throwIfAborted();
        return result;
    } catch (error) {
        signal.throwIfAborted();

        if (error instanceof WorkspaceError) {
            throw error;
        }

        const code =
            error instanceof Error && "code" in error
                ? error.code
                : undefined;

        let mapped: WorkspaceErrorCode;

        switch (code) {
            case "ENOENT":
                mapped = "not_found";
                break;
            case "ENOTDIR":
                mapped = "not_directory";
                break;
            case "EISDIR":
                mapped = "not_file";
                break;
            case "EACCES":
            case "EPERM":
                mapped = "permission_denied";
                break;
            case "ELOOP":
                mapped = "invalid_path";
                break;
            case "EIO":
            case "EBUSY":
            case "EMFILE":
            case "ENFILE":
                mapped = "io_error";
                break;
            default:
                throw error;
        }

        throw new WorkspaceError(
            mapped,
            `Filesystem operation failed: ${code}`,
        );
    }

}

/**
 * 将用户输入的glob转为一个受控、安全、平台无关的相对glob
 * @param input
 */
function normalizeGlobPattern(
    input: string,
): string {
    const pattern =
        // 去除两端空格，且将格式同一为POSIX风格的/
        input
            .trim()
            .replaceAll(
                "\\",
                "/",
            );
    // 禁止以下的glob
    if (
        pattern.length === 0 || // 防止空pattern
        pattern.length > 4096 || // 防止超长pattern
        pattern.startsWith( //禁止绝对路径
            "/",
        ) ||
        /^[a-z]:/iu.test(// 禁止 Windows drive path
            pattern,
        ) ||
        pattern.startsWith(// 只接受正向匹配
            "!",
        ) ||
        /[\u0000-\u001f]/u.test(
            pattern,
        )
    ) {
        throw new WorkspaceError(
            "invalid_pattern",
            "Glob must be a relative positive pattern",
        );
    }

    const segments =
        pattern.split("/");

    if (
        segments.includes("..")
    ) {
        throw new WorkspaceError(
            "invalid_pattern",
            "Glob cannot contain parent traversal",
        );
    }

    return pattern;
}

/**
 * 将ripgrep的一行JSON输出转换为内部的WorkspaceTextMatch
 * @param record
 */
function parseRipgrepMatch(
    record: string,
): WorkspaceTextMatch | null {
    let value:
        unknown;

    try {
        value =
            JSON.parse(
                record,
            );
    } catch {
        throw new WorkspaceError(
            "search_failed",
            "Search backend returned invalid JSON",
        );
    }

    if (
        typeof value !==
        "object" ||
        value === null ||
        !("type" in value) ||
        value.type !== "match" ||
        !("data" in value)
    ) {
        return null;
    }

    const data =
        value.data;

    if (
        typeof data !==
        "object" ||
        data === null ||
        !("path" in data) ||
        !("lines" in data) ||
        !("line_number" in data)
    ) {
        return null;
    }

    const sourcePath =
        decodeRipgrepText(
            data.path,
        );

    const lineText =
        decodeRipgrepText(
            data.lines,
        );

    const lineNumber =
        data.line_number;

    if (
        sourcePath === null ||
        lineText === null ||
        typeof lineNumber !==
        "number"
    ) {
        return null;
    }

    const normalizedLine =
        lineText.replace(
            /\r?\n$/u,
            "",
        );

    const truncated =
        normalizedLine.length >
        MAX_SEARCH_LINE_CHARS;

    return {
        path:
            normalizeSearchPath(
                sourcePath,
            ),

        line:
        lineNumber,

        text:
            truncated
                ? normalizedLine
                    .slice(
                        0,
                        MAX_SEARCH_LINE_CHARS,
                    )
                : normalizedLine,

        textTruncated:
        truncated,
    };
}

function decodeRipgrepText(
    value: unknown,
): string | null {
    if (
        typeof value !==
        "object" ||
        value === null
    ) {
        return null;
    }

    if (
        "text" in value &&
        typeof value.text ===
        "string"
    ) {
        return value.text;
    }

    if (
        "bytes" in value &&
        typeof value.bytes ===
        "string"
    ) {
        return Buffer
            .from(
                value.bytes,
                "base64",
            )
            .toString(
                "utf8",
            );
    }

    return null;
}

/**
 * 返回要排除的文件
 */
function ripgrepDirectoryExcludes():
    string[] {
    return [
        "--glob",
        "!.git/",

        "--glob",
        "!**/.git/",

        "--glob",
        "!node_modules/",

        "--glob",
        "!**/node_modules/",
    ];
}

/**
 * 规范化搜索路径：
 * 1. 将路径风格转为POSIX风格
 * 2. 去除多余的./
 * @param input
 */
function normalizeSearchPath(
    input: string,
): string {
    return input
        .replaceAll(
            "\\",
            "/",
        )
        .replace(
            /^\.\//u,
            "",
        );
}

function relativeToBase(
    workspacePath: string,
    basePath: string,
): string {
    if (
        basePath === "."
    ) {
        return workspacePath;
    }

    if (
        workspacePath ===
        basePath
    ) {
        return ".";
    }

    const prefix =
        `${basePath}/`;

    if (
        !workspacePath.startsWith(
            prefix,
        )
    ) {
        throw new WorkspaceError(
            "search_failed",
            "Search backend returned a path outside the requested base",
        );
    }

    return workspacePath.slice(
        prefix.length,
    );
}

/**
 * 限制value是一个整数，而且数值在(0,MAX_SEARCH_RESULTS]
 * @param value
 */
function validateSearchLimit(
    value: number,
): void {
    if (
        !Number.isSafeInteger(
            value,
        ) ||
        value <= 0 ||
        value >
        MAX_SEARCH_RESULTS
    ) {
        throw new WorkspaceError(
            "invalid_range",
            `Search result limit must be between 1 and ${MAX_SEARCH_RESULTS}`,
        );
    }
}
function assertSearchExit(
    result: RipgrepRunResult,
    operation: string,
    regexSearch: boolean,
): void {
    if (
        result.terminatedEarly
    ) {
        return;
    }

    if (
        result.exitCode === 0 ||
        result.exitCode === 1
    ) {
        return;
    }

    const message =
        result.stderr
            .trim()
            .slice(
                0,
                2_000,
            );

    const looksLikeRegexError =
        regexSearch &&
        /regex|pattern parse|PCRE/iu.test(
            message,
        );

    throw new WorkspaceError(
        looksLikeRegexError
            ? "invalid_pattern"
            : "search_failed",

        message.length === 0
            ? `${operation} search failed`
            : message,
    );
}
async function runSearch(
    options:
    Parameters<
        typeof runRipgrepDelimited
    >[0],

    signal: AbortSignal,
): Promise<RipgrepRunResult> {
    try {
        return await
            runRipgrepDelimited(
                options,
            );
    } catch (error) {
        signal.throwIfAborted();

        if (
            error instanceof
            WorkspaceError
        ) {
            throw error;
        }

        throw new WorkspaceError(
            "search_failed",
            `Search backend failed: ${getErrorMessage(
                error,
            )}`,
        );
    }
}

function getErrorMessage(
    error: unknown,
): string {
    return error instanceof Error
        ? error.message
        : String(error);
}