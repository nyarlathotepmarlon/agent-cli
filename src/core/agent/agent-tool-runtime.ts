import type {
    ModelToolDefinition,
} from "../model/model-tool-definition.js";

import type {
    ToolCall,
} from "../tools/tool-call.js";

import type {
    ToolExecutionContext,
} from "../tools/tool.js";

import type {
    ToolResult,
} from "../tools/tool-result.js";

export interface AgentToolRuntime {
    readonly definitions:
        readonly ModelToolDefinition[];

    execute(
        call: ToolCall,
        context: ToolExecutionContext,
    ): Promise<ToolResult>;
}