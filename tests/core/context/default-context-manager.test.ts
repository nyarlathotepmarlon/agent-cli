import {
    describe,
    expect,
    it,
} from "vitest";

import {
    DefaultContextManager,
} from "../../../src/core/context/default-context-manager.js";

import {
    HeuristicTokenEstimator,
} from "../../../src/core/context/token-estimator.js";

import type {
    ModelMessage,
} from "../../../src/core/model/model-message.js";

function manager(
    maxEstimatedInputTokens:
    number,
) {
    return new DefaultContextManager(
        new HeuristicTokenEstimator(),

        {
            maxEstimatedInputTokens,

            hotTurns:
                2,

            minRetainedTurns:
                1,

            hotAssistantChars:
                2_000,

            hotToolResultChars:
                4_000,

            coldAssistantChars:
                500,

            coldToolResultChars:
                700,

            emergencyAssistantChars:
                250,

            emergencyToolResultChars:
                300,
        },
    );
}

const tools = [
    {
        name:
            "read_file",

        description:
            "Read a file",

        inputSchema: {
            type:
                "object",
        },
    },
] as const;
it(
    "preserves exact history when it fits",
    async () => {
        const messages:
            readonly ModelMessage[] =
            [
                {
                    role:
                        "system",

                    content:
                        "system",
                },

                {
                    role:
                        "user",

                    content:
                        "task",
                },

                {
                    role:
                        "assistant",

                    content:
                        "done",

                    toolCalls: [],

                    providerData: {
                        provider:
                            "openai",

                        model:
                            "test",

                        data: {
                            kind:
                                "example",

                            value:
                                "preserve-me",
                        },
                    },
                },
            ];

        const result =
            await manager(
                100_000,
            ).build(
                {
                    messages,

                    tools,
                },

                new AbortController()
                    .signal,
            );

        expect(
            result.ok,
        ).toBe(true);

        if (!result.ok) {
            throw new Error();
        }

        expect(
            result.result
                .messages,
        ).toEqual(
            messages,
        );

        expect(
            result.result
                .stats
                .compacted,
        ).toBe(false);

        expect(
            result.result
                .stats
                .providerReplayStripped,
        ).toBe(false);
    },
);
it(
    "drops opaque provider replay before discarding semantic history",
    async () => {
        const hugeReplay =
            "x".repeat(
                20_000,
            );

        const messages:
            readonly ModelMessage[] =
            [
                {
                    role:
                        "system",

                    content:
                        "system",
                },

                {
                    role:
                        "user",

                    content:
                        "task",
                },

                {
                    role:
                        "assistant",

                    content:
                        "semantic answer",

                    toolCalls: [],

                    providerData: {
                        provider:
                            "openai",

                        model:
                            "test",

                        data: {
                            kind:
                                "responses_replay_items",

                            items: [
                                {
                                    data:
                                    hugeReplay,
                                },
                            ],
                        },
                    },
                },
            ];

        const result =
            await manager(
                1_000,
            ).build(
                {
                    messages,

                    tools: [],
                },

                new AbortController()
                    .signal,
            );

        expect(
            result.ok,
        ).toBe(true);

        if (!result.ok) {
            throw new Error();
        }

        const assistant =
            result.result
                .messages
                .find(
                    (message) =>
                        message.role ===
                        "assistant",
                );

        expect(
            assistant?.role,
        ).toBe(
            "assistant",
        );

        if (
            assistant?.role !==
            "assistant"
        ) {
            throw new Error();
        }

        expect(
            assistant.content,
        ).toBe(
            "semantic answer",
        );

        expect(
            assistant.providerData,
        ).toBeNull();

        expect(
            result.result
                .stats
                .providerReplayStripped,
        ).toBe(true);
    },
);
it(
    "never leaves an orphan tool result when old turns are evicted",
    async () => {
        const messages:
            readonly ModelMessage[] =
            [
                {
                    role:
                        "system",

                    content:
                        "system",
                },

                {
                    role:
                        "user",

                    content:
                        "task",
                },

                {
                    role:
                        "assistant",

                    content:
                        "",

                    toolCalls: [
                        {
                            id:
                                "old_call",

                            name:
                                "read_file",

                            input: {
                                path:
                                    "old.ts",
                            },
                        },
                    ],

                    providerData:
                        null,
                },

                {
                    role:
                        "tool",

                    toolCallId:
                        "old_call",

                    toolName:
                        "read_file",

                    content:
                        "x".repeat(
                            20_000,
                        ),

                    isError:
                        false,
                },

                {
                    role:
                        "assistant",

                    content:
                        "",

                    toolCalls: [
                        {
                            id:
                                "new_call",

                            name:
                                "read_file",

                            input: {
                                path:
                                    "new.ts",
                            },
                        },
                    ],

                    providerData:
                        null,
                },

                {
                    role:
                        "tool",

                    toolCallId:
                        "new_call",

                    toolName:
                        "read_file",

                    content:
                        "current",

                    isError:
                        false,
                },
            ];

        const result =
            await manager(
                300,
            ).build(
                {
                    messages,

                    tools,
                },

                new AbortController()
                    .signal,
            );

        expect(
            result.ok,
        ).toBe(true);

        if (!result.ok) {
            throw new Error();
        }

        const serialized =
            JSON.stringify(
                result.result
                    .messages,
            );

        expect(
            serialized.includes(
                "old_call",
            ),
        ).toBe(false);

        expect(
            serialized.includes(
                "new_call",
            ),
        ).toBe(true);
    },
);
it(
    "fails closed when pinned context alone exceeds the budget",
    async () => {
        const result =
            await manager(
                100,
            ).build(
                {
                    messages: [
                        {
                            role:
                                "system",

                            content:
                                "system",
                        },

                        {
                            role:
                                "user",

                            content:
                                "x".repeat(
                                    10_000,
                                ),
                        },
                    ],

                    tools: [],
                },

                new AbortController()
                    .signal,
            );

        expect(
            result,
        ).toMatchObject({
            ok:
                false,

            error: {
                code:
                    "context_overflow",

                limit:
                    100,
            },
        });
    },
);
it(
    "counts tool definitions against the context budget",
    async () => {
        const hugeTool = {
            name:
                "huge_tool",

            description:
                "x".repeat(
                    10_000,
                ),

            inputSchema: {
                type:
                    "object",
            },
        } as const;

        const result =
            await manager(
                200,
            ).build(
                {
                    messages: [
                        {
                            role:
                                "system",

                            content:
                                "system",
                        },
                    ],

                    tools: [
                        hugeTool,
                    ],
                },

                new AbortController()
                    .signal,
            );

        expect(
            result.ok,
        ).toBe(false);
    },
);
