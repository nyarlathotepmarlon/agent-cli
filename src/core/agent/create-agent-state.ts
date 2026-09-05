import type { IdleAgentState } from "./agent-state.js";
import {
    createExecutionBudget,
    type ExecutionBudgetLimits,
} from "./execution-budget.js";

export function createAgentState(
    limits: ExecutionBudgetLimits,
): IdleAgentState {
    return {
        status: "idle",

        messages: [],

        steps: [],

        budget: createExecutionBudget(limits),
    };
}