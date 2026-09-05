import {
    describe,
    expect,
    it,
} from "vitest";

import { createAgentState } from "../../../src/core/agent/create-agent-state.js";

describe("createAgentState", () => {
    it("creates an idle state", () => {
        const state = createAgentState({
            maxTurns: 20,
            maxToolCalls: 100,
            maxTotalTokens: 100_000,
        });

        expect(state).toEqual({
            status: "idle",

            messages: [],

            steps: [],

            budget: {
                limits: {
                    maxTurns: 20,
                    maxToolCalls: 100,
                    maxTotalTokens: 100_000,
                },

                usage: {
                    turns: 0,
                    toolCalls: 0,
                    totalTokens: 0,
                },
            },
        });
    });
});