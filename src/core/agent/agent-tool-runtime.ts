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
        readonly ModelToolDefinition[]; // 向模型提供实际注册的工具

    execute(
        call: ToolCall,
        context: ToolExecutionContext,
    ): Promise<ToolResult>; // 查找并调用对应的工具
}