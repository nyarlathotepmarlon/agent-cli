export type JsonPrimitive =
    | string
    | number
    | boolean
    | null;

export type JsonArray = readonly JsonValue[];

export interface JsonObject {
    readonly [key: string]: JsonValue;
}

export type JsonValue =
    | JsonPrimitive
    | JsonArray
    | JsonObject;

/**
 * 将掉用户给的任意JS数据转为严格的JSON数据
 * @param value 任意JS数据
 */
export function toJsonValue(
    value: unknown,
): JsonValue {
    const serialized =
        JSON.stringify(value);

    if (serialized === undefined) {
        throw new TypeError(
            "Value is not JSON serializable",
        );
    }

    return JSON.parse(
        serialized,
    ) as JsonValue;
}