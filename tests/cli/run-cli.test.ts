import {
    resolve,
} from "node:path";

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
            onRun?.(request);

            request.signal
                .throwIfAborted();

            return {
                status: "prepared" as const,

                prompt: request.prompt,

                cwd: request.cwd,

                mode: request.mode,

                state:
                    createAgentState(
                        limits,
                    ),
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

                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd,
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

                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
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

                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
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

                        io: memory.io,

                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
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

                        signal:
                        controller.signal,

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
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

                        version: "1.0.0",

                        initialCwd:
                            process.cwd(),
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