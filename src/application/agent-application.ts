import type { IdleAgentState } from "../core/agent/agent-state.js";
import { createAgentState } from "../core/agent/create-agent-state.js";
import type { ExecutionBudgetLimits } from "../core/agent/execution-budget.js";

export type AgentRunMode =
    | "interactive"
    | "non-interactive";

export interface AgentRunRequest {
    readonly prompt: string | null;

    readonly cwd: string;

    readonly mode: AgentRunMode;

    readonly signal: AbortSignal;
}

export interface AgentRunResult {
    readonly status: "prepared";

    readonly prompt: string | null;

    readonly cwd: string;

    readonly mode: AgentRunMode;

    readonly state: IdleAgentState;
}

export interface AgentApplication {
    run(
        request: AgentRunRequest,
    ): Promise<AgentRunResult>;
}

export class DefaultAgentApplication
    implements AgentApplication
{
    public constructor(
        private readonly limits:
        ExecutionBudgetLimits,
    ) {}

    public async run(
        request: AgentRunRequest,
    ): Promise<AgentRunResult> {
        request.signal.throwIfAborted();

        return {
            status: "prepared",

            prompt: request.prompt,

            cwd: request.cwd,

            mode: request.mode,

            state: createAgentState(
                this.limits,
            ),
        };
    }
}