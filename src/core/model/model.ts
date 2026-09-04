export type ModelRole =
    | "system"
    | "user"
    | "assistant"
    | "tool";

export interface ModelMessage {
    readonly role: ModelRole;
    readonly content: string;
}

export interface ModelRequest {
    readonly messages: readonly ModelMessage[];
}

export interface ModelUsage {
    readonly inputTokens: number;
    readonly outputTokens: number;
}

export interface ModelResponse {
    readonly content: string;
    readonly usage?: ModelUsage;
}

export interface Model {
    generate(
        request: ModelRequest,
        signal?: AbortSignal,
    ): Promise<ModelResponse>;
}