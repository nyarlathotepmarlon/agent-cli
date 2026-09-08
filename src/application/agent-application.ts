import type {
    IdleAgentState,
} from "../core/agent/agent-state.js";

import {
    createAgentState,
} from "../core/agent/create-agent-state.js";

import type {
    ExecutionBudgetLimits,
} from "../core/agent/execution-budget.js";

import type {
    ModelResolver,
    ModelSelection,
} from "./model-resolver.js";

export type AgentRunMode =
    | "interactive"
    | "non-interactive";

export interface AgentRunRequest {
    readonly prompt: string | null;

    readonly cwd: string;

    readonly mode: AgentRunMode;

    readonly model:
        ModelSelection;

    readonly signal: AbortSignal;
}

export interface AgentRunResult {
    readonly status: "prepared";

    readonly prompt: string | null;

    readonly cwd: string;

    readonly mode: AgentRunMode;

    readonly model: {
        readonly provider: string;

        readonly id: string;
    };

    readonly state:
        IdleAgentState;
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

        private readonly modelResolver:
        ModelResolver,
    ) {}

    public async run(
        request: AgentRunRequest,
    ): Promise<AgentRunResult> {
        request.signal
            .throwIfAborted();

        const model =
            this.modelResolver.resolve(
                request.model,
            );

        return {
            status: "prepared",

            prompt:
            request.prompt,

            cwd:
            request.cwd,

            mode:
            request.mode,

            model: {
                provider:
                model.provider,

                id:
                model.id,
            },

            state:
                createAgentState(
                    this.limits,
                ),
        };
    }
}