import type { ModelResponse } from "../model/model-response.js";
import type { ToolCall } from "../tools/tool-call.js";
import type { ToolResult } from "../tools/tool-result.js";

export interface ModelAgentStep {
    readonly kind: "model";

    readonly turn: number;

    readonly response: ModelResponse;
}

export interface ToolAgentStep {
    readonly kind: "tool";

    readonly turn: number;

    readonly call: ToolCall;

    readonly result: ToolResult;
}

export type AgentStep =
    | ModelAgentStep
    | ToolAgentStep;