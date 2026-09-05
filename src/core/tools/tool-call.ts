import type { JsonObject } from "../shared/json.js";

export interface ToolCall {
    readonly id: string;
    readonly name: string;
    readonly input: JsonObject;
}