import {
    describe,
    expect,
    it,
} from "vitest";

import {
    createExecutionBudget,
    getBudgetStopReason,
    recordModelUsage,
    recordToolCall,
} from "../../../src/core/agent/execution-budget.js";

describe("execution budget", () => {
    it("tracks model turns and tokens", () => {
        const budget =
            createExecutionBudget({
                maxTurns: 10,
                maxToolCalls: 20,
                maxTotalTokens: 1000,
            });

        const next = recordModelUsage(
            budget,
            {
                inputTokens: 100,
                outputTokens: 50,
            },
        );

        expect(next.usage).toEqual({
            turns: 1,
            toolCalls: 0,
            totalTokens: 150,
        });

        expect(budget.usage.turns).toBe(0);
    });

    it("tracks tool calls", () => {
        const budget =
            createExecutionBudget({
                maxTurns: 10,
                maxToolCalls: 20,
                maxTotalTokens: null,
            });

        const next =
            recordToolCall(budget);

        expect(
            next.usage.toolCalls,
        ).toBe(1);
    });

    it("detects max turns", () => {
        let budget =
            createExecutionBudget({
                maxTurns: 1,
                maxToolCalls: 20,
                maxTotalTokens: null,
            });

        budget = recordModelUsage(
            budget,
            null,
        );

        expect(
            getBudgetStopReason(budget),
        ).toEqual({
            kind: "max_turns",
            limit: 1,
            used: 1,
        });
    });

    it("rejects invalid limits", () => {
        expect(() =>
            createExecutionBudget({
                maxTurns: 0,
                maxToolCalls: 20,
                maxTotalTokens: null,
            }),
        ).toThrow(RangeError);
    });
});