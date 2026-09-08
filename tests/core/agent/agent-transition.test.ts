import {
    describe,
    expect,
    it,
} from "vitest";

import { createAgentState } from "../../../src/core/agent/create-agent-state.js";

import {
    completeAgent,
    recordModelResponse,
    recordToolResult,
    startAgent,
} from "../../../src/core/agent/agent-transition.js";

describe("agent transitions", () => {
    it("transitions from idle to running", () => {
        const idle = createAgentState({
            maxTurns: 20,
            maxToolCalls: 100,
            maxTotalTokens: 100_000,
        });

        const running = startAgent(idle);

        expect(running.status).toBe(
            "running",
        );

        expect(idle.status).toBe("idle");
    });

    it("records a model response", () => {
        const idle = createAgentState({
            maxTurns: 20,
            maxToolCalls: 100,
            maxTotalTokens: 100_000,
        });

        const running = startAgent(idle);

        const next = recordModelResponse(
            running,
            {
                message: {
                    role: "assistant",
                    content:
                        "I need to inspect the file.",
                    toolCalls: [
                        {
                            id: "call_1",
                            name: "read_file",
                            input: {
                                path: "src/index.ts",
                            },
                        },
                    ],
                    providerData:null,
                },

                finishReason: "tool_calls",

                usage: {
                    inputTokens: 100,
                    outputTokens: 20,
                },
                providerRequestId:null
            },
        );

        expect(
            next.budget.usage.turns,
        ).toBe(1);

        expect(
            next.budget.usage.totalTokens,
        ).toBe(120);

        expect(next.steps).toHaveLength(1);

        expect(next.messages).toHaveLength(
            1,
        );
    });

    it("records a tool result", () => {
        const idle = createAgentState({
            maxTurns: 20,
            maxToolCalls: 100,
            maxTotalTokens: 100_000,
        });

        const running = startAgent(idle);

        const afterModel =
            recordModelResponse(running, {
                message: {
                    role: "assistant",
                    content: "",
                    toolCalls: [
                        {
                            id: "call_1",
                            name: "read_file",
                            input: {
                                path: "src/index.ts",
                            },
                        },
                    ],
                    providerData:null
                },

                finishReason: "tool_calls",

                usage: {
                    inputTokens: 100,
                    outputTokens: 20,
                },
                providerRequestId:null,
            });

        const afterTool =
            recordToolResult(
                afterModel,

                {
                    id: "call_1",
                    name: "read_file",
                    input: {
                        path: "src/index.ts",
                    },
                },

                {
                    ok: true,
                    output: {
                        content:
                            "console.log('hello')",
                    },
                },
            );

        expect(
            afterTool.budget.usage.toolCalls,
        ).toBe(1);

        expect(afterTool.steps).toHaveLength(
            2,
        );

        expect(
            afterTool.messages.at(-1),
        ).toEqual({
            role: "tool",
            toolCallId: "call_1",
            toolName: "read_file",
            content:
                '{"content":"console.log(\'hello\')"}',
            isError: false,
        });
    });

    it("completes a running agent", () => {
        const running = startAgent(
            createAgentState({
                maxTurns: 20,
                maxToolCalls: 100,
                maxTotalTokens: 100_000,
            }),
        );

        const completed =
            completeAgent(running);

        expect(completed.status).toBe(
            "completed",
        );

        expect(completed.stopReason).toEqual(
            {
                kind: "completed",
            },
        );
    });
});