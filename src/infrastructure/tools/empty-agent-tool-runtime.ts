import type {
    AgentToolRuntime,
} from "../../core/agent/agent-tool-runtime.js";

import type {
    ToolCall,
} from "../../core/tools/tool-call.js";

import type {
    ToolExecutionContext,
} from "../../core/tools/tool.js";

import type {
    ToolResult,
} from "../../core/tools/tool-result.js";

export class EmptyAgentToolRuntime
    implements AgentToolRuntime
{
    public readonly definitions = [];

    public async execute(
        call: ToolCall,
        context: ToolExecutionContext,
    ): Promise<ToolResult> {
        context.signal
            .throwIfAborted();

        return {
            ok: false,

            error: {
                code:
                    "unavailable",

                message:
                    `Tool is not available: ${call.name}`,

                retryable:
                    false,
            },
        };
    }
}