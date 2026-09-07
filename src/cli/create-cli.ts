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
}

interface CliOptions {
    readonly cwd: string;

    readonly interactive: boolean;

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
                            signal:
                            dependencies.signal,
                        },
                    );

                renderPreparedRun(
                    result,
                    dependencies.io,
                );
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

/**
 * 渲染Application Layer返回的结果
 * @param result Application Layer返回的结果
 * @param io 实际环境的io
 */
function renderPreparedRun(
    result: AgentRunResult,
    io: CliIo,
): void {
    const task =
        result.prompt === null
            ? "<interactive input>"
            : result.prompt;

    io.writeOut(
        [
            "Agent session prepared.",
            `Workspace: ${result.cwd}`,
            `Mode: ${result.mode}`,
            `Task: ${task}`,
            "",
        ].join("\n"),
    );
}