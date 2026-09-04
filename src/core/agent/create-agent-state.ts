import type { AgentState } from "./agent-state.js";

export function createAgentState(): AgentState {
    return {
        status: "idle",
        messages: [],
        turn: 0,
    };
}