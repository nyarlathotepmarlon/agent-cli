import type {ModelMessage} from "./model-message.js";
import type {ModelToolDefinition} from "./model-tool-definition.js";
import type {ModelResponse} from "./model-response.js";

export interface ModelRequest {
    readonly messages: readonly ModelMessage[];
    readonly tools:readonly ModelToolDefinition[];
}

export interface Model {
    readonly provider: string; // 供应商名称
    readonly id:string;// 模型名称
    generate(
        request: ModelRequest,
        signal: AbortSignal,
    ): Promise<ModelResponse>;
}