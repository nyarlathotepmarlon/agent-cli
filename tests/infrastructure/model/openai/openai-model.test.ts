import type {
    Response,
    ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

import {
    describe,
    expect,
    it,
} from "vitest";

import {
    OpenAIResponsesModel,
} from "../../../../src/infrastructure/model/openai/openai-model.js";

import type {
    OpenAIResponsesClient,
} from "../../../../src/infrastructure/model/openai/openai-responses-client.js";

class StubResponsesClient
    implements OpenAIResponsesClient
{
    public lastBody:
        ResponseCreateParamsNonStreaming
        | null = null;

    public lastSignal:
        AbortSignal | null = null;

    public constructor(
        private readonly response:
        Response,
    ) {}

    public async create(
        body:
        ResponseCreateParamsNonStreaming,

        options?: {
            readonly signal?:
                AbortSignal | null;
        },
    ): Promise<Response> {
        this.lastBody =
            body;

        this.lastSignal =
            options?.signal ??
            null;

        return this.response;
    }
}

describe(
    "OpenAIResponsesModel",
    () => {
        it(
            "maps model requests and responses",
            async () => {
                const client =
                    new StubResponsesClient(
                        createResponse(),
                    );

                const model =
                    new OpenAIResponsesModel(
                        "gpt-test",
                        client,
                    );

                const controller =
                    new AbortController();

                const result =
                    await model.generate(
                        {
                            messages: [
                                {
                                    role:
                                        "system",

                                    content:
                                        "You are a coding agent.",
                                },

                                {
                                    role:
                                        "user",

                                    content:
                                        "Read src/index.ts",
                                },
                            ],

                            tools: [
                                {
                                    name:
                                        "read_file",

                                    description:
                                        "Read a file",

                                    inputSchema: {
                                        type:
                                            "object",

                                        properties: {
                                            path: {
                                                type:
                                                    "string",
                                            },
                                        },
                                    },
                                },
                            ],
                        },

                        controller.signal,
                    );

                expect(
                    client.lastSignal,
                ).toBe(
                    controller.signal,
                );

                expect(
                    client.lastBody?.store,
                ).toBe(false);

                expect(
                    client.lastBody?.include,
                ).toContain(
                    "reasoning.encrypted_content",
                );

                expect(
                    result.finishReason,
                ).toBe(
                    "tool_calls",
                );

                expect(
                    result.message
                        .toolCalls,
                ).toEqual([
                    {
                        id:
                            "call_1",

                        name:
                            "read_file",

                        input: {
                            path:
                                "src/index.ts",
                        },
                    },
                ]);

                expect(
                    result.message
                        .providerData
                        ?.provider,
                ).toBe(
                    "openai",
                );

                expect(
                    result.providerRequestId,
                ).toBe(
                    "req_test",
                );
            },
        );
    },
);

function createResponse():
    Response {
    return {
        status:
            "completed",

        output_text:
            "",

        output: [
            {
                type:
                    "function_call",

                id:
                    "fc_1",

                call_id:
                    "call_1",

                name:
                    "read_file",

                arguments:
                    JSON.stringify({
                        path:
                            "src/index.ts",
                    }),

                status:
                    "completed",
            },
        ],

        usage: {
            input_tokens:
                100,

            output_tokens:
                20,

            total_tokens:
                120,
        },

        incomplete_details:
            null,

        error:
            null,

        _request_id:
            "req_test",
    } as unknown as Response;
}