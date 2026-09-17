import type { AgentToolRuntime } from "../agent/agent-tool-runtime.js";
import type { ModelToolDefinition } from "../model/model-tool-definition.js";
import type { ToolCall } from "./tool-call.js";
import type { ToolExecutionContext } from "./tool.js";
import type { ToolResult } from "./tool-result.js";
import { ToolRegistry } from "./tool-registry.js";
import type {PermissionAuthorizer} from "../permissions/permission.js";

export class DefaultAgentToolRuntime implements AgentToolRuntime {
    public constructor(
        private readonly registry: ToolRegistry,
        private readonly authorizer:PermissionAuthorizer
    ) {}

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
        // 执行对应工具的准备阶段：校验参数
        const preparation =
            tool.prepare(
                call.input,
            );

        if (
            !preparation.ok
        ) {
            return {
                ok:
                    false,

                error:
                preparation
                    .error,
            };
        }
        const prepared =
            preparation.prepared;
        // 参数校验完成后，使用鉴权器鉴权
        const authorization =
            await this
                .authorizer
                .authorize(
                    {
                        callId:
                        call.id,

                        toolName:
                        call.name,

                        action:
                        prepared
                            .permission
                            .action,

                        summary:
                        prepared
                            .permission
                            .summary,

                        input:
                        prepared
                            .input,
                    },

                    context.signal,
                );

        // 工具返回时再次检查，覆盖工具执行期间发生的取消。
        context.signal.throwIfAborted();
        // 如果直接拒绝，返回结果
        if (
            !authorization.allowed
        ) {
            return {
                ok:
                    false,

                error: {
                    code:
                        "permission_denied",

                    message:
                    authorization
                        .message,

                    retryable:
                        false,

                    details: {
                        action:
                        prepared
                            .permission
                            .action,

                        reason:
                        authorization
                            .reason,

                        tool:
                        call.name,
                    },
                },
            };
        }
        // 如果没有拒绝，执行实际的逻辑
        const result =
            await prepared
                .execute(
                    context,
                );

        context.signal
            .throwIfAborted();

        return result;
    }
}