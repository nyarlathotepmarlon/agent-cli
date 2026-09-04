import type { ModelMessage } from "../model/model.js";

export type AgentStatus =
    | "idle"
    | "running"
    | "completed"
    | "failed"
    | "cancelled";

export interface AgentState {
    readonly status: AgentStatus;
    readonly messages: readonly ModelMessage[];
    readonly turn: number;
}