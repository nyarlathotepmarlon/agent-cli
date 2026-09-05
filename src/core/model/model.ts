import type {ModelMessage} from "./model-message.js";
import type {ModelToolDefinition} from "./model-tool-definition.js";
import type {ModelResponse} from "./model-response.js";

export interface ModelRequest {
    readonly messages: readonly ModelMessage[];
    readonly tools:readonly ModelToolDefinition[];
}

export interface Model {
    readonly id:string;
    generate(
        request: ModelRequest,
        signal: AbortSignal,
    ): Promise<ModelResponse>;
}