import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";

import {
    mkdtemp,
    rm,
} from "node:fs/promises";

import {
    tmpdir,
} from "node:os";

import * as path
    from "node:path";

import {
    NodeProcessRunner,
} from "../../../src/infrastructure/process/node-process-runner.js";

let root:
    string;

let runner:
    NodeProcessRunner;

function signal():
    AbortSignal {
    return new AbortController()
        .signal;
}

beforeEach(
    async () => {
        root =
            await mkdtemp(
                path.join(
                    tmpdir(),
                    "agent-cli-process-",
                ),
            );

        runner =
            await NodeProcessRunner
                .create(
                    root,
                    signal(),
                );
    },
);

afterEach(
    async () => {
        await rm(
            root,
            {
                recursive:
                    true,

                force:
                    true,
            },
        );
    },
);

describe(
    "NodeProcessRunner",
    () => {
        it(
            "captures stdout stderr and exit code",
            async () => {
                const result =
                    await runner.run(
                        {
                            command:
                            process.execPath,

                            args: [
                                "-e",

                                [
                                    "process.stdout.write('out');",
                                    "process.stderr.write('err');",
                                    "process.exit(7);",
                                ].join(
                                    "",
                                ),
                            ],

                            cwd:
                                ".",

                            stdin:
                                null,

                            timeoutMs:
                                5_000,

                            maxOutputBytes:
                                64 * 1024,
                        },

                        signal(),
                    );

                expect(
                    result.ok,
                ).toBe(true);

                if (!result.ok) {
                    throw new Error(
                        "expected process result",
                    );
                }

                expect(
                    result.result
                        .exitCode,
                ).toBe(7);

                expect(
                    result.result
                        .stdout,
                ).toBe(
                    "out",
                );

                expect(
                    result.result
                        .stderr,
                ).toBe(
                    "err",
                );

                expect(
                    result.result
                        .termination,
                ).toBe(
                    "exited",
                );
            },
        );
    },
);
it(
    "passes shell metacharacters as literal arguments",
    async () => {
        const suspicious =
            "hello && echo PWNED";

        const result =
            await runner.run(
                {
                    command:
                    process.execPath,

                    args: [
                        "-e",

                        "process.stdout.write(process.argv[1])",

                        suspicious,
                    ],

                    cwd:
                        ".",

                    stdin:
                        null,

                    timeoutMs:
                        5_000,

                    maxOutputBytes:
                        64 * 1024,
                },

                signal(),
            );

        expect(
            result.ok,
        ).toBe(true);

        if (!result.ok) {
            throw new Error(
                "expected process result",
            );
        }

        expect(
            result.result
                .stdout,
        ).toBe(
            suspicious,
        );
    },
);
it(
    "bounds captured output",
    async () => {
        const result =
            await runner.run(
                {
                    command:
                    process.execPath,

                    args: [
                        "-e",

                        "process.stdout.write('x'.repeat(100000));",
                    ],

                    cwd:
                        ".",

                    stdin:
                        null,

                    timeoutMs:
                        5_000,

                    maxOutputBytes:
                        1024,
                },

                signal(),
            );

        expect(
            result.ok,
        ).toBe(true);

        if (!result.ok) {
            throw new Error();
        }

        expect(
            result.result
                .stdoutTruncated,
        ).toBe(true);

        expect(
            result.result
                .stdoutBytes,
        ).toBe(
            100_000,
        );

        expect(
            result.result
                .stdout.length,
        ).toBeLessThan(
            2_000,
        );
    },
);

it(
    "terminates a process after timeout",
    async () => {
        const result =
            await runner.run(
                {
                    command:
                    process.execPath,

                    args: [
                        "-e",

                        "setInterval(() => {}, 1000);",
                    ],

                    cwd:
                        ".",

                    stdin:
                        null,

                    timeoutMs:
                        100,

                    maxOutputBytes:
                        1024,
                },

                signal(),
            );

        expect(
            result.ok,
        ).toBe(true);

        if (!result.ok) {
            throw new Error();
        }

        expect(
            result.result
                .termination,
        ).toBe(
            "timed_out",
        );
    },
);
it(
    "propagates external cancellation",
    async () => {
        const controller =
            new AbortController();

        const promise =
            runner.run(
                {
                    command:
                    process.execPath,

                    args: [
                        "-e",

                        "setInterval(() => {}, 1000);",
                    ],

                    cwd:
                        ".",

                    stdin:
                        null,

                    timeoutMs:
                        60_000,

                    maxOutputBytes:
                        1024,
                },

                controller.signal,
            );

        setTimeout(
            () => {
                controller.abort(
                    new Error(
                        "user cancelled",
                    ),
                );
            },

            50,
        );

        await expect(
            promise,
        ).rejects.toThrow(
            "user cancelled",
        );
    },
);

it(
    "rejects cwd outside the workspace",
    async () => {
        const result =
            await runner.run(
                {
                    command:
                    process.execPath,

                    args: [
                        "--version",
                    ],

                    cwd:
                        "..",

                    stdin:
                        null,

                    timeoutMs:
                        5_000,

                    maxOutputBytes:
                        1024,
                },

                signal(),
            );

        expect(
            result,
        ).toMatchObject({
            ok:
                false,

            error: {
                code:
                    "invalid_cwd",
            },
        });
    },
);
it.runIf(
    process.platform ===
    "win32",
)(
    "runs Windows command shims",
    async () => {
        const result =
            await runner.run(
                {
                    command:
                        "npm",

                    args: [
                        "--version",
                    ],

                    cwd:
                        ".",

                    stdin:
                        null,

                    timeoutMs:
                        10_000,

                    maxOutputBytes:
                        1024,
                },

                signal(),
            );

        expect(
            result.ok,
        ).toBe(true);
    },
);