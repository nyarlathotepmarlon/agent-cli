import {
    resolve,
} from "node:path";
import {
    completeAgent,
    startAgent,
} from "../../src/core/agent/agent-transition.js";
import {
    describe,
    expect,
    it,
} from "vitest";

import type {
    AgentApplication,
    AgentRunRequest,
} from "../../src/application/agent-application.js";

import {
    createAgentState,
} from "../../src/core/agent/create-agent-state.js";

import type {
    CliIo,
} from "../../src/cli/cli-io.js";

import {
    ExitCode,
} from "../../src/cli/exit-code.js";

import {
    runCli,
} from "../../src/cli/run-cli.js";

const limits = {
    maxTurns: 10,
    maxToolCalls: 20,
    maxTotalTokens: null,
} as const;

function createMemoryIo(
    inputIsTTY = false,
    outputIsTTY = false,
): {
    readonly io: CliIo;
    readonly out: () => string;
    readonly err: () => string;
} {
    let stdout = "";
    let stderr = "";

    return {
        io: {
            inputIsTTY,
            outputIsTTY,

            writeOut(text: string): void {
                stdout += text;
            },

            writeErr(text: string): void {
                stderr += text;
            },
        },

        out: () => stdout,

        err: () => stderr,
    };
}

function createApplication(
    onRun?: (
        request: AgentRunRequest,
    ) => void,
): AgentApplication {
    return {
        async run(
            request: AgentRunRequest,
        ) {
            onRun?.(
                request,
            );

            request.signal
                .throwIfAborted();

            const state =
                completeAgent(
                    startAgent(
                        createAgentState(
                            limits,
                        ),
                    ),
                );

            return {
                status:
                    "completed" as const,

                prompt:
                request.prompt,

                cwd:
                request.cwd,

                mode:
                request.mode,

                model: {
                    provider:
                    request
                        .model
                        .provider,

                    id:
                    request
                        .model
                        .model,
                },

                state,

                output:
                    "done",
            };
        },
    };
}

describe("runCli", () => {
    it(
        "parses prompt, cwd and interactive mode",
        async () => {
            const memory =
                createMemoryIo(
                    true,
                    true,
                );

            const controller =
                new AbortController();

            const captured: {
                request:
                    | AgentRunRequest
                    | null;
            } = {
                request: null,
            };

            const initialCwd =
                resolve(
                    "workspace-root",
                );

            const exitCode =
                await runCli(
                    [
                        "node",
                        "agent",
                        "-C",
                        "repo",
                        "fix",
                        "login",
                        "bug",
                    ],
                    {
                        application:
                            createApplication(
                                (request) => {
                                    captured.request =
                                        request;
                                },
                            ),

                        io: memory.io,
                        defaultModelSelection: {
                            provider: "openai",
                            model: "gpt-5.5",
                        },
                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd,
                        defaultPermissionMode:
                            "safe",
                    },
                );

            expect(exitCode).toBe(
                ExitCode.Success,
            );

            if (
                captured.request ===
                null
            ) {
                throw new Error(
                    "application was not invoked",
                );
            }

            expect(
                captured.request.prompt,
            ).toBe(
                "fix login bug",
            );

            expect(
                captured.request.cwd,
            ).toBe(
                resolve(
                    initialCwd,
                    "repo",
                ),
            );

            expect(
                captured.request.mode,
            ).toBe(
                "interactive",
            );
        },
    );

    it(
        "forces non-interactive mode",
        async () => {
            const memory =
                createMemoryIo(
                    true,
                    true,
                );

            const controller =
                new AbortController();

            const captured: {
                request:
                    | AgentRunRequest
                    | null;
            } = {
                request: null,
            };

            const exitCode =
                await runCli(
                    [
                        "node",
                        "agent",
                        "--no-interactive",
                        "fix",
                        "tests",
                    ],
                    {
                        application:
                            createApplication(
                                (request) => {
                                    captured.request =
                                        request;
                                },
                            ),

                        io: memory.io,
                        defaultModelSelection: {
                            provider: "openai",
                            model: "gpt-5.5",
                        },
                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
                        defaultPermissionMode:
                            "safe",
                    },
                );

            expect(exitCode).toBe(
                ExitCode.Success,
            );

            if (
                captured.request ===
                null
            ) {
                throw new Error(
                    "application was not invoked",
                );
            }

            expect(
                captured.request.mode,
            ).toBe(
                "non-interactive",
            );
        },
    );

    it(
        "writes help to stdout",
        async () => {
            const memory =
                createMemoryIo();

            const controller =
                new AbortController();

            const exitCode =
                await runCli(
                    [
                        "node",
                        "agent",
                        "--help",
                    ],
                    {
                        application:
                            createApplication(),

                        io: memory.io,
                        defaultModelSelection: {
                            provider: "openai",
                            model: "gpt-5.5",
                        },
                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
                        defaultPermissionMode:
                            "safe",
                    },
                );

            expect(exitCode).toBe(
                ExitCode.Success,
            );

            expect(
                memory.out(),
            ).toContain(
                "Usage: agent",
            );
        },
    );

    it(
        "returns usage error for an unknown option",
        async () => {
            const memory =
                createMemoryIo();

            const controller =
                new AbortController();

            const exitCode =
                await runCli(
                    [
                        "node",
                        "agent",
                        "--unknown",
                    ],
                    {
                        application:
                            createApplication(),
                        defaultModelSelection: {
                            provider: "openai",
                            model: "gpt-5.5",
                        },
                        io: memory.io,

                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
                        defaultPermissionMode:
                            "safe",
                    },
                );

            expect(exitCode).toBe(
                ExitCode.Usage,
            );

            expect(
                memory.err(),
            ).toContain(
                "unknown option",
            );
        },
    );

    it(
        "returns interrupted when aborted",
        async () => {
            const memory =
                createMemoryIo();

            const controller =
                new AbortController();

            controller.abort();

            const exitCode =
                await runCli(
                    [
                        "node",
                        "agent",
                        "fix",
                        "tests",
                    ],
                    {
                        application:
                            createApplication(),

                        io: memory.io,
                        defaultModelSelection: {
                            provider: "openai",
                            model: "gpt-5.5",
                        },
                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
                        defaultPermissionMode:
                            "safe",
                    },
                );

            expect(exitCode).toBe(
                ExitCode.Interrupted,
            );
        },
    );

    it(
        "converts application errors to failure",
        async () => {
            const memory =
                createMemoryIo();

            const controller =
                new AbortController();

            const application:
                AgentApplication = {
                async run() {
                    throw new Error(
                        "boom",
                    );
                },
            };

            const exitCode =
                await runCli(
                    [
                        "node",
                        "agent",
                        "fix",
                        "tests",
                    ],
                    {
                        application,

                        io: memory.io,

                        signal:
                        controller.signal,
                        defaultModelSelection: {
                            provider: "openai",
                            model: "gpt-5.5",
                        },
                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
                        defaultPermissionMode:
                            "safe",
                    },
                );

            expect(exitCode).toBe(
                ExitCode.Failure,
            );

            expect(
                memory.err(),
            ).toContain(
                "agent: boom",
            );
        },
    );
});
it(
    "passes provider and model selection",
    async () => {
        const memory =
            createMemoryIo();

        const controller =
            new AbortController();

        const captured: {
            request:
                AgentRunRequest | null;
        } = {
            request: null,
        };

        const exitCode =
            await runCli(
                [
                    "node",
                    "agent",

                    "--provider",
                    "openai",

                    "--model",
                    "gpt-5.5",

                    "fix",
                    "tests",
                ],
                {
                    application:
                        createApplication(
                            (request) => {
                                captured.request =
                                    request;
                            },
                        ),

                    io:
                    memory.io,

                    signal:
                    controller.signal,

                    version:
                        "1.0.0",

                    initialCwd:
                        process.cwd(),

                    defaultModelSelection: {
                        provider:
                            "openai",

                        model:
                            "default-model",
                    },
                    defaultPermissionMode:
                        "safe",
                },
            );

        expect(
            exitCode,
        ).toBe(
            ExitCode.Success,
        );

        expect(
            captured.request?.model,
        ).toEqual({
            provider:
                "openai",

            model:
                "gpt-5.5",
        });
    },
);