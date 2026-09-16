import {
    z,
} from "zod";

import type {
    ProcessRunner,
    ProcessStartError,
} from "../../core/process/process-runner.js";

import {
    toJsonValue,
} from "../../core/shared/json.js";

import type {
    ToolError,
} from "../../core/tools/tool-error.js";

import {
    defineTool,
} from "./define-tool.js";

export const MAX_COMMAND_OUTPUT_BYTES =
    64 * 1024;

export const MAX_COMMAND_STDIN_CHARS =
    64 * 1024;

export const DEFAULT_COMMAND_TIMEOUT_MS =
    120_000;

export const MAX_COMMAND_TIMEOUT_MS =
    10 * 60_000;

export function createRunCommandTool(
    runner: ProcessRunner,
) {
    return defineTool({
        name:
            "run_command",

        description:
            "Run one non-interactive executable inside the workspace. " +
            "Pass the executable in command and each argument separately in args. " +
            "Do not use shell syntax such as &&, ||, pipes, redirects, or command substitution. " +
            "Use this for tests, builds, linters, typecheckers, and other development commands. " +
            "A non-zero exit code is a normal command result, not a tool failure. " +
            "stdout and stderr are bounded and may be truncated.",

        schema:
            z.strictObject({
                command:
                    z.string()
                        .min(1)
                        .max(
                            1_024,
                        ),

                args:
                    z.array(
                        z.string()
                            .max(
                                8_192,
                            ),
                    )
                        .max(128)
                        .default([]),

                cwd:
                    z.string()
                        .min(1)
                        .max(
                            4_096,
                        )
                        .default("."),

                stdin:
                    z.string()
                        .max(
                            MAX_COMMAND_STDIN_CHARS,
                        )
                        .nullable()
                        .default(
                            null,
                        ),

                timeoutMs:
                    z.number()
                        .int()
                        .min(
                            100,
                        )
                        .max(
                            MAX_COMMAND_TIMEOUT_MS,
                        )
                        .default(
                            DEFAULT_COMMAND_TIMEOUT_MS,
                        ),
            }),

        async execute(
            input,
            context,
        ) {
            const outcome =
                await runner.run(
                    {
                        command:
                        input.command,

                        args:
                        input.args,

                        cwd:
                        input.cwd,

                        stdin:
                        input.stdin,

                        timeoutMs:
                        input
                            .timeoutMs,

                        maxOutputBytes:
                        MAX_COMMAND_OUTPUT_BYTES,
                    },

                    context.signal,
                );

            if (!outcome.ok) {
                return {
                    ok:
                        false,

                    error:
                        mapStartError(
                            outcome.error,
                        ),
                };
            }

            if (
                outcome.result
                    .termination ===
                "timed_out"
            ) {
                return {
                    ok:
                        false,

                    error: {
                        code:
                            "timeout",

                        message:
                            `Command exceeded ${input.timeoutMs}ms timeout`,

                        /*
                         * Arbitrary process execution
                         * may have side effects.
                         *
                         * Therefore timeout does NOT
                         * imply safe automatic retry.
                         */
                        retryable:
                            false,

                        details:
                            {
                                stdout:
                                outcome
                                    .result
                                    .stdout,

                                stderr:
                                outcome
                                    .result
                                    .stderr,

                                stdoutTruncated:
                                outcome
                                    .result
                                    .stdoutTruncated,

                                stderrTruncated:
                                outcome
                                    .result
                                    .stderrTruncated,
                            },
                    },
                };
            }

            return {
                ok:
                    true,

                output:
                    toJsonValue(
                        outcome.result,
                    ),
            };
        },
    });
}

function mapStartError(
    error:
    ProcessStartError,
): ToolError {
    switch (
        error.code
        ) {
        case "invalid_cwd":
            return {
                code:
                    "invalid_input",

                message:
                error.message,

                retryable:
                    false,
            };

        case "not_found":
            return {
                code:
                    "not_found",

                message:
                error.message,

                retryable:
                    false,
            };

        case "permission_denied":
            return {
                code:
                    "permission_denied",

                message:
                error.message,

                retryable:
                    false,
            };

        case "spawn_failed":
            return {
                code:
                    "execution_failed",

                message:
                error.message,

                retryable:
                    false,
            };
    }
}