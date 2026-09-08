import type { ToolCall } from "../tools/tool-call.js";
import type {
    ModelProviderData,
} from "./model-provider-data.js";
export interface SystemModelMessage {
    readonly role: "system";
    readonly content: string;
}

export interface UserModelMessage {
    readonly role: "user";
    readonly content: string;
}

export interface AssistantModelMessage {
    readonly role: "assistant";
    readonly content: string;
    readonly toolCalls: readonly ToolCall[];
    readonly providerData:
        ModelProviderData | null;
}

export interface ToolModelMessage {
    readonly role: "tool";
    readonly toolCallId: string;
    readonly toolName: string;
    readonly content: string;
    readonly isError: boolean;
}

export type ModelMessage =
    | SystemModelMessage
    | UserModelMessage
    | AssistantModelMessage
    | ToolModelMessage;