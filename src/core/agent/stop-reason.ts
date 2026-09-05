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

export interface CancelledStopReason {
    readonly kind: "cancelled";
    readonly reason: string | null;
}

export type FailureStopReason =
    | {
    readonly kind: "model_error";
    readonly message: string;
    readonly retryable: boolean;
}
    | {
    readonly kind: "runtime_error";
    readonly message: string;
};

export type StopReason =
    | CompletedStopReason
    | BudgetStopReason
    | CancelledStopReason
    | FailureStopReason;