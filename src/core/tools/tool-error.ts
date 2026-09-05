import type { JsonObject } from "../shared/json.js";

export type ToolErrorCode =
    | "invalid_input"
    | "permission_denied"
    | "not_found"
    | "conflict"
    | "timeout"
    | "cancelled"
    | "execution_failed"
    | "unavailable"
    | "internal_error";

export interface ToolError {
    readonly code: ToolErrorCode;
    readonly message: string;
    readonly retryable: boolean;
    readonly details?: JsonObject;
}