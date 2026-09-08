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
import {ModelRegistry} from "./infrastructure/model/model-registry.js";
import {OpenAIModelProvider} from "./infrastructure/model/openai/openai-model-provider.js";

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
    const modelRegistry =
        new ModelRegistry([
            new OpenAIModelProvider({
                apiKey:
                    readEnvironmentVariable(
                        "OPENAI_API_KEY",
                    ),

                baseURL:
                    readEnvironmentVariable(
                        "OPENAI_BASE_URL",
                    ),

                timeoutMs:
                    readPositiveInteger(
                        process.env[
                            "AGENT_MODEL_TIMEOUT_MS"
                            ],
                        120_000,
                    ),
            }),
        ]);
    const application =
        new DefaultAgentApplication({
            maxTurns: 40,

            maxToolCalls: 200,

            maxTotalTokens: null,
        }, modelRegistry);

    const exitCode =
        await runCli(
            process.argv,
            {
                application,

                io: createNodeCliIo(),

                signal:
                controller.signal,

                version,
                defaultModelSelection: {
                    provider:
                        readEnvironmentVariable(
                            "AGENT_PROVIDER",
                        ) ??
                        "openai",

                    model:
                        readEnvironmentVariable(
                            "AGENT_MODEL",
                        ) ??
                        "gpt-5.5",
                },
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

function readEnvironmentVariable(
    name: string,
): string | null {
    const value =
        process.env[name];

    if (value === undefined) {
        return null;
    }

    const trimmed =
        value.trim();

    return trimmed.length === 0
        ? null
        : trimmed;
}

function readPositiveInteger(
    value: string | undefined,
    fallback: number,
): number {
    if (value === undefined) {
        return fallback;
    }

    const parsed =
        Number(value);

    if (
        !Number.isSafeInteger(
            parsed,
        ) ||
        parsed <= 0
    ) {
        throw new Error(
            `Expected positive integer, received: ${value}`,
        );
    }

    return parsed;
}