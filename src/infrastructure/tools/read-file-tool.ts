import { z } from "zod";
import type { Workspace } from "../../core/workspace/workspace.js";
import { WorkspaceError } from "../../core/workspace/workspace-error.js";
import { defineTool } from "./define-tool.js";
import { workspaceToolResult } from "./workspace-tool-result.js";
// 设置最大字符数上限
export const MAX_READ_TEXT_CHARS = 20_000;

/**
 * 包装read_file工具的创建
 * @param workspace
 */
export function createReadFileTool(workspace: Workspace) {
    return defineTool({
        name: "read_file",
        description:
            "Read UTF-8 text using a workspace-relative path. " +
            "Lines are 1-based. Returns at most 200 lines and 20000 UTF-16 code units. " +
            "Use nextLine to continue; files over 256 KiB are unavailable.",

        schema: z.strictObject({
            path: z.string().min(1).max(4096)
                .describe("File path relative to the workspace root."),
            startLine: z.number().int().min(1)
                .max(Number.MAX_SAFE_INTEGER)
                .default(1),
            maxLines: z.number().int().min(1).max(200)
                .default(100),
        }),
        /**
         *
         * @param input
         * @param context
         */
        async execute(input, context) {
            return workspaceToolResult(context.signal, async () => {
                const file = await workspace.readTextFile(
                    input.path,
                    context.signal,
                );
                // 切分成行
                const lines = file.content.length === 0
                    ? []
                    : file.content.split(/\r\n|\n|\r/u);

                // 文件末尾的换行符不额外计算为一行。
                if (lines.at(-1) === "") {
                    lines.pop();
                }
                // 开始行数大于整个行数
                if (input.startLine > Math.max(1, lines.length)) {
                    throw new WorkspaceError(
                        "invalid_range",
                        `startLine exceeds the file's ${lines.length} lines`,
                    );
                }

                const selected: string[] = [];
                let characters = 0;

                for (
                    let index = input.startLine - 1;
                    index < lines.length &&
                    selected.length < input.maxLines;// 最多读maxLines行
                    index += 1
                ) {
                    const line = lines[index];

                    if (line === undefined) {
                        break;
                    }
                    // 统计当前行的字符数
                    const additional =
                        line.length + (selected.length > 0 ? 1 : 0);

                    if (
                        // 之前的字符数+当前的字符数超过了限制的最大字符数
                        characters + additional >
                        MAX_READ_TEXT_CHARS
                    ) {
                        if (selected.length === 0) {
                            throw new WorkspaceError(
                                "text_too_large",
                                "Selected line exceeds the tool text limit; it cannot be returned as a complete line",
                            );
                        }

                        break;
                    }
                    // 将当前行存储在selected中
                    selected.push(line);
                    // 计算当前selected中字符的总数
                    characters += additional;
                }

                const endLine =
                    input.startLine - 1 + selected.length;
                // 判断后面还有没有更多的行
                const hasMore = endLine < lines.length;

                return {
                    path: file.path,  // 相对路径
                    byteLength: file.byteLength,// 文件总字节数
                    totalLines: lines.length,// 文件总行数
                    startLine:
                        selected.length === 0 ? null : input.startLine, // 本页其实起始行
                    endLine:
                        selected.length === 0 ? null : endLine,// 本页结束行
                    content: selected.join("\n"),// 本页内容
                    truncated: hasMore,// 是否还有更多内容
                    nextLine: hasMore ? endLine + 1 : null,// 下一行的行号
                };
            });
        },
    });
}