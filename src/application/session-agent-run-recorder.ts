import type {
    AgentRunRecorder,
} from "../core/agent/agent-run-recorder.js";

import type {
    ModelResponse,
} from "../core/model/model-response.js";

import type {
    ToolCall,
} from "../core/tools/tool-call.js";

import type {
    ToolResult,
} from "../core/tools/tool-result.js";

import type {
    SessionLease,
} from "./session-store.js";
// 把Agent运行过程中的关键事件，转换成Session事件，并持久化到当前会话中
export class SessionAgentRunRecorder
    implements AgentRunRecorder
{
    public constructor(
        private readonly session:
        SessionLease,// 传入一个sessionLease
    ) {}
    // 模型完成响应之后，将这个事实作为Session Event追加到事件日志
    public async recordModelCompleted(
        response:
        ModelResponse,
    ): Promise<void> {
        await this.session
            .append({
                type:
                    "model.completed",

                response,
            });
    }
    // 工具调用的时候，写入事件日志
    public async recordToolStarted(
        call:
        ToolCall,
    ): Promise<void> {
        await this.session
            .append({
                type:
                    "tool.started",

                call,
            });
    }
    // 工具完成的时候，写入事件日志
    public async recordToolCompleted(
        call:
        ToolCall,

        result:
        ToolResult,
    ): Promise<void> {
        await this.session
            .append({
                type:
                    "tool.completed",

                toolCallId:
                call.id,

                result,
            });
    }
}