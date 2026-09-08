import {
    describe,
    expect,
    it,
} from "vitest";

import {
    classifyOpenAIStatus,
} from "../../../../src/infrastructure/model/openai/openai-error-mapper.js";

describe(
    "classifyOpenAIStatus",
    () => {
        it(
            "marks rate limits as retryable",
            () => {
                expect(
                    classifyOpenAIStatus(
                        429,
                    ),
                ).toEqual({
                    code:
                        "rate_limit",

                    retryable:
                        true,
                });
            },
        );

        it(
            "marks authentication errors as non-retryable",
            () => {
                expect(
                    classifyOpenAIStatus(
                        401,
                    ),
                ).toEqual({
                    code:
                        "authentication",

                    retryable:
                        false,
                });
            },
        );

        it(
            "marks server errors as retryable",
            () => {
                expect(
                    classifyOpenAIStatus(
                        503,
                    ),
                ).toEqual({
                    code:
                        "server_error",

                    retryable:
                        true,
                });
            },
        );
    },
);