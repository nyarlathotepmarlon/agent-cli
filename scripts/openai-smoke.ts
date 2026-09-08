import OpenAI from "openai";

import {
    OpenAIResponsesModel,
} from "../src/infrastructure/model/openai/openai-model.js";

import type {
    OpenAIResponsesClient,
} from "../src/infrastructure/model/openai/openai-responses-client.js";

const apiKey =
    process.env[
        "OPENAI_API_KEY"
        ];

if (
    apiKey === undefined ||
    apiKey.trim().length === 0
) {
    throw new Error(
        "OPENAI_API_KEY is required",
    );
}

const modelId =
    process.env[
        "AGENT_MODEL"
        ]?.trim() ||
    "gpt-5.5";

const client =
    new OpenAI({
        apiKey,

        maxRetries: 0,

        timeout:
            120_000,
    });

const responses:
    OpenAIResponsesClient =
    {
        async create(
            body,
            options,
        ) {
            return client.responses.create(
                body,
                options,
            );
        },
    };

const model =
    new OpenAIResponsesModel(
        modelId,
        responses,
    );

const controller =
    new AbortController();

const response =
    await model.generate(
        {
            messages: [
                {
                    role:
                        "user",

                    content:
                        "Reply with exactly: OK",
                },
            ],

            tools: [],
        },

        controller.signal,
    );

console.log(
    response.message.content,
);