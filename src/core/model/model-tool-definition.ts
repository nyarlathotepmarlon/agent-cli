import type { JsonObject } from "../shared/json.js";

export interface ModelToolDefinition {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: JsonObject;
}