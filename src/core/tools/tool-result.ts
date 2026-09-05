import type { JsonValue } from "../shared/json.js";
import type { ToolError } from "./tool-error.js";

export type ToolResult<
    TOutput extends JsonValue = JsonValue,
> =
    | {
    readonly ok: true;
    readonly output: TOutput;
}
    | {
    readonly ok: false;
    readonly error: ToolError;
};