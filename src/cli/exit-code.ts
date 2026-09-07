export const ExitCode = {
    Success: 0,

    Failure: 1,

    Usage: 2,

    Interrupted: 130,
} as const;

export type ExitCode =
    (typeof ExitCode)[keyof typeof ExitCode];