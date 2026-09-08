import type {
    Response,
    ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

export interface OpenAIResponsesClient {
    create(
        body:
        ResponseCreateParamsNonStreaming,

        options?: {
            readonly signal?:
                AbortSignal | null;
        },
    ): Promise<Response>;
}