/**
 * Agent运行过程的记录器接口
 */
import type {
    ModelResponse,
} from "../model/model-response.js";

import type {
    ToolCall,
} from "../tools/tool-call.js";

import type {
    ToolResult,
} from "../tools/tool-result.js";

/**
 * 规定一个Agent在运行过程中，哪些关键事件需要被记录，以及记录这些事件需要提供什么信息
 */
export interface AgentRunRecorder {
    /**
     * 当模型调用完成之后，通知Recorder
     * @param response
     */
    recordModelCompleted(
        response:
        ModelResponse,
    ): Promise<void>;

    /**
     * 调用工具开始之后，通知Recorder
     * @param call
     */
    recordToolStarted(
        call:
        ToolCall,
    ): Promise<void>;

    /**
     * 执行工具完成后，通知Recorder
     * @param call
     * @param result
     */
    recordToolCompleted(
        call:
        ToolCall,

        result:
        ToolResult,
    ): Promise<void>;
}