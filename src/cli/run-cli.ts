import {
    CommanderError,
} from "commander";

import {
    createCli,
    type CreateCliDependencies,
} from "./create-cli.js";

import {
    ExitCode,
    type ExitCode as ExitCodeValue,
} from "./exit-code.js";

export async function runCli(
    argv: readonly string[],
    dependencies:
    CreateCliDependencies,
): Promise<ExitCodeValue> {
    const cli =
        createCli(dependencies);

    try {
        await cli.parseAsync(
            [...argv],
            // 参数来自的风格
            {
                from: "node",
            },
        );

        return ExitCode.Success;
    } catch (error) {
        // 错误来自用户输入
        if (
            error instanceof
            CommanderError
        ) {
            // Commander某些正常控制流也可能表现为CommanderError，比如agent --help
            if (error.exitCode === 0) {
                return ExitCode.Success;
            }

            return ExitCode.Usage;
        }
        // 错误来自程序本身
        if (
            // 两种中断检查
            dependencies.signal.aborted ||
            isAbortError(error)
        ) {
            return ExitCode.Interrupted;
        }

        dependencies.io.writeErr(
            `agent: ${getErrorMessage(error)}\n`,
        );

        return ExitCode.Failure;
    }
}

function isAbortError(
    error: unknown,
): boolean {
    if (
        typeof error !== "object" ||
        error === null ||
        !("name" in error)
    ) {
        return false;
    }

    return error.name === "AbortError";
}

function getErrorMessage(
    error: unknown,
): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}