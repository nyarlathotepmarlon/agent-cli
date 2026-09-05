import type { AssistantModelMessage } from "./model-message.js";

export type ModelFinishReason =
    | "completed"
    | "tool_calls"
    | "max_output_tokens"
    | "refused"
    | "unknown";

export interface ModelUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
}

export interface ModelResponse {
    readonly message: AssistantModelMessage;

    readonly finishReason: ModelFinishReason;

    readonly usage: ModelUsage | null;
}