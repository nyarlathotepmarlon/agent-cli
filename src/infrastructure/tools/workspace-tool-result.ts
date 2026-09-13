import type { JsonValue } from "../../core/shared/json.js";
import type { ToolErrorCode } from "../../core/tools/tool-error.js";
import type { ToolResult } from "../../core/tools/tool-result.js";
import {
    WorkspaceError,
    type WorkspaceErrorCode,
} from "../../core/workspace/workspace-error.js";
// 错误映射表

const toolErrorCodes: Record<WorkspaceErrorCode, ToolErrorCode> = {
    invalid_path: "invalid_input",
    invalid_range: "invalid_input",
    text_too_large: "unavailable",
    outside_workspace: "permission_denied",
    not_found: "not_found",
    not_file: "invalid_input",
    not_directory: "invalid_input",
    permission_denied: "permission_denied",
    file_too_large: "unavailable",
    invalid_encoding: "unavailable",
    binary_file: "unavailable",
    io_error: "execution_failed",
};

export async function workspaceToolResult<T extends JsonValue>(
    signal: AbortSignal,
    operation: () => Promise<T>,
): Promise<ToolResult<T>> {
    signal.throwIfAborted();

    try {
        const output = await operation();
        signal.throwIfAborted();
        return { ok: true, output };
    } catch (error) {
        signal.throwIfAborted();

        if (!(error instanceof WorkspaceError)) {
            throw error;
        }

        return {
            ok: false,
            error: {
                code: toolErrorCodes[error.code],
                message: error.message,
                retryable: false,
                details: {
                    workspaceCode: error.code,
                },
            },
        };
    }
}