import type {
    ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

import type {
    Model,
    ModelRequest,
} from "../../../core/model/model.js";

import {
    ModelError,
} from "../../../core/model/model-error.js";

import type {
    ModelResponse,
} from "../../../core/model/model-response.js";

import {
    mapOpenAIError,
} from "./openai-error-mapper.js";

import {
    OPENAI_PROVIDER,
    toOpenAIInput,
    toOpenAITools,
} from "./openai-message-mapper.js";

import {
    fromOpenAIResponse,
} from "./openai-response-mapper.js";

import type {
    OpenAIResponsesClient,
} from "./openai-responses-client.js";

export class OpenAIResponsesModel
    implements Model
{
    public readonly provider =
        OPENAI_PROVIDER;

    public constructor(
        public readonly id: string,

        private readonly client:
        OpenAIResponsesClient,
    ) {}

    public async generate(
        request: ModelRequest,
        signal: AbortSignal,
    ): Promise<ModelResponse> {
        // 请求开始前检查用户是否取消
        signal.throwIfAborted();

        const body:
            ResponseCreateParamsNonStreaming =
            {
                model:
                this.id,

                input:
                    toOpenAIInput(
                        request.messages,
                        this.id,
                    ),

                tools:
                    toOpenAITools(
                        request.tools,
                    ),

                parallel_tool_calls:
                    true,

                /*
                 * 我们自己维护 Agent context，
                 * 不依赖 Provider server-side
                 * conversation storage。
                 */
                store: false,

                /*
                 * store=false 时仍需要保留
                 * reasoning context，用于下一轮
                 * stateless replay。
                 */
                include: [
                    "reasoning.encrypted_content",
                ],
            };

        try {
            //调用openai
            const response =
                await this.client.create(
                    body,
                    {
                        signal,
                    },
                );
            // 将openai的结果转为内部结果返回
            return fromOpenAIResponse(
                response,
                this.id,
            );
        } catch (error) {
            /*
             * Domain-level adapter error
             * 不要再次包装。
             */
            if (
                error instanceof
                ModelError
            ) {
                throw error;
            }

            /*
             * 用户 Ctrl+C：
             * 保持 Abort 语义，让 Process
             * Boundary 转成 exit 130。
             */
            if (
                signal.aborted ||
                isAbortError(error)
            ) {
                throw error;
            }

            const mapped =
                mapOpenAIError(
                    error,
                );

            if (mapped !== null) {
                throw mapped;
            }

            /*
             * 未知 programmer/runtime error
             * 不伪装成 Provider error。
             */
            throw error;
        }
    }
}

function isAbortError(
    error: unknown,
): boolean {
    if (
        typeof error !== "object" ||
        error === null ||
        !("name" in error)
    ) {
        return false;
    }

    return (
        error.name ===
        "AbortError" ||
        error.name ===
        "APIUserAbortError"
    );
}