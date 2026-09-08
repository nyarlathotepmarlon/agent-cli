import OpenAI from "openai";
/**
 * 将OpenAI SDK 抛出的各种错误，转换成你系统内部统一的 ModelError
 */
import {
    ModelError,
    type ModelErrorCode,
} from "../../../core/model/model-error.js";

import {
    OPENAI_PROVIDER,
} from "./openai-message-mapper.js";
//定义错误分类结果
interface ErrorClassification {
    readonly code:
        ModelErrorCode;

    readonly retryable: boolean;
}

/**
 * 将外部的错误转为内部定义的Error
 * @param error
 */
export function mapOpenAIError(
    error: unknown,
): ModelError | null {
    // 处理timeout，因为timeout可能是网络问题，因此可重试
    if (
        error instanceof
        OpenAI.APIConnectionTimeoutError
    ) {
        return new ModelError(
            error.message,
            {
                code:
                    "timeout",

                provider:
                OPENAI_PROVIDER,

                retryable: true,// 可重试

                status: null,

                requestId: null,

                cause: error,
            },
        );
    }
    // 处理连接错误
    if (
        error instanceof
        OpenAI.APIConnectionError
    ) {
        return new ModelError(
            error.message,
            {
                code:
                    "connection",

                provider:
                OPENAI_PROVIDER,

                retryable: true,// 可重试

                status: null,

                requestId: null,

                cause: error,
            },
        );
    }
    //不是api错误返回null
    if (
        !(
            error instanceof
            OpenAI.APIError
        )
    ) {
        return null;
    }
    // 处理api错误
    const status =
        error.status ?? null;
    // 将http状态码转为内部错误类型
    const classification =
        classifyOpenAIStatus(
            status,
        );

    return new ModelError(
        error.message,
        {
            ...classification,

            provider:
            OPENAI_PROVIDER,

            status,

            requestId:
                error.requestID ??
                null,

            cause: error,
        },
    );
}

/**
 * 根据http状态码转为对应的内部错误code
 * @param status
 */
export function classifyOpenAIStatus(
    status: number | null,
): ErrorClassification {
    switch (status) {
        case 400:
        case 422:
            return {
                code:
                    "invalid_request",

                retryable: false,
            };

        case 401:
            return {
                code:
                    "authentication",

                retryable: false,
            };

        case 403:
            return {
                code:
                    "permission_denied",

                retryable: false,
            };

        case 404:
            return {
                code:
                    "not_found",

                retryable: false,
            };

        case 408:
            return {
                code:
                    "timeout",

                retryable: true,
            };

        case 409:
            return {
                code:
                    "conflict",

                retryable: true,
            };

        case 429:
            return {
                code:
                    "rate_limit",

                retryable: true,
            };

        default:
            if (
                status !== null &&
                status >= 500
            ) {
                return {
                    code:
                        "server_error",

                    retryable: true,
                };
            }

            return {
                code:
                    "unknown",

                retryable: false,
            };
    }
}