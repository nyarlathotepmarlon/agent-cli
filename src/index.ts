#!/usr/bin/env node

import {
    DefaultAgentApplication,
} from "./application/agent-application.js";

import {
    ExitCode,
} from "./cli/exit-code.js";

import {
    createNodeCliIo,
} from "./cli/node-cli-io.js";

import {
    readPackageVersion,
} from "./cli/package-version.js";

import {
    runCli,
} from "./cli/run-cli.js";

const controller =
    new AbortController();
// 记录中断次数
let interruptCount = 0;

/**
 * sigint处理函数
 */
function handleSigint(): void {
    interruptCount += 1;

    if (interruptCount === 1) {
        controller.abort();

        return;
    }
    // 当用户按Ctr+C不止一次，将会强制退出程序
    process.exit(
        ExitCode.Interrupted,
    );
}
// 注册sigint监听器
process.on(
    "SIGINT",
    handleSigint,
);

try {
    const version =
        await readPackageVersion();

    const application =
        new DefaultAgentApplication({
            maxTurns: 40,

            maxToolCalls: 200,

            maxTotalTokens: null,
        });

    const exitCode =
        await runCli(
            process.argv,
            {
                application,

                io: createNodeCliIo(),

                signal:
                controller.signal,

                version,

                initialCwd:
                    process.cwd(),
            },
        );

    process.exitCode =
        exitCode;
} catch (error) {
    const message =
        error instanceof Error
            ? error.message
            : String(error);

    process.stderr.write(
        `agent: failed to start: ${message}\n`,
    );

    process.exitCode =
        ExitCode.Failure;
} finally {
    process.off(
        "SIGINT",
        handleSigint,
    );
}