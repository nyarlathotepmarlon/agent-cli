import type {
    ModelErrorCode,
} from "../model/model-error.js";

import type {
    ModelFinishReason,
} from "../model/model-response.js";

export interface CompletedStopReason {
    readonly kind: "completed";
}


export type BudgetStopReason =
    | {
    readonly kind: "max_turns";
    readonly limit: number;
    readonly used: number;
}
    | {
    readonly kind: "max_tool_calls";
    readonly limit: number;
    readonly used: number;
}
    | {
    readonly kind: "max_total_tokens";
    readonly limit: number;
    readonly used: number;
};
export type ModelStopReason =
    | {
    readonly kind: "max_output_tokens";
}
    | {
    readonly kind: "content_filter";
}
    | {
    readonly kind: "model_refused";
}
    | {
    readonly kind: "unknown_model_finish_reason";

    readonly finishReason:
        ModelFinishReason;
};
export interface ContextOverflowStopReason {
    readonly kind:
        "context_overflow";

    readonly limit:
        number;

    readonly estimated:
        number;

    readonly pinnedEstimatedTokens:
        number;
}
export type ControlledStopReason =
    | BudgetStopReason
    | ModelStopReason
    | ContextOverflowStopReason
export interface CancelledStopReason {
    readonly kind: "cancelled";
    readonly reason: string | null;
}

export type FailureStopReason =
    | {
    readonly kind: "model_error";

    readonly code:
        ModelErrorCode;

    readonly provider:
        string;

    readonly message:
        string;

    readonly retryable:
        boolean;

    readonly status:
        number | null;

    readonly requestId:
        string | null;

    readonly attempts:
        number;
}
    | {
    readonly kind: "runtime_error";

    readonly message: string;
};


export type StopReason =
    | CompletedStopReason
    | ControlledStopReason
    | CancelledStopReason
    | FailureStopReason;