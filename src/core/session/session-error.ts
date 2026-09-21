export type SessionErrorCode =
    | "invalid_id"
    | "invalid_event"
    | "not_found"
    | "locked"
    | "corrupt"
    | "unsupported_version"
    | "workspace_mismatch"
    | "unsafe_storage"
    | "session_too_large"
    | "event_too_large"
    | "io_error";

export class SessionError
    extends Error
{
    public override readonly name =
        "SessionError";

    public constructor(
        public readonly code:
        SessionErrorCode,

        message:
        string,

        options?: {
            readonly cause?:
                unknown;
        },
    ) {
        super(
            message,

            options?.cause ===
            undefined
                ? undefined
                : {
                    cause:
                    options
                        .cause,
                },
        );
    }
}