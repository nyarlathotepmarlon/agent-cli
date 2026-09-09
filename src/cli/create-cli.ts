import { resolve } from "node:path";

import { Command } from "commander";

import type {
    AgentApplication,
    AgentRunResult,
} from "../application/agent-application.js";

import {
    isInteractiveTerminal,
    type CliIo,
} from "./cli-io.js";
import type {
    ModelSelection,
} from "../application/model-resolver.js";

import {
    CliExitSignal,
} from "./cli-exit-signal.js";

import {
    ExitCode,
    type ExitCode as ExitCodeValue,
} from "./exit-code.js";
/**
 * 创建cli所需要的所有外部依赖
 */
export interface CreateCliDependencies {
    readonly application:
        AgentApplication;

    readonly io: CliIo;

    readonly signal: AbortSignal;

    readonly version: string;

    readonly initialCwd: string;

    readonly defaultModelSelection: ModelSelection;
}

interface CliOptions {
    readonly cwd: string;

    readonly interactive: boolean;

    readonly provider: string;

    readonly model: string;
}

export function createCli(
    dependencies: CreateCliDependencies,
): Command {
    // 创建Commander对象
    const program = new Command();

    program
        // 设置cli的名字，会生成在帮助信息Usage: agent [options] [prompt...]
        .name("agent")
        // 会在agent --help中出现
        .description(
            "A production-grade coding agent",
        )
        .version(dependencies.version)
        // <argument>代表必填参数，[argument]代表可选参数，...表示可以接受多个值
        .argument(
            "[prompt...]",
            "task for the coding agent",
        )
        // 支持两种形式-C <path>以及--cwd <path>
        .option(
            "-C, --cwd <path>",
            "working directory",
            ".",
        )
        .option(
            "--no-interactive",
            "disable interactive prompts and confirmations",
        )
        .option(
            "--provider <provider>",
            "model provider",
            dependencies
                .defaultModelSelection
                .provider,
        )
        .option(
            "-m, --model <model>",
            "model id",
            dependencies
                .defaultModelSelection
                .model,
        )
        .showHelpAfterError(
            "(run with --help for usage)",
        )
        // Commander的输出配置
        .configureOutput({
            writeOut: (text) => {
                dependencies.io.writeOut(text);
            },

            writeErr: (text) => {
                dependencies.io.writeErr(text);
            },
        })
        //防止argument error直接导致整个程序失败
        .exitOverride()
        .action(
            async (
                promptParts://来自argument("[prompt...]")
                    | string[]
                    | undefined,

                options: CliOptions,
            ): Promise<void> => {
                dependencies.signal
                    .throwIfAborted();

                const prompt =
                    normalizePrompt(
                        promptParts,
                    );
                //解析工作区的绝对路径，如果options.cwd是绝对路径，直接覆盖initialCwd
                const cwd = resolve(
                    dependencies.initialCwd,
                    options.cwd,
                );
                //interactive要满足两个条件：1.用户没有关闭，2.终端本身支持interactive
                const mode =
                    options.interactive &&
                    isInteractiveTerminal(
                        dependencies.io,
                    )
                        ? "interactive"
                        : "non-interactive";

                const result =
                    // 进入Application Layer
                    await dependencies.application.run(
                        {
                            prompt,
                            cwd,
                            mode,
                            model: {
                                provider:
                                options.provider,

                                model:
                                options.model,
                            },
                            signal:
                            dependencies.signal,

                        },
                    );
                // 将Agent运行结果转为退出码
                const exitCode =
                    renderAgentRunResult(
                        result,
                        dependencies.io,
                    );

                if (
                    exitCode !==
                    ExitCode.Success
                ) {
                    throw new CliExitSignal(
                        exitCode,
                    );
                }
            },
        );

    return program;
}

/**
 * 将promptParts组合成为完整的prompt
 * @param parts promptParts
 */
function normalizePrompt(
    parts:
        | readonly string[]
        | undefined,
): string | null {
    if (
        parts === undefined ||
        parts.length === 0
    ) {
        return null;
    }

    const prompt =
        parts.join(" ").trim();

    return prompt.length === 0
        ? null
        : prompt;
}



function renderAgentRunResult(
    result: AgentRunResult,
    io: CliIo,
): ExitCodeValue {
    // 根据agent运行结果的状态向io流写入对应的内容
    switch (result.status) {
        case "awaiting_input":
            io.writeOut(
                [
                    "Agent is ready.",

                    `Workspace: ${result.cwd}`,

                    `Model: ${result.model.provider}/${result.model.id}`,

                    "Interactive REPL will be added in a later phase; provide a task as an argument for now.",

                    "",
                ].join("\n"),
            );

            return ExitCode.Success;

        case "completed":
            writeAssistantOutput(
                result.output,
                io,
            );

            return ExitCode.Success;

        case "stopped":
            if (
                result.output !== null &&
                result.output.length > 0
            ) {
                writeAssistantOutput(
                    result.output,
                    io,
                );
            }

            io.writeErr(
                `agent: stopped: ${formatStopReason(
                    result.state
                        .stopReason,
                )}\n`,
            );

            return ExitCode.Failure;

        case "cancelled":
            io.writeErr(
                "agent: interrupted\n",
            );

            return ExitCode.Interrupted;

        case "failed":
            if (
                result.output !== null &&
                result.output.length > 0
            ) {
                writeAssistantOutput(
                    result.output,
                    io,
                );
            }

            io.writeErr(
                `agent: failed: ${result.state.stopReason.message}\n`,
            );

            return ExitCode.Failure;
    }
}

function writeAssistantOutput(
    output: string,
    io: CliIo,
): void {
    if (output.endsWith("\n")) {
        io.writeOut(
            output,
        );

        return;
    }

    io.writeOut(
        `${output}\n`,
    );
}

function formatStopReason(
    reason:
    import("../core/agent/stop-reason.js")
        .ControlledStopReason,
): string {
    switch (reason.kind) {
        case "max_turns":
            return `maximum model turns reached (${reason.used}/${reason.limit})`;

        case "max_tool_calls":
            return `maximum tool calls reached (${reason.used}/${reason.limit})`;

        case "max_total_tokens":
            return `token budget reached (${reason.used}/${reason.limit})`;

        case "max_output_tokens":
            return "model reached its output token limit";

        case "content_filter":
            return "model output was stopped by a content filter";

        case "model_refused":
            return "model refused the request";

        case "unknown_model_finish_reason":
            return `unknown model finish reason: ${reason.finishReason}`;
    }
}