import type { AgentToolRuntime } from "../agent/agent-tool-runtime.js";
import type { ModelToolDefinition } from "../model/model-tool-definition.js";
import type { ToolCall } from "./tool-call.js";
import type { ToolExecutionContext } from "./tool.js";
import type { ToolResult } from "./tool-result.js";
import { ToolRegistry } from "./tool-registry.js";

export class DefaultAgentToolRuntime implements AgentToolRuntime {
    public constructor(private readonly registry: ToolRegistry) {}

    public get definitions(): readonly ModelToolDefinition[] {
        return this.registry.definitions;
    }

    public async execute(
        call: ToolCall,
        context: ToolExecutionContext,
    ): Promise<ToolResult> {
        context.signal.throwIfAborted();
        // 从工具注册表中获取工具
        const tool = this.registry.get(call.name);
        // 判断是否有对应工具
        if (tool === undefined) {
            return {
                ok: false,
                error: {
                    code: "unavailable",
                    message: `Tool is not registered: ${call.name}`,
                    retryable: false,
                },
            };
        }
        // 执行对应工具的逻辑
        const result = await tool.execute(call.input, context);

        // 工具返回时再次检查，覆盖工具执行期间发生的取消。
        context.signal.throwIfAborted();

        return result;
    }
}