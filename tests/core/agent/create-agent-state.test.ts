import { describe, expect, it } from "vitest";

import { createAgentState } from "../../../src/core/agent/create-agent-state.js";

describe("createAgentState", () => {
    it("creates an idle agent state", () => {
        const state = createAgentState();

        expect(state).toEqual({
            status: "idle",
            messages: [],
            turn: 0,
        });
    });
});