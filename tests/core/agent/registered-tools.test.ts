import { expect, it, vi } from "vitest";
import { DefaultAgentRuntime } from "../../../src/core/agent/agent-runtime.js";
import { createAgentState } from "../../../src/core/agent/create-agent-state.js";
import { ExponentialBackoffModelRetryPolicy } from "../../../src/core/agent/model-retry-policy.js";
import type { Model } from "../../../src/core/model/model.js";
import type { ModelResponse } from "../../../src/core/model/model-response.js";
import type { ToolCall } from "../../../src/core/tools/tool-call.js";
import { DefaultAgentToolRuntime } from "../../../src/core/tools/default-agent-tool-runtime.js";
import { ToolRegistry } from "../../../src/core/tools/tool-registry.js";
import { NodeDelay } from "../../../src/infrastructure/time/node-delay.js";
import { addIntegersTool } from "../../../src/infrastructure/tools/add-integers-tool.js";

function response(
    toolCalls: readonly ToolCall[] = [],
    content = "",
): ModelResponse {
    return {
        message: {
            role: "assistant",
            content,
            toolCalls,
            providerData: null,
        },
        finishReason: toolCalls.length > 0 ? "tool_calls" : "completed",
        usage: null,
        providerRequestId: null,
    };
}

it("feeds validation errors back and completes after corrected arguments", async () => {
    const generate = vi.fn<Model["generate"]>()
        .mockResolvedValueOnce(response([{
            id: "call_1",
            name: "add_integers",
            input: { a: "2", b: 3 },
        }]))
        .mockImplementationOnce(async (request) => {
            expect(request.messages.at(-1)).toMatchObject({
                role: "tool",
                toolCallId: "call_1",
                toolName: "add_integers",
                isError: true,
            });
            expect(request.messages.at(-1)?.content)
                .toContain('"code":"invalid_input"');

            return response([{
                id: "call_2",
                name: "add_integers",
                input: { a: 2, b: 3 },
            }]);
        })
        .mockImplementationOnce(async (request) => {
            expect(request.messages.at(-1)).toEqual({
                role: "tool",
                toolCallId: "call_2",
                toolName: "add_integers",
                content: '{"sum":5}',
                isError: false,
            });

            return response([], "计算结果是 5。");
        });

    const model: Model = {
        provider: "test",
        id: "scripted",
        generate,
    };

    const runtime = new DefaultAgentRuntime(
        new ExponentialBackoffModelRetryPolicy({
            maxAttempts: 1,
            baseDelayMs: 1,
            maxDelayMs: 1,
        }),
        new NodeDelay(),
    );

    const state = await runtime.run({
        state: createAgentState(
            { maxTurns: 5, maxToolCalls: 5, maxTotalTokens: null },
            [{ role: "user", content: "请使用工具计算 2 + 3。" }],
        ),
        model,
        toolRuntime: new DefaultAgentToolRuntime(
            new ToolRegistry([addIntegersTool]),
        ),
        signal: new AbortController().signal,
    });

    expect(state.status).toBe("completed");
    expect(state.budget.usage).toMatchObject({
        turns: 3,
        toolCalls: 2,
    });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(generate.mock.calls[0]?.[0].tools).toMatchObject([
        { name: "add_integers" },
    ]);
});