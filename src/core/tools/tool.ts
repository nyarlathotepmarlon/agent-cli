import type { JsonObject, JsonValue } from "../shared/json.js";
import type { ToolResult } from "./tool-result.js";
import type { ModelToolDefinition } from "../model/model-tool-definition.js";

export interface ToolExecutionContext {
    readonly signal: AbortSignal;
}

export interface Tool<
    TInput = unknown,
    TOutput extends JsonValue = JsonValue,
>  extends ModelToolDefinition{
    readonly execute:(
        input: TInput,
        context: ToolExecutionContext,
    )=>Promise<ToolResult<TOutput>>;
}