import type { IdleAgentState } from "./agent-state.js";
import {
    createExecutionBudget,
    type ExecutionBudgetLimits,
} from "./execution-budget.js";
import type {ModelMessage} from "../model/model-message.js";

export function createAgentState(
    limits: ExecutionBudgetLimits,
    messages:
    readonly ModelMessage[] = [],//初始状态要传入system message以及user message
): IdleAgentState {
    return {
        status: "idle",

        messages: [
            ...messages
        ],

        steps: [],

        budget: createExecutionBudget(limits),
    };
}