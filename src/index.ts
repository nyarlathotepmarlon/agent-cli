#!/usr/bin/env node

import {
    DefaultAgentRuntime,
} from "./core/agent/agent-runtime.js";

import {
    ExponentialBackoffModelRetryPolicy,
} from "./core/agent/model-retry-policy.js";

import {
    NodeDelay,
} from "./infrastructure/time/node-delay.js";

import {createWorkspaceToolRuntime} from "./infrastructure/tools/create-workspace-tool-runtime.js";
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
import {
    DefaultPermissionAuthorizer,
} from "./core/permissions/default-permission-authorizer.js";

import {
    ModePermissionPolicy,
} from "./core/permissions/mode-permission-policy.js";

import {
    NodePermissionApprover,
} from "./cli/node-permission-approver.js";
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
    const retryPolicy =
        new ExponentialBackoffModelRetryPolicy({
            maxAttempts:
                readPositiveInteger(
                    process.env[
                        "AGENT_MODEL_MAX_ATTEMPTS"
                        ],
                    3,
                ),

            baseDelayMs:
                readPositiveInteger(
                    process.env[
                        "AGENT_MODEL_RETRY_BASE_MS"
                        ],
                    500,
                ),

            maxDelayMs:
                readPositiveInteger(
                    process.env[
                        "AGENT_MODEL_RETRY_MAX_MS"
                        ],
                    5_000,
                ),
        });
    const permissionApprover =
        new NodePermissionApprover();
    const runtime =
        new DefaultAgentRuntime(
            retryPolicy,

            new NodeDelay(),
        );


    const application =
        new DefaultAgentApplication({
            limits: {
                maxTurns: 40,

                maxToolCalls: 200,

                maxTotalTokens:
                    null,
            },

            modelResolver:
            modelRegistry,

            runtime,

            createToolRuntime:async(request)=>{
                const policy =
                    new ModePermissionPolicy(
                        request
                            .permissionMode,
                    );

                const authorizer =
                    new DefaultPermissionAuthorizer(
                        policy,

                        request.mode ===
                        "interactive"
                            ? permissionApprover
                            : null,
                    );

                return createWorkspaceToolRuntime(
                    request.cwd,

                    request.signal,

                    authorizer,
                );
            }
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
                defaultPermissionMode:
                    "safe",
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