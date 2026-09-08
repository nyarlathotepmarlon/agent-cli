import OpenAI from "openai";

import type {
    Model,
} from "../../../core/model/model.js";

import type {
    ModelProvider,
} from "../model-provider.js";

import {
    OPENAI_PROVIDER,
} from "./openai-message-mapper.js";

import {
    OpenAIResponsesModel,
} from "./openai-model.js";

import type {
    OpenAIResponsesClient,
} from "./openai-responses-client.js";
// Openai模型供应商配置
export interface OpenAIModelProviderOptions {
    readonly apiKey:
        string | null;

    readonly baseURL:
        string | null;

    readonly timeoutMs:
        number;
}

export class OpenAIModelProvider
    implements ModelProvider
{
    public readonly id =
        OPENAI_PROVIDER;

    private client:
        OpenAI | null = null;

    public constructor(
        private readonly options:
        OpenAIModelProviderOptions,
    ) {
        // 校验timeout
        if (
            !Number.isSafeInteger(
                options.timeoutMs,
            ) ||
            options.timeoutMs <= 0
        ) {
            throw new RangeError(
                "OpenAI timeoutMs must be a positive safe integer",
            );
        }
    }

    public createModel(
        modelId: string,
    ): Model {
        // 规范化模型名称
        const normalized =
            modelId.trim();

        if (
            normalized.length === 0
        ) {
            throw new Error(
                "OpenAI model id must not be empty",
            );
        }

        const client =
            this.getClient();

        const responses:
            OpenAIResponsesClient =
            {
                async create(
                    body,
                    options,
                ) {
                    return client
                        .responses
                        .create(
                            body,
                            options,
                        );
                },
            };
        // 返回模型
        return new OpenAIResponsesModel(
            normalized,
            responses,
        );
    }

    /**
     * 懒加载OpenAI SDK Client
     * @private
     */
    private getClient(): OpenAI {
        if (this.client !== null) {
            return this.client;
        }

        const apiKey =
            this.options.apiKey;

        if (
            apiKey === null ||
            apiKey.trim().length === 0
        ) {
            throw new Error(
                "OPENAI_API_KEY is not configured",
            );
        }
        // 创建真正的Openai client
        this.client =
            new OpenAI({
                apiKey,

                /*
                 * Retry ownership 放在
                 * Agent Runtime。
                 */
                maxRetries: 0,

                timeout:
                this.options
                    .timeoutMs,

                ...(
                    this.options.baseURL ===
                    null
                        ? {}
                        : {
                            baseURL:
                            this.options
                                .baseURL,
                        }
                ),
            });

        return this.client;
    }
}