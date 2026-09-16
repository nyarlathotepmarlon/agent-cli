import type {
    ChildProcess,
} from "node:child_process";

import {
    spawn as nodeSpawn,
} from "node:child_process";

import {
    realpath,
    stat,
} from "node:fs/promises";

import * as path
    from "node:path";

import {
    setTimeout as sleep,
} from "node:timers/promises";

import crossSpawn
    from "cross-spawn";

import type {
    ProcessRunOutcome,
    ProcessRunRequest,
    ProcessRunner,
    ProcessStartError,
} from "../../core/process/process-runner.js";

import {
    BoundedByteCapture,
} from "./bounded-output.js";

// 默认的 优雅关闭时间
const DEFAULT_KILL_GRACE_MS =
    500;
//
const PROTECTED_ENVIRONMENT_KEYS =
    new Set([
        /*
         * Agent 自己的 provider credentials
         * 不应默认泄漏给 model-controlled
         * child process。
         */
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GEMINI_API_KEY",
        "GOOGLE_API_KEY",
    ]);
// 谁主动要求停止这个进程？
type RequestedTermination =
    | "timeout"
    | "cancelled";

export class NodeProcessRunner
    implements ProcessRunner
{
    // 私有构造器
    private constructor(
        private readonly root:
        string,
    ) {}
    // 只能通过工厂方法来创建
    public static async create(
        workspaceRoot: string,
        signal: AbortSignal,
    ): Promise<NodeProcessRunner> {
        signal.throwIfAborted();
        // 解析真实的workspace路径
        const root =
            await realpath(
                path.resolve(
                    workspaceRoot,
                ),
            );
        // 判断workspace是否是真的目录
        if (
            !(
                await stat(
                    root,
                )
            ).isDirectory()
        ) {
            throw new Error(
                "Process runner root must be a directory",
            );
        }

        return new NodeProcessRunner(
            root,
        );
    }

    /**
     * 运行函数
     * @param request
     * @param signal
     */
    public async run(
        request:
        ProcessRunRequest,

        signal:
        AbortSignal,
    ): Promise<ProcessRunOutcome> {
        // 快速失败
        signal.throwIfAborted();
        // 校验请求
        validateProcessRequest(
            request,
        );

        let cwd:
            string;

        try {
            // 获取真实工作路径
            cwd =
                await this
                    .resolveWorkingDirectory(
                        request.cwd,
                    );
        } catch (error) {
            return {
                ok: false,

                error: {
                    code:
                        "invalid_cwd",

                    message:
                        getErrorMessage(
                            error,
                        ),
                },
            };
        }
        // 开始工作时间
        const startedAt =
            Date.now();

        let child:
            ChildProcess;

        try {
            // 启动子进程
            child =
                crossSpawn(
                    request.command,

                    [
                        ...request.args,
                    ],

                    {
                        cwd,

                        env:
                            createChildEnvironment(),

                        shell:
                            false,

                        windowsHide:
                            true,

                        /*
                         * POSIX:
                         * 创建独立 process group，
                         * 之后可以 kill(-pid)。
                         *
                         * Windows 不使用 detached，
                         * 由 taskkill /T 处理进程树。
                         */
                        detached:
                            process.platform !==
                            "win32",
                        // 子进程的输入和输出全部走pipe
                        stdio: [
                            "pipe",
                            "pipe",
                            "pipe",
                        ],
                    },
                );
        } catch (error) {
            return {
                ok: false,

                error:
                    mapSpawnError(
                        error,
                    ),
            };
        }
        // 有节字节限流器
        const stdout =
            new BoundedByteCapture(
                request
                    .maxOutputBytes,
            );

        const stderr =
            new BoundedByteCapture(
                request
                    .maxOutputBytes,
            );

        return new Promise(
            (
                resolve,
                reject,
            ) => {
                // 状态标记位，避免多条异步重复路径结束Promise
                let settled =
                    false;
                // 为什么开始终止
                let requestedTermination:
                    RequestedTermination |
                    null = null;
                // 这次进程树清理完成了吗
                let terminationPromise:
                    Promise<void> |
                    null = null;
                // 设置定时器
                const timeout =
                    setTimeout(
                        () => {
                            requestTermination(
                                "timeout",
                            );
                        },

                        request.timeoutMs,
                    );
                // 不会让Node event loop继续保活
                timeout.unref();
                // 清理回调
                const cleanup =
                    (): void => {
                        // 清楚定时器
                        clearTimeout(
                            timeout,
                        );
                        // 清除signal的监听器
                        signal
                            .removeEventListener(
                                "abort",
                                onAbort,
                            );
                    };
                // 拒绝promise
                const finishReject =
                    (
                        error:
                        unknown,
                    ): void => {
                        // 如果其他路径以及已经完成promise，直接返回
                        if (settled) {
                            return;
                        }
                        // 修改状态
                        settled =
                            true;

                        cleanup();

                        reject(
                            error,
                        );
                    };
                // 接受promise
                const finishResolve =
                    (
                        outcome:
                        ProcessRunOutcome,
                    ): void => {
                        if (settled) {
                            return;
                        }

                        settled =
                            true;

                        cleanup();

                        resolve(
                            outcome,
                        );
                    };
                // 设置  终止 理由
                const requestTermination =
                    (
                        reason:
                        RequestedTermination,
                    ): void => {
                        if (
                            requestedTermination !==
                            null
                        ) {
                            return;
                        }
                        // 将理由设为timeout
                        requestedTermination =
                            reason;
                        // 终止进程树
                        terminationPromise =
                            terminateProcessTree(
                                child,

                                DEFAULT_KILL_GRACE_MS,
                            );
                    };
                // 终止回调
                const onAbort =
                    (): void => {
                        // 设置 取消终止
                        requestTermination(
                            "cancelled",
                        );
                    };
                // 增加监听器
                signal
                    .addEventListener(
                        "abort",
                        onAbort,
                        {
                            once:
                                true,
                        },
                    );

                /*
                 * 消除：
                 * check signal
                 *   ↓
                 * spawn
                 *   ↓
                 * register listener
                 *
                 * 中间极小的 abort race。
                 */
                // 手动判断signal信号是否中断
                if (signal.aborted) {
                    onAbort();
                }

                if (
                    child.stdout ===
                    null ||
                    child.stderr ===
                    null ||
                    child.stdin ===
                    null
                ) {
                    requestTermination(
                        "cancelled",
                    );

                    finishReject(
                        new Error(
                            "Child process stdio was not piped",
                        ),
                    );

                    return;
                }
                // 接受输出流
                child.stdout.on(
                    "data",

                    (
                        chunk:
                        Buffer,
                    ) => {
                        stdout.append(
                            chunk,
                        );
                    },
                );
                // 接受错误流
                child.stderr.on(
                    "data",

                    (
                        chunk:
                        Buffer,
                    ) => {
                        stderr.append(
                            chunk,
                        );
                    },
                );

                /*
                 * 默认永远不允许 child 等待
                 * terminal input。
                 *
                 * stdin=null 就直接 EOF。
                 */
                if (
                    request.stdin ===
                    null
                ) {
                    child.stdin.end();
                } else {
                    child.stdin.end(
                        request.stdin,

                        "utf8",
                    );
                }

                child.once(
                    "error",

                    (
                        error,
                    ) => {
                        if (
                            signal.aborted
                        ) {
                            finishReject(
                                getAbortReason(
                                    signal,
                                ),
                            );

                            return;
                        }

                        finishResolve({
                            ok:
                                false,

                            error:
                                mapSpawnError(
                                    error,
                                ),
                        });
                    },
                );
                //
                child.once(
                    "close",

                    (
                        exitCode,
                        exitSignal,
                    ) => {
                        void (
                            async () => {
                                //
                                if (
                                    terminationPromise !==
                                    null
                                ) {
                                    await terminationPromise
                                        .catch(
                                            () =>
                                                undefined,
                                        );
                                }

                                if (
                                    signal.aborted
                                ) {
                                    finishReject(
                                        getAbortReason(
                                            signal,
                                        ),
                                    );

                                    return;
                                }
                                // 得到输出流结果
                                const capturedStdout =
                                    stdout.finish();
                                // 得到错误流结果
                                const capturedStderr =
                                    stderr.finish();

                                finishResolve({
                                    ok:
                                        true,

                                    result: {
                                        command:
                                        request
                                            .command,

                                        args: [
                                            ...request
                                                .args,
                                        ],

                                        cwd:
                                        request
                                            .cwd,

                                        termination:
                                            requestedTermination ===
                                            "timeout"
                                                ? "timed_out"
                                                : exitSignal !==
                                                null
                                                    ? "signaled"
                                                    : "exited",

                                        exitCode,

                                        signal:
                                        exitSignal,

                                        stdout:
                                        capturedStdout
                                            .text,

                                        stderr:
                                        capturedStderr
                                            .text,

                                        stdoutTruncated:
                                        capturedStdout
                                            .truncated,

                                        stderrTruncated:
                                        capturedStderr
                                            .truncated,

                                        stdoutBytes:
                                        capturedStdout
                                            .totalBytes,

                                        stderrBytes:
                                        capturedStderr
                                            .totalBytes,

                                        durationMs:
                                            Math.max(
                                                0,

                                                Date.now() -
                                                startedAt,
                                            ),
                                    },
                                });
                            }
                        )();
                    },
                );
            },
        );
    }

    private async resolveWorkingDirectory(
        input: string,
    ): Promise<string> {
        // 判断非法路径
        if (
            input.length === 0 ||
            path.isAbsolute(
                input,
            ) ||
            input.includes(
                "\0",
            )
        ) {
            throw new Error(
                "cwd must be a workspace-relative directory",
            );
        }
        // 解析成绝对路径
        const candidate =
            path.resolve(
                this.root,
                input,
            );
        // 判断是否在workspace内部
        this.assertInside(
            candidate,
        );
        // 解析真实路径
        const canonical =
            await realpath(
                candidate,
            );
        // 再次判断
        this.assertInside(
            canonical,
        );
        // 如果对应路径不是目录
        if (
            !(
                await stat(
                    canonical,
                )
            ).isDirectory()
        ) {
            throw new Error(
                "cwd must refer to a directory",
            );
        }

        return canonical;
    }

    private assertInside(
        target: string,
    ): void {
        const relative =
            path.relative(
                this.root,
                target,
            );

        if (
            relative === ""
        ) {
            return;
        }

        if (
            relative === ".." ||
            relative.startsWith(
                `..${path.sep}`,
            ) ||
            path.isAbsolute(
                relative,
            )
        ) {
            throw new Error(
                "cwd escapes the workspace",
            );
        }
    }
}

/**
 * 校验进程执行请求的参数校验器
 * @param request
 */
function validateProcessRequest(
    request:
    ProcessRunRequest,
): void {
    // 拒绝非法command
    if (
        request.command.length ===
        0 ||
        request.command.length >
        1_024 ||
        request.command.includes(// 防止\0注入
            "\0",
        )
    ) {
        throw new RangeError(
            "Invalid command",
        );
    }
    // 限制参数的数量
    if (
        request.args.length >
        128
    ) {
        throw new RangeError(
            "Too many command arguments",
        );
    }
    // 对每个参数进行单独校验
    for (
        const argument
        of request.args
        ) {
        // 校验参数长度以及\0字符注入
        if (
            argument.length >
            8_192 ||
            argument.includes(
                "\0",
            )
        ) {
            throw new RangeError(
                "Invalid command argument",
            );
        }
    }
    // 校验超时时间是否是正整数
    if (
        !Number.isSafeInteger(
            request.timeoutMs,
        ) ||
        request.timeoutMs <= 0
    ) {
        throw new RangeError(
            "Invalid process timeout",
        );
    }
    // 校验最大输出内容字节数是否是正整数
    if (
        !Number.isSafeInteger(
            request.maxOutputBytes,
        ) ||
        request.maxOutputBytes <=
        0
    ) {
        throw new RangeError(
            "Invalid process output limit",
        );
    }
}

/**
 * 为子进程构造一个经过清洗的环境变量集合：当前服务进程拥有的环境变量，不一定都应该暴露给它启动的子进程。
 */
function createChildEnvironment():
    NodeJS.ProcessEnv {
    // 获取当前进程的环境变量
    const env = {
        ...process.env,
    };
    // 删除受保护的环境变量
    for (
        const key
        of PROTECTED_ENVIRONMENT_KEYS
        ) {
        delete env[key];
    }

    return env;
}

/**
 * 映射错误信息
 * @param error
 */
function mapSpawnError(
    error: unknown,
): ProcessStartError {
    if (
        typeof error ===
        "object" &&
        error !== null &&
        "code" in error
    ) {
        const code =
            error.code;

        if (code === "ENOENT") {
            return {
                code:
                    "not_found",

                message:
                    "Command was not found",
            };
        }

        if (
            code === "EACCES" ||
            code === "EPERM"
        ) {
            return {
                code:
                    "permission_denied",

                message:
                    getErrorMessage(
                        error,
                    ),
            };
        }
    }

    return {
        code:
            "spawn_failed",

        message:
            getErrorMessage(
                error,
            ),
    };
}

/**
 * 获取错误信息
 * @param error
 */
function getErrorMessage(
    error: unknown,
): string {
    return error instanceof Error
        ? error.message
        : String(error);
}

/**
 * 获取终止理由
 * @param signal
 */
function getAbortReason(
    signal: AbortSignal,
): unknown {
    return (
        signal.reason ??
        new Error(
            "Operation aborted",
        )
    );
}

/**
 * 跨平台地终止一个子进程，以及它可能创建出来的整棵子进程树，并先尝试优雅退出，超时后强制杀掉
 * @param child 子进程
 * @param graceMs 给进程的善后时间
 */
async function terminateProcessTree(
    child: ChildProcess,
    graceMs: number,
): Promise<void> {
    // 获取pid
    const pid =
        child.pid;
    // 防御性校验
    if (
        pid === undefined
    ) {
        return;
    }
    // 判断是否是win32平台
    if (
        process.platform ===
        "win32"
    ) {
        // 终止windows进程树
        await terminateWindowsTree(
            pid,
            child,
        );

        return;
    }
    // 终止Posix风格的进程树
    terminatePosixGroup(
        pid,
        "SIGTERM",// 请正常退出
    );
    // 等待一段时间让子进程树正常退出
    await sleep(
        graceMs,
    );
    //
    terminatePosixGroup(
        pid,
        "SIGKILL",// 操作系统立即强制终止进程
    );
}

/**
 * 终止windows的进程树
 * @param pid
 * @param child
 */
async function terminateWindowsTree(
    pid: number,
    child: ChildProcess,
): Promise<void> {
    await new Promise<void>(
        (resolve) => {
            const killer =
                // 启动taskkill
                nodeSpawn(
                    "taskkill.exe",

                    [
                        "/PID",
                        String(pid),

                        "/T", // 不仅终止指定PID，还要终止由它启动的子进程

                        "/F", // 代表强制终止
                    ],

                    {
                        windowsHide:
                            true, // 不启动额外控制台窗口

                        stdio:
                            "ignore",//忽略输入输出

                        shell:
                            false,// 不经过cmd.exe
                    },
                );
            // 监听错误
            killer.once(
                "error",// 辅助进程本身没能正常启动或发生进程级错误。
                () => {
                    try {
                        // 降级，直接杀父进程
                        child.kill(
                            "SIGKILL",
                        );
                    } catch {
                        // best effort
                    }

                    resolve();
                },
            );

            killer.once(
                "close",
                (exitCode) => {
                    if (
                        exitCode !==
                        0
                    ) {
                        try {
                            /*
                             * taskkill 失败时，至少终止当前直接子进程，
                             * 防止 ProcessRunner 永远等不到 close。
                             */
                            child.kill(
                                "SIGKILL",
                            );
                        } catch {
                            // best effort
                        }
                    }

                    resolve();
                },
            );
        },
    );
}

/**
 * 终止Posix进程树
 * @param pid
 * @param signal
 */
function terminatePosixGroup(
    pid: number,
    signal:
    NodeJS.Signals,
): void {
    try {
        /*
         * detached=true
         *
         * 所以 child.pid 同时是
         * process group id。
         */
        process.kill(
            -pid,
            signal,
        );
    } catch (error) {
        if (
            !isProcessMissing(
                error,
            )
        ) {
            throw error;
        }
    }
}

function isProcessMissing(
    error: unknown,
): boolean {
    return (
        typeof error ===
        "object" &&
        error !== null &&
        "code" in error &&
        error.code ===
        "ESRCH"
    );
}