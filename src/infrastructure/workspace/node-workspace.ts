import {
    open,
    opendir,
    realpath,
    rename,
    stat,
    unlink,
} from "node:fs/promises";
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
import {
    createHash,
    randomUUID,
} from "node:crypto";

import type {
    EditableWorkspace,
    WorkspaceCreateTextFileRequest,
    WorkspaceCreateTextFileResult,
    WorkspaceReplaceTextRequest,
    WorkspaceReplaceTextResult,
} from "../../core/workspace/workspace-edit.js";

import {
    applyExactTextEdit,
} from "../../core/edit/exact-text-edit.js";
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

interface NodeTextDocument {
    readonly content: string;

    readonly bytes:
        Buffer;

    readonly byteLength:
        number;

    readonly revision:
        string;

    readonly hasUtf8Bom:
        boolean;

    readonly mode:
        number;
}

export class NodeWorkspace implements Workspace,SearchWorkspace,EditableWorkspace {
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
    private async resolveCreatableFilePath(
        input: string,
    ): Promise<string> {
        // 返回合法的路径segments
        const segments =
            this.validatePathSegments(
                input,
            );
        // 解析路径
        const candidate =
            path.resolve(
                this.root,
                ...segments,
            );
        // 确保路径在workspace中
        this.assertInside(
            candidate,
        );

        if (
            candidate ===
            this.root
        ) {
            throw new WorkspaceError(
                "invalid_path",
                "File path cannot refer to the workspace root",
            );
        }
        // 获取父目录
        const parentCandidate =
            path.dirname(
                candidate,
            );
        // 解析父目录的真实路径
        const parent =
            await realpath(
                parentCandidate,
            );
        // 校验父目录是否在workspace内
        this.assertInside(
            parent,
        );
        // 判断父目录是否真的是一个目录
        if (
            !(
                await stat(
                    parent,
                )
            ).isDirectory()
        ) {
            throw new WorkspaceError(
                "not_directory",
                "Parent path must be a directory",
            );
        }
        // 返回创建路径
        return path.join(
            parent,

            path.basename(
                candidate,
            ),
        );
    }
    private async readTextDocument(
        target: string,
        signal: AbortSignal,
    ): Promise<NodeTextDocument> {
        signal.throwIfAborted();

        // 以只读方式打开文件。
        const handle =
            await open(
                target,
                "r",
            );

        try {
            // 对“真正已经打开的文件对象”再次读取元数据，
            // 确保最终打开的是普通文件。
            // 这样可以避免仅依赖 open 之前的路径检查所产生的 TOCTOU 问题。
            const metadata =
                await handle.stat();

            // 只允许读取普通文件。
            if (
                !metadata.isFile()
            ) {
                throw new WorkspaceError(
                    "not_file",
                    "Path must be a regular file",
                );
            }

            // 如果 stat 时文件已经超过允许的最大大小，
            // 直接拒绝读取，避免不必要的内存分配和 I/O。
            if (
                metadata.size >
                MAX_FILE_BYTES
            ) {
                throw fileTooLarge();
            }

            // 多分配 1 个字节。
            //
            // 这样即使文件在 stat 之后继续增长，
            // 也可以通过实际读取到 MAX_FILE_BYTES + 1 个字节
            // 判断文件已经超过大小限制。
            const buffer =
                Buffer.alloc(
                    MAX_FILE_BYTES +
                    1,
                );

            let length = 0;

            while (
                length <
                buffer.length
                ) {
                signal
                    .throwIfAborted();

                const {
                    bytesRead,
                } =
                    await handle.read(
                        buffer,

                        length,

                        // 每次最多读取 64 KiB。
                        // 如果 buffer 剩余空间不足 64 KiB，
                        // 就只读取剩余空间大小。
                        Math.min(
                            64 * 1024,
                            buffer.length -
                            length,
                        ),

                        length,
                    );

                // bytesRead === 0 表示已经到达 EOF。
                if (
                    bytesRead === 0
                ) {
                    break;
                }

                length +=
                    bytesRead;
            }

            signal
                .throwIfAborted();

            // 实际读取完成后再次检查大小。
            //
            // 这一步用于处理文件在 stat 之后继续增长的情况。
            // 因为 buffer 比限制多 1 字节，所以只要读到超过上限，
            // 就能够可靠检测出来。
            if (
                length >
                MAX_FILE_BYTES
            ) {
                throw fileTooLarge();
            }

            // 截取真正读取到的有效字节，并复制成一个独立 Buffer。
            //
            // Buffer.subarray() 本身只是原始大 Buffer 的视图，
            // Buffer.from() 会创建独立副本，避免返回的 bytes
            // 长期引用 MAX_FILE_BYTES + 1 大小的底层缓冲区。
            const bytes =
                Buffer.from(
                    buffer.subarray(
                        0,
                        length,
                    ),
                );

            // NUL 字节检测。
            //
            // 普通 UTF-8 文本通常不会包含 \0，
            // 而很多二进制文件中会出现 NUL 字节。
            // 这是一个非常廉价的二进制文件初步检查。
            if (
                bytes.includes(0)
            ) {
                throw new WorkspaceError(
                    "binary_file",
                    "File contains NUL bytes; only UTF-8 text is supported",
                );
            }

            let content:
                string;

            try {
                content =
                    new TextDecoder(
                        "utf-8",
                        {
                            // 遇到非法 UTF-8 字节序列时直接抛错，
                            // 保证后续处理的 content 一定是有效 UTF-8 文本。
                            fatal:
                                true,

                            // 识别 UTF-8 BOM。
                            // BOM 不会作为正文中的 U+FEFF 返回。
                            ignoreBOM:
                                false,
                        },
                    ).decode(
                        bytes,
                    );
            } catch (error) {
                // TextDecoder 在 fatal 模式下遇到非法 UTF-8
                // 通常会抛出 TypeError。
                if (
                    !(
                        error instanceof
                        TypeError
                    )
                ) {
                    throw error;
                }

                throw new WorkspaceError(
                    "invalid_encoding",
                    "File is not valid UTF-8 text",
                );
            }

            // 检测通常不应该出现在普通文本中的 C0 控制字符。
            //
            // 某些“伪文本”文件可能不包含 NUL，
            // 但仍然含有大量其他二进制控制字符。
            //
            // 这里允许常见文本控制字符：
            // \t  U+0009
            // \n  U+000A
            // \r  U+000D
            if (
                /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u
                    .test(
                        content,
                    )
            ) {
                throw new WorkspaceError(
                    "binary_file",
                    "File contains unsupported control characters",
                );
            }

            return {
                // 解码后的 UTF-8 文本内容。
                content,

                // 文件原始字节。
                // 后续可用于 revision、BOM 检测以及安全写回。
                bytes,

                // 文件实际字节长度。
                byteLength:
                bytes.length,

                // 根据当前原始字节生成内容版本标识。
                // 后续写入时可用于检测文件是否已经被其他操作修改。
                revision:
                    createWorkspaceRevision(
                        bytes,
                    ),

                // 记录原文件是否包含 UTF-8 BOM，
                // 方便写回文件时保留原始 BOM 风格。
                hasUtf8Bom:
                    hasUtf8Bom(
                        bytes,
                    ),

                // 保存文件原始 mode，
                // 后续写回或原子替换文件时可用于保留权限等元数据。
                mode:
                metadata.mode,
            };
        } finally {
            // 无论读取成功还是中途抛错，都确保文件描述符被关闭。
            await handle.close();
        }
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
        return withFsErrors(
            signal,

            async () => {
                const target =
                    await this
                        .resolveExistingPath(
                            input,
                        );

                const document =
                    await this
                        .readTextDocument(
                            target,
                            signal,
                        );

                return {
                    path:
                        this.relativePath(
                            target,
                        ),

                    content:
                    document.content,

                    byteLength:
                    document
                        .byteLength,

                    revision:
                    document
                        .revision,
                };
            },
        );
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
     * 在一个可能被并发修改、需要保证文件一致性、需要处理文件系统异常的环境中，完全地完成一次文本替换
     * @param request
     * @param signal
     */
    public async replaceText(
        request:
        WorkspaceReplaceTextRequest,

        signal:
        AbortSignal,
    ): Promise<WorkspaceReplaceTextResult> {
        return withFsErrors(
            signal,

            async () => {
                // 解析文件真实路径
                const target =
                    await this
                        .resolveExistingPath(
                            request.path,
                        );
                // 读取当前文件
                const current =
                    await this
                        .readTextDocument(
                            target,
                            signal,
                        );
                // 乐观并发控制
                if (
                    current.revision !==
                    request
                        .expectedRevision
                ) {
                    throw staleRevision(
                        request
                            .expectedRevision,

                        current.revision,
                    );
                }
                // 执行精确文本替换
                const edited =
                    applyExactTextEdit(
                        current.content,

                        request.oldText,

                        request.newText,
                    );
                // 修改失败
                if (!edited.ok) {
                    throw new WorkspaceError(
                        "conflict",

                        edited.reason ===
                        "not_found"
                            ? "oldText was not found in the expected file version"
                            : "oldText is not unique in the expected file version",

                        {
                            reason:
                            edited.reason,

                            currentRevision:
                            current
                                .revision,
                        },
                    );
                }
                // 内容实际上未改变，即newText==oldText
                if (
                    !edited.changed
                ) {
                    return {
                        path:
                            this.relativePath(
                                target,
                            ),

                        previousRevision:
                        current
                            .revision,

                        revision:
                        current
                            .revision,

                        byteLength:
                        current
                            .byteLength,

                        changed:
                            false,
                    };
                }
                // 重新编码，如果原本有BOM，重新编码BOM
                const nextBytes =
                    encodeTextDocument(
                        edited.content,

                        current
                            .hasUtf8Bom,
                    );
                // 限制文件大小
                if (
                    nextBytes.length >
                    MAX_FILE_BYTES
                ) {
                    throw fileTooLarge();
                }
                // 原子替换文件
                await this
                    .replaceFileAtomically(
                        target,

                        current.revision,

                        nextBytes,

                        current.mode,

                        signal,
                    );

                return {
                    path:
                        this.relativePath(
                            target,
                        ),

                    previousRevision:
                    current
                        .revision,

                    revision:
                        createWorkspaceRevision(
                            nextBytes,
                        ),

                    byteLength:
                    nextBytes.length,

                    changed:
                        true,
                };
            },
        );
    }

    /**
     * 安全地解析一个”准备创建的新文件“的路径，并确保这个文件最终只能被创建在workspace根目录内部
     * @param request
     * @param signal
     */
    public async createTextFile(
        request:
        WorkspaceCreateTextFileRequest,

        signal:
        AbortSignal,
    ): Promise<WorkspaceCreateTextFileResult> {
        return withFsErrors(
            signal,

            async () => {
                // 获得创建文件所在的路径
                const target =
                    await this
                        .resolveCreatableFilePath(
                            request.path,
                        );
                // 获取要写入文件的内容
                const bytes =
                    Buffer.from(
                        request.content,
                        "utf8",
                    );
                // 如果文件过大，直接报错
                if (
                    bytes.length >
                    MAX_FILE_BYTES
                ) {
                    throw fileTooLarge();
                }

                signal
                    .throwIfAborted();

                /*
                 * "wx":
                 *
                 * create exclusively;
                 * fail if path already exists.
                 *
                 * Never overwrite an existing
                 * user file.
                 */
                const handle =
                    await open(
                        target,
                        "wx",
                    );
                // 分块写文件
                try {
                    let offset = 0;

                    while (
                        offset <
                        bytes.length
                        ) {
                        signal
                            .throwIfAborted();

                        const {
                            bytesWritten,
                        } =
                            await handle
                                .write(
                                    bytes,

                                    offset,

                                    Math.min(
                                        64 * 1024,

                                        bytes.length -
                                        offset,
                                    ),

                                    offset,
                                );
                        // 写文件无进展，直接报错
                        if (
                            bytesWritten <= 0
                        ) {
                            throw new Error(
                                "Failed to make progress while creating file",
                            );
                        }

                        offset +=
                            bytesWritten;
                    }

                    await handle.sync();
                } catch (error) {
                    await handle.close();

                    /*
                     * Best effort rollback:
                     * don't leave a partially
                     * created file behind.
                     */
                    await unlink(
                        target,
                    ).catch(
                        () => undefined,
                    );

                    throw error;
                }

                await handle.close();

                return {
                    path:
                        this.relativePath(
                            target,
                        ),

                    revision:
                        createWorkspaceRevision(
                            bytes,
                        ),

                    byteLength:
                    bytes.length,
                };
            },
        );
    }

    /**
     * 不是直接修改文件，先创建temp文件，把完整文件写入temp，刷盘，检查target版本号，再rename
     * @param target 原本的文件地址
     * @param expectedRevision 期待的版本号
     * @param nextBytes 已经替换后的文件内容
     * @param originalMode 原本文件的权限
     * @param signal
     * @private
     */
    private async replaceFileAtomically(
        target: string,// 原文件地址
        expectedRevision: string,
        nextBytes: Buffer,
        originalMode: number,
        signal: AbortSignal,
    ): Promise<void> {
        signal.throwIfAborted();
        // 获取目标文件所在的目录
        const directory =
            path.dirname(
                target,
            );
        // 创建一个临时文件路径，临时文件位于源文件的同一目录下，遗忘rename的原子替换，要求源文件和目标文件位于同一文件系统
        const tempPath =
            path.join(
                directory,

                `.${path.basename(
                    target,
                )}.agent-${randomUUID()}.tmp`,
            );
        // 资源清理状态标记
        let tempExists =
            false;

        try {
            // 打开临时文件
            const tempHandle =
                await open(
                    tempPath,

                    "wx",// 如果文件存在，报错

                    originalMode &
                    0o777,
                );
            // 创建成功后记录状态
            tempExists = true;

            try {
                // 记录已经写入的位置
                let offset = 0;
                /**
                 * 分快写的好处：
                 * 1. 可以在每个块之间，检查是否取消任务，一次性写入超大文件，可能会没有取消检查的机会
                 *
                 */
                while (
                    offset <
                    nextBytes.length
                    ) {
                    signal
                        .throwIfAborted();
                    // 写入的字节数
                    const {
                        bytesWritten,
                    } =
                        await tempHandle
                            .write(
                                nextBytes,

                                offset,
                                // 每次最大写64KB
                                Math.min(
                                    64 * 1024,

                                    nextBytes
                                        .length -
                                    offset,
                                ),

                                offset,
                            );
                    // 进度保护，如果没有写入文件的进度没有取得进展，就直接失败
                    if (
                        bytesWritten <= 0
                    ) {
                        throw new Error(
                            "Failed to make progress while writing temporary file",
                        );
                    }
                    // 记录已经写入文件的位置
                    offset +=
                        bytesWritten;
                }

                /*
                 * 在让这个新文件成为正式文件之前，先保证它的内容已经尽量持久化
                 */
                await tempHandle
                    .sync();
            } finally {
                // 资源释放，关闭文件
                await tempHandle
                    .close();
            }

            /*
             * 再次读取文件
             */
            const current =
                await this
                    .readTextDocument(
                        target,
                        signal,
                    );
            // 进行版本检查
            if (
                current.revision !==
                expectedRevision
            ) {
                throw staleRevision(
                    expectedRevision,

                    current.revision,
                );
            }

            signal.throwIfAborted();
            // 原子性改名
            await rename(
                tempPath,
                target,
            );
            // 临时文件不存在
            tempExists =
                false;
        } finally {
            if (tempExists) {
                await unlink(
                    tempPath,
                ).catch(
                    () => undefined,
                );
            }
        }
    }
    private validatePathSegments(
        input: string,
    ): readonly string[] {
        /*
         * 第一层：
         * 快速拒绝明显不是 workspace-relative path 的输入。
         */
        if (
            input.length === 0 ||
            /^[\\/]/u.test(
                input,
            ) ||
            /[<>:"|?*\u0000-\u001f]/u.test(
                input,
            )
        ) {
            throw new WorkspaceError(
                "invalid_path",

                "Use a workspace-relative path without drive letters or special characters",
            );
        }

        /*
         * 同时支持模型传：
         *
         * src/auth.ts
         *
         * 或 Windows 风格：
         *
         * src\auth.ts
         */
        const segments =
            input.split(
                /[\\/]/u,
            );

        for (
            const segment
            of segments
            ) {
            /*
             * "." / ".." 本身暂时不在这里判断越界。
             *
             * 因为：
             *
             * src/../index.ts
             *
             * 在字符串层面不一定非法。
             *
             * 真正是否越界交给后面的
             * path.resolve + assertInside。
             */
            if (
                segment === "." ||
                segment === ".." ||
                segment === ""
            ) {
                continue;
            }

            /*
             * Windows 特殊规则：
             *
             * foo.
             * foo<space>
             *
             * 都属于我们不接受的名字。
             */
            if (
                /[. ]$/u.test(
                    segment,
                ) ||
                /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(
                    segment,
                )
            ) {
                throw new WorkspaceError(
                    "invalid_path",

                    "Path contains an unsupported Windows filename",
                );
            }
        }

        return segments;
    }
    /**
     * 负责路径合法性和越界保护，并给出最后的解析路径
     * @param input
     * @private
     */
    private async resolveExistingPath(input: string): Promise<string> {
        const segments=this.validatePathSegments(input);
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
            case "EEXIST":
                mapped =
                    "conflict";
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

/**
 * 根据传入的字节数组，转为sha256
 * @param bytes
 */
function createWorkspaceRevision(
    bytes: Uint8Array,
): string {
    return (
        "sha256:" +
        createHash(
            "sha256",
        )
            .update(
                bytes,
            )
            .digest(
                "hex",
            )
    );
}

/**
 * 检测UTF-8 BOM
 * @param bytes
 */
function hasUtf8Bom(
    bytes: Uint8Array,
): boolean {
    return (
        bytes.length >= 3 &&
        bytes[0] === 0xef &&
        bytes[1] === 0xbb &&
        bytes[2] === 0xbf
    );
}
// 把BOM 本身保存成Buffer
const UTF8_BOM =
    Buffer.from([
        0xef,
        0xbb,
        0xbf,
    ]);

/**
 *
 * @param content
 * @param hasBom
 */
function encodeTextDocument(
    content: string,
    hasBom: boolean,
): Buffer {
    const body =
        Buffer.from(
            content,
            "utf8",
        );

    return hasBom
        ? Buffer.concat([
            UTF8_BOM,
            body,
        ])
        : body;
}
function staleRevision(
    expectedRevision: string,
    currentRevision: string,
): WorkspaceError {
    return new WorkspaceError(
        "conflict",

        "File changed after it was read; read the file again before editing",

        {
            reason:
                "stale_revision",

            expectedRevision,

            currentRevision,
        },
    );
}