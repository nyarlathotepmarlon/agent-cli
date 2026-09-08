import {
    toResponseInputItems,
} from "openai/lib/responses/ResponseInputItems";

import type {
    Response,
    ResponseFunctionToolCall,
} from "openai/resources/responses/responses";

import {
    ModelError,
} from "../../../core/model/model-error.js";

import type {
    ModelFinishReason,
    ModelResponse,
} from "../../../core/model/model-response.js";

import type {
    JsonObject,
    JsonValue,
} from "../../../core/shared/json.js";

import {
    toJsonValue,
} from "../../../core/shared/json.js";

import {
    OPENAI_PROVIDER,
    REPLAY_KIND,
} from "./openai-message-mapper.js";
/**
 * 将OpenAI Response转为内部ModelResponse
 */
export function fromOpenAIResponse(
    response: Response,
    modelId: string,
): ModelResponse {
    // 处理失败响应
    if (
        response.status === "failed"
    ) {
        // 抛出内部的ModelError
        throw new ModelError(
            response.error?.message ??
            "OpenAI response failed",
            {
                code:
                    "invalid_response",

                provider:
                OPENAI_PROVIDER,

                retryable: false,

                status: null,

                requestId:
                    getRequestId(
                        response,
                    ),
            },
        );
    }

    const toolCalls =
        response.output
            //提取Openai Response中的function_call
            .filter(
                (
                    item,
                ): item is
                    ResponseFunctionToolCall =>
                    item.type ===
                    "function_call",
            )
            // 将open ai的function_call映射为内部的tool格式
            .map(parseToolCall);
    // 提取拒绝文本，如果模型拒绝回答：{
    // "type":"refusal",
    // "refusal":"I cannot help"
    // }
    const refusalText =
        extractRefusalText(
            response,
        );
    // 如果有输出文本，那么openai的回复就是输出文本，否则拒绝文本
    const content =
        response.output_text.length > 0
            ? response.output_text
            : refusalText;
    // 生成replay数据
    const replayValue =
        toJsonValue(
            toResponseInputItems(
                response.output,
            ),
        );
    // 验证replay数据
    if (
        !Array.isArray(
            replayValue,
        )
    ) {
        throw new ModelError(
            "OpenAI replay data was not an array",
            {
                code:
                    "invalid_response",

                provider:
                OPENAI_PROVIDER,

                retryable: false,

                status: null,

                requestId:
                    getRequestId(
                        response,
                    ),
            },
        );
    }
    // 返回ModelResponse
    return {
        message: {
            role:
                "assistant",

            content,

            toolCalls,

            providerData: {
                provider:
                OPENAI_PROVIDER,

                model:
                modelId,

                data: {
                    kind:
                    REPLAY_KIND,

                    items:
                    replayValue,
                },
            },
        },

        finishReason:
            getFinishReason(
                response,
                toolCalls.length,
                refusalText.length > 0,
            ),

        usage:
            response.usage === null ||
            response.usage === undefined
                ? null
                : {
                    inputTokens:
                    response.usage
                        .input_tokens,

                    outputTokens:
                    response.usage
                        .output_tokens,
                },

        providerRequestId:
            getRequestId(
                response,
            ),
    };
}

/**
 * 将openai的tool call转为内部的tool call
 * @param call
 */
function parseToolCall(
    call: ResponseFunctionToolCall,
): {
    readonly id: string;

    readonly name: string;

    readonly input: JsonObject;
} {
    let value: unknown;
    // 将参数字符串转为对象
    try {
        value =
            JSON.parse(
                call.arguments,
            );
    } catch (error) {
        throw new ModelError(
            `Model returned invalid JSON for tool "${call.name}"`,
            {
                code:
                    "invalid_response",

                provider:
                OPENAI_PROVIDER,

                retryable: false,

                status: null,

                requestId: null,

                cause: error,
            },
        );
    }
    // 校验argument，防止直接返回"hello"以及[]
    if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value)
    ) {
        throw new ModelError(
            `Tool "${call.name}" arguments must be a JSON object`,
            {
                code:
                    "invalid_response",

                provider:
                OPENAI_PROVIDER,

                retryable: false,

                status: null,

                requestId: null,
            },
        );
    }

    return {
        /*
         * Responses API 应使用 call_id
         * 来匹配 function_call_output。
         */
        id:
        call.call_id,

        name:
        call.name,

        input:
            value as JsonObject,
    };
}

function getFinishReason(
    response: Response,
    toolCallCount: number,
    refused: boolean,
): ModelFinishReason {
    // 如果是incomplete
    if (
        response.status ===
        "incomplete"
    ) {
        const reason =
            response
                .incomplete_details
                ?.reason;

        if (
            reason ===
            "max_output_tokens"
        ) {
            return "max_output_tokens";
        }

        if (
            reason ===
            "content_filter"
        ) {
            return "content_filter";
        }

        return "unknown";
    }
    // 如果不是completed
    if (
        response.status !==
        "completed"
    ) {
        return "unknown";
    }

    if (toolCallCount > 0) {
        return "tool_calls";
    }

    if (refused) {
        return "refused";
    }

    return "completed";
}

function extractRefusalText(
    response: Response,
): string {
    const refusals:
        string[] = [];

    for (
        const item
        of response.output
        ) {
        if (
            item.type !== "message"
        ) {
            continue;
        }

        for (
            const content
            of item.content
            ) {
            if (
                content.type ===
                "refusal"
            ) {
                refusals.push(
                    content.refusal,
                );
            }
        }
    }

    return refusals.join(
        "\n",
    );
}

function getRequestId(
    response: Response,
): string | null {
    const value =
        (
            response as Response & {
                readonly _request_id?:
                    string | null;
            }
        )._request_id;

    return value ?? null;
}