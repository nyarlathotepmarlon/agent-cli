import type {
    Model,
} from "../../core/model/model.js";

export interface ModelProvider {
    readonly id: string;

    createModel(
        modelId: string,
    ): Model;
}