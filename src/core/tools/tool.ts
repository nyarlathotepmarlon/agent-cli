import type { JsonObject, JsonValue } from "../shared/json.js";
import type { ToolResult } from "./tool-result.js";

export interface ToolExecutionContext {
    readonly signal: AbortSignal;
}

export interface Tool<
    TInput = unknown,
    TOutput extends JsonValue = JsonValue,
> {
    //todo：根据单一事实原则，Tool这三个字段应该来源于ModelToolDefinition
    readonly name: string;

    readonly description: string;

    readonly inputSchema: JsonObject;

    execute(
        input: TInput,
        context: ToolExecutionContext,
    ): Promise<ToolResult<TOutput>>;
}