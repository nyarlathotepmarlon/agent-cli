import type { ModelMessage } from "../model/model-message.js";
import type { AgentStep } from "./agent-step.js";
import type {
    ControlledStopReason,
    CancelledStopReason,
    CompletedStopReason,
    FailureStopReason,
} from "./stop-reason.js";
import type { ExecutionBudget } from "./execution-budget.js";

interface AgentStateBase {
    readonly messages: readonly ModelMessage[];

    readonly steps: readonly AgentStep[];

    readonly budget: ExecutionBudget;
}

export interface IdleAgentState
    extends AgentStateBase {
    readonly status: "idle";
}

export interface RunningAgentState
    extends AgentStateBase {
    readonly status: "running";
}

export interface CompletedAgentState
    extends AgentStateBase {
    readonly status: "completed";

    readonly stopReason: CompletedStopReason;
}

export interface StoppedAgentState
    extends AgentStateBase {
    readonly status: "stopped";

    readonly stopReason: ControlledStopReason;
}

export interface CancelledAgentState
    extends AgentStateBase {
    readonly status: "cancelled";

    readonly stopReason: CancelledStopReason;
}

export interface FailedAgentState
    extends AgentStateBase {
    readonly status: "failed";

    readonly stopReason: FailureStopReason;
}

export type TerminalAgentState =
    | CompletedAgentState
    | StoppedAgentState
    | CancelledAgentState
    | FailedAgentState;

export type AgentState =
    | IdleAgentState
    | RunningAgentState
    | TerminalAgentState;