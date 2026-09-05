import { createAgentState } from "./core/agent/create-agent-state.js";

const state = createAgentState({
    maxTurns: 40,
    maxToolCalls: 200,
    maxTotalTokens: null,
});

console.log("Agent CLI");

console.dir(
    state,
    {
        depth: null,
    },
);