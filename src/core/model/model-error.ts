export type ModelErrorCode =
    | "invalid_request"
    | "authentication"
    | "permission_denied"
    | "not_found"
    | "conflict"
    | "rate_limit"
    | "timeout"
    | "connection"
    | "server_error"
    | "invalid_response"
    | "unknown";

export interface ModelErrorOptions {
    readonly code:
        ModelErrorCode;

    readonly provider: string;
    //是否可重试
    readonly retryable: boolean;
    // http状态码
    readonly status:
        number | null;

    readonly requestId:
        string | null;

    readonly cause?: unknown;
}

export class ModelError
    extends Error
{
    public override readonly name =
        "ModelError";

    public readonly code:
        ModelErrorCode;

    public readonly provider: string;

    public readonly retryable: boolean;

    public readonly status:
        number | null;

    public readonly requestId:
        string | null;

    public constructor(
        message: string,
        options: ModelErrorOptions,
    ) {
        super(
            message,
            options.cause === undefined
                ? undefined
                : {
                    cause:
                    options.cause,
                },
        );

        this.code =
            options.code;

        this.provider =
            options.provider;

        this.retryable =
            options.retryable;

        this.status =
            options.status;

        this.requestId =
            options.requestId;
    }
}