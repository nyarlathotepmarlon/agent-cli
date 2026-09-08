import type {
    JsonObject,
} from "../shared/json.js";

export interface ModelProviderData {
    readonly provider: string;

    readonly model: string;

    readonly data: JsonObject;
}