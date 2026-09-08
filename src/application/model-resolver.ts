import type {
    Model,
} from "../core/model/model.js";

export interface ModelSelection {
    readonly provider: string;

    readonly model: string;
}

export interface ModelResolver {
    resolve(
        selection: ModelSelection,
    ): Model;
}