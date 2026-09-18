import type {
    ModelMessage,
} from "../model/model-message.js";

import type {
    ModelToolDefinition,
} from "../model/model-tool-definition.js";
// 上下文策略：描述上下文应该如何被裁剪
export interface ContextPolicy {
    /**
     * ToolDefinition也算在上下文
     */
    readonly maxEstimatedInputTokens:// 最终构造出来的输入上下文，估算token树不能超过多少
        number;

    readonly hotTurns:// 最近的几轮对话被视为hot context
        number;

    readonly minRetainedTurns:// 第二道保护线，最小保留的轮数
        number;
    // Hot Context
    readonly hotAssistantChars:
        number;

    readonly hotToolResultChars:
        number;
    // Cold Context：较旧的对话允许压缩得更加厉害
    readonly coldAssistantChars:
        number;

    readonly coldToolResultChars:
        number;
    // emergency context：当hot+cold仍然超过token limit的时候，进入emergency模式
    readonly emergencyAssistantChars:
        number;

    readonly emergencyToolResultChars:
        number;
}
// 构建模型上下文所需要的原始输入
export interface ContextBuildRequest {
    readonly messages:
        readonly ModelMessage[];

    readonly tools:
        readonly ModelToolDefinition[];
}

export interface ContextBuildStats {
    readonly originalMessageCount:// 原始的消息数
        number;

    readonly projectedMessageCount:// 发送给模型的消息数
        number;

    readonly originalEstimatedTokens:// 原始的token估算
        number;

    readonly projectedEstimatedTokens:// 映射过后的token估算
        number;

    readonly toolDefinitionEstimatedTokens:// 工具定义的token数
        number;

    readonly droppedTurns:// 删除的轮次
        number;

    readonly providerReplayStripped:// 是否清理了provider replay
        boolean;

    readonly compacted:// 最终上下文是否发生压缩
        boolean;
}

export interface ContextBuildResult {
    readonly messages:
        readonly ModelMessage[];// 真正应该发送给模型的消息

    readonly stats:
        ContextBuildStats;// 本次构建发生了什么
}

export interface ContextOverflowError {
    readonly code:
        "context_overflow";

    readonly limit:
        number;

    readonly estimated:
        number;

    /**
     * Cost of the context that we
     * refuse to silently discard:
     *
     * system + user + tools.
     */
    readonly pinnedEstimatedTokens:// 这些固定不能删除的内容的tokens，帮助理解为什么这次压缩失败
        number;
}

export type ContextBuildOutcome =
    | {
    readonly ok: true;

    readonly result:
        ContextBuildResult;
}
    | {
    readonly ok: false;

    readonly error:
        ContextOverflowError;
};
// ContextManager接口
export interface ContextManager {
    build(
        request:
        ContextBuildRequest,

        signal:
        AbortSignal,
    ): Promise<ContextBuildOutcome>;
}