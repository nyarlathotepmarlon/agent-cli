import {
    describe,
    expect,
    it,
} from "vitest";

import {
    DefaultAgentRuntime,
} from "../../../src/core/agent/agent-runtime.js";

import type {
    AgentToolRuntime,
} from "../../../src/core/agent/agent-tool-runtime.js";

import {
    createAgentState,
} from "../../../src/core/agent/create-agent-state.js";

import type {
    Delay,
} from "../../../src/core/agent/delay.js";

import {
    ExponentialBackoffModelRetryPolicy,
} from "../../../src/core/agent/model-retry-policy.js";

import type {
    Model,
    ModelRequest,
} from "../../../src/core/model/model.js";

import {
    ModelError,
} from "../../../src/core/model/model-error.js";

import type {
    ModelResponse,
} from "../../../src/core/model/model-response.js";

import type {
    ToolCall,
} from "../../../src/core/tools/tool-call.js";

import type {
    ToolExecutionContext,
} from "../../../src/core/tools/tool.js";

import type {
    ToolResult,
} from "../../../src/core/tools/tool-result.js";
import {DefaultContextManager} from "../../../src/core/context/default-context-manager.js";
import {HeuristicTokenEstimator} from "../../../src/core/context/token-estimator.js";

const limits = {
    maxTurns: 10,
    maxToolCalls: 10,
    maxTotalTokens: null,
} as const;

class RecordingDelay
    implements Delay
{
    public readonly waits:
        number[] = [];

    public async wait(
        milliseconds: number,
        signal: AbortSignal,
    ): Promise<void> {
        signal.throwIfAborted();

        this.waits.push(
            milliseconds,
        );
    }
}

class ScriptedModel
    implements Model
{
    public readonly provider =
        "test";

    public readonly id =
        "scripted";

    public readonly requests:
        ModelRequest[] = [];

    public constructor(
        private readonly script:
        Array<
            ModelResponse |
            Error
        >,
    ) {}

    public async generate(
        request: ModelRequest,
        signal: AbortSignal,
    ): Promise<ModelResponse> {
        signal.throwIfAborted();

        this.requests.push(
            request,
        );

        const next =
            this.script.shift();

        if (next === undefined) {
            throw new Error(
                "Model script exhausted",
            );
        }

        if (
            next instanceof Error
        ) {
            throw next;
        }

        return next;
    }
}

class ScriptedToolRuntime
    implements AgentToolRuntime
{
    public readonly definitions = [
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
    ] as const;

    public readonly calls:
        ToolCall[] = [];

    public constructor(
        private readonly results:
        ToolResult[],
    ) {}

    public async execute(
        call: ToolCall,
        context: ToolExecutionContext,
    ): Promise<ToolResult> {
        context.signal
            .throwIfAborted();

        this.calls.push(
            call,
        );

        const result =
            this.results.shift();

        if (
            result === undefined
        ) {
            throw new Error(
                "Tool result script exhausted",
            );
        }

        return result;
    }
}
function createContextManager() {
    return new DefaultContextManager(
        new HeuristicTokenEstimator(),

        {
            maxEstimatedInputTokens:
                1_000_000,

            hotTurns:
                4,

            minRetainedTurns:
                1,

            hotAssistantChars:
                100_000,

            hotToolResultChars:
                100_000,

            coldAssistantChars:
                100_000,

            coldToolResultChars:
                100_000,

            emergencyAssistantChars:
                100_000,

            emergencyToolResultChars:
                100_000,
        },
    );
}
function createRuntime(
    delay: Delay =
    new RecordingDelay(),
): DefaultAgentRuntime {
    return new DefaultAgentRuntime(
        new ExponentialBackoffModelRetryPolicy({
            maxAttempts: 3,
            baseDelayMs: 100,
            maxDelayMs: 1000,
        }),

        delay,
        createContextManager(),
    );
}

function response(
    options: {
        readonly content?:
            string;

        readonly toolCalls?:
            readonly ToolCall[];

        readonly finishReason?:
            ModelResponse["finishReason"];
    } = {},
): ModelResponse {
    const toolCalls =
        options.toolCalls ??
        [];

    return {
        message: {
            role:
                "assistant",

            content:
                options.content ??
                "",

            toolCalls,

            providerData:
                null,
        },

        finishReason:
            options.finishReason ??
            (
                toolCalls.length > 0
                    ? "tool_calls"
                    : "completed"
            ),

        usage: {
            inputTokens: 10,
            outputTokens: 5,
        },

        providerRequestId:
            null,
    };
}

function initialState() {
    return createAgentState(
        limits,

        [
            {
                role:
                    "user",

                content:
                    "Do the task",
            },
        ],
    );
}

describe(
    "DefaultAgentRuntime",
    () => {
        it(
            "completes after a final model response",
            async () => {
                const model =
                    new ScriptedModel([
                        response({
                            content:
                                "Done",
                        }),
                    ]);

                const runtime =
                    createRuntime();

                const state =
                    await runtime.run(
                        {
                            state:
                                initialState(),

                            model,

                            toolRuntime:
                                new ScriptedToolRuntime(
                                    [],
                                ),

                            signal:
                            new AbortController()
                                .signal,
                        },
                    );

                expect(
                    state.status,
                ).toBe(
                    "completed",
                );

                expect(
                    state.budget
                        .usage
                        .turns,
                ).toBe(1);
            },
        );

        it(
            "executes a tool and feeds the result into the next model turn",
            async () => {
                const model =
                    new ScriptedModel([
                        response({
                            toolCalls: [
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
                            ],
                        }),

                        response({
                            content:
                                "I inspected the file.",
                        }),
                    ]);

                const tools =
                    new ScriptedToolRuntime([
                        {
                            ok:
                                true,

                            output: {
                                content:
                                    "console.log('hello')",
                            },
                        },
                    ]);

                const state =
                    await createRuntime()
                        .run({
                            state:
                                initialState(),

                            model,

                            toolRuntime:
                            tools,

                            signal:
                            new AbortController()
                                .signal,
                        });

                expect(
                    state.status,
                ).toBe(
                    "completed",
                );

                expect(
                    model.requests,
                ).toHaveLength(2);

                expect(
                    tools.calls,
                ).toHaveLength(1);

                expect(
                    model.requests[1]
                        ?.messages
                        .at(-1),
                ).toEqual({
                    role:
                        "tool",

                    toolCallId:
                        "call_1",

                    toolName:
                        "read_file",

                    content:
                        '{"content":"console.log(\'hello\')"}',

                    isError:
                        false,
                });

                expect(
                    state.budget
                        .usage,
                ).toEqual({
                    turns:
                        2,

                    toolCalls:
                        1,

                    totalTokens:
                        30,
                });
            },
        );

        it(
            "treats a tool failure as an observation",
            async () => {
                const model =
                    new ScriptedModel([
                        response({
                            toolCalls: [
                                {
                                    id:
                                        "call_1",

                                    name:
                                        "read_file",

                                    input: {
                                        path:
                                            "missing.ts",
                                    },
                                },
                            ],
                        }),

                        response({
                            content:
                                "The file does not exist.",
                        }),
                    ]);

                const tools =
                    new ScriptedToolRuntime([
                        {
                            ok:
                                false,

                            error: {
                                code:
                                    "not_found",

                                message:
                                    "File not found",

                                retryable:
                                    false,
                            },
                        },
                    ]);

                const state =
                    await createRuntime()
                        .run({
                            state:
                                initialState(),

                            model,

                            toolRuntime:
                            tools,

                            signal:
                            new AbortController()
                                .signal,
                        });

                expect(
                    state.status,
                ).toBe(
                    "completed",
                );

                expect(
                    model.requests[1]
                        ?.messages
                        .at(-1),
                ).toMatchObject({
                    role:
                        "tool",

                    isError:
                        true,
                });
            },
        );

        it(
            "retries retryable model errors",
            async () => {
                const delay =
                    new RecordingDelay();

                const model =
                    new ScriptedModel([
                        new ModelError(
                            "rate limited",
                            {
                                code:
                                    "rate_limit",

                                provider:
                                    "test",

                                retryable:
                                    true,

                                status:
                                    429,

                                requestId:
                                    "req_1",
                            },
                        ),

                        response({
                            content:
                                "Done",
                        }),
                    ]);

                const state =
                    await createRuntime(
                        delay,
                    ).run({
                        state:
                            initialState(),

                        model,

                        toolRuntime:
                            new ScriptedToolRuntime(
                                [],
                            ),

                        signal:
                        new AbortController()
                            .signal,
                    });

                expect(
                    state.status,
                ).toBe(
                    "completed",
                );

                expect(
                    model.requests,
                ).toHaveLength(
                    2,
                );

                expect(
                    delay.waits,
                ).toEqual([
                    100,
                ]);

                /*
                 * retry attempt
                 * != successful agent turn
                 */
                expect(
                    state.budget
                        .usage
                        .turns,
                ).toBe(1);
            },
        );

        it(
            "fails after retry attempts are exhausted",
            async () => {
                const delay =
                    new RecordingDelay();

                const error =
                    () =>
                        new ModelError(
                            "server error",
                            {
                                code:
                                    "server_error",

                                provider:
                                    "test",

                                retryable:
                                    true,

                                status:
                                    503,

                                requestId:
                                    null,
                            },
                        );

                const model =
                    new ScriptedModel([
                        error(),
                        error(),
                        error(),
                    ]);

                const state =
                    await createRuntime(
                        delay,
                    ).run({
                        state:
                            initialState(),

                        model,

                        toolRuntime:
                            new ScriptedToolRuntime(
                                [],
                            ),

                        signal:
                        new AbortController()
                            .signal,
                    });

                expect(
                    state.status,
                ).toBe(
                    "failed",
                );

                if (
                    state.status !==
                    "failed"
                ) {
                    throw new Error(
                        "expected failed state",
                    );
                }

                expect(
                    state.stopReason,
                ).toMatchObject({
                    kind:
                        "model_error",

                    code:
                        "server_error",

                    attempts:
                        3,
                });

                expect(
                    delay.waits,
                ).toEqual([
                    100,
                    200,
                ]);
            },
        );
    },
);

it(
    "does not execute tools after the turn budget is exhausted",
    async () => {
        const model =
            new ScriptedModel([
                response({
                    toolCalls: [
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
                    ],
                }),
            ]);

        const tools =
            new ScriptedToolRuntime([
                {
                    ok:
                        true,

                    output:
                        "never executed",
                },
            ]);

        const state =
            await createRuntime()
                .run({
                    state:
                        createAgentState(
                            {
                                maxTurns: 1,

                                maxToolCalls: 10,

                                maxTotalTokens:
                                    null,
                            },

                            [
                                {
                                    role:
                                        "user",

                                    content:
                                        "task",
                                },
                            ],
                        ),

                    model,

                    toolRuntime:
                    tools,

                    signal:
                    new AbortController()
                        .signal,
                });

        expect(
            state.status,
        ).toBe(
            "stopped",
        );

        expect(
            tools.calls,
        ).toHaveLength(0);
    },
);

it(
    "fails when finishReason and tool calls disagree",
    async () => {
        const model =
            new ScriptedModel([
                response({
                    finishReason:
                        "tool_calls",

                    toolCalls:
                        [],
                }),
            ]);

        const state =
            await createRuntime()
                .run({
                    state:
                        initialState(),

                    model,

                    toolRuntime:
                        new ScriptedToolRuntime(
                            [],
                        ),

                    signal:
                    new AbortController()
                        .signal,
                });

        expect(
            state.status,
        ).toBe(
            "failed",
        );

        if (
            state.status ===
            "failed"
        ) {
            expect(
                state.stopReason.kind,
            ).toBe(
                "runtime_error",
            );
        }
    },
);