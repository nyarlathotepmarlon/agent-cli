import {
    spawn,
} from "node:child_process";

import {
    StringDecoder,
} from "node:string_decoder";
// Ripgrep运行参数
export interface RipgrepRunOptions {
    readonly cwd: string; // rg的工作目录

    readonly args:
        readonly string[];

    readonly delimiter:
        "\n" | "\0";

    readonly signal:
        AbortSignal;

    onRecord(
        record: string,
    ): boolean;// 回调接口
}
// 运行结果
export interface RipgrepRunResult {
    readonly exitCode:
        number | null;

    readonly stderr:
        string;

    readonly terminatedEarly:
        boolean;
}
// stderr最大只保留64kb
const MAX_STDERR_BYTES =
    64 * 1024;
// 缓存rg可执行文件的path
let cachedRgPath:
    string | null = null;

export async function runRipgrepDelimited(
    options: RipgrepRunOptions,
): Promise<RipgrepRunResult> {
    // 快速失败
    options.signal
        .throwIfAborted();
    // 获取rg可执行文件的路径
    const rgPath =
        await resolveRipgrepPath();

    return new Promise(
        (resolve, reject) => {
            // 创建rg子进程，并且使用spawn关闭shell，因为LLM的输入是不可信的，要防止shell injection
            const child =
                spawn(
                    rgPath,
                    [...options.args],
                    {
                        cwd:
                        options.cwd,// rg从指定的目录执行

                        shell:
                            false,// 降低shell注入的风险，少启动有一个shell进程，跨平台行为更为可控

                        windowsHide:
                            true,// 启动rg的时候不会出现额外的命令行窗口

                        stdio: [
                            "ignore",// 忽略标准输入流
                            "pipe",
                            "pipe",
                        ],
                    },
                );

            const stdoutDecoder =
                new StringDecoder(
                    "utf8",
                );// Node stream的chunk边界不等于UTF-8字符边界

            const stderrDecoder =
                new StringDecoder(
                    "utf8",
                );
            // stdout中已经收到，但是没有形成完成的record数据，比如aaa\nbb还有下面的b\n，不是每个chunk=一条记录
            let pending = "";
            // 记录标准错误输出
            let stderr = "";
            // 记录标准错误输出的字节数
            let stderrBytes = 0;
            // 早停标记
            let terminatedEarly =
                false;
            // 多个路径都可能尝试完成 Promise，确保cleanup只发生一次，使得控制流更加明显
            let settled =
                false;
            // 记录消费记录中的报错
            let consumerError:
                unknown = null;
            // 清理回调
            const cleanup = (): void => {
                // 移除abort监听器，Abort signal是从外部传来的，进入这个子进程的生命周期加上abort监听器，在子进程结束之前，取消
                options.signal
                    .removeEventListener(
                        "abort",
                        onAbort,
                    );
            };

            const rejectOnce = (
                error: unknown,
            ): void => {
                if (settled) {
                    return;
                }

                settled = true;

                cleanup();

                reject(error);
            };

            const resolveOnce = (
                result:
                RipgrepRunResult,
            ): void => {
                if (settled) {
                    return;
                }

                settled = true;

                cleanup();

                resolve(result);
            };
            // 提前提停止
            const stopEarly =
                (): void => {
                    if (
                        terminatedEarly
                    ) {
                        return;
                    }
                    // 将提前停止标志为true
                    terminatedEarly =
                        true;
                    // 暂停从子进程的标准输出流 stdout 中继续读取数据，即不再读取下一个chunk
                    child.stdout.pause();
                    // 杀死子进程
                    child.kill();
                };

            const consumeRecords =
                (): void => {
                    while (
                        !terminatedEarly
                        ) {
                        // 获取分隔符的索引
                        const index =
                            pending.indexOf(
                                options.delimiter,
                            );
                        // 还没有分隔符，说明pending还没有形成一个记录
                        if (index < 0) {
                            return;
                        }
                        // 获取这条记录
                        const record =
                            pending.slice(
                                0,
                                index,
                            );

                        pending =
                            pending.slice(
                                index +
                                options
                                    .delimiter
                                    .length,
                            );
                        // 如果record长度为0，继续下一轮循环
                        if (
                            record.length ===
                            0
                        ) {
                            continue;
                        }
                        // record是一条有效数据
                        try {
                            // 调用回调函数消费record，并返回是否继续消费
                            const shouldContinue =
                                options.onRecord(
                                    record,
                                );
                            // 如果不继续消费，提前停止
                            if (
                                !shouldContinue
                            ) {
                                stopEarly();
                            }
                        } catch (error) {
                            //记录报错
                            consumerError =
                                error;
                            // 早停
                            stopEarly();
                        }
                    }
                };
            // 停止就杀死进程
            const onAbort = (): void => {
                child.kill();
            };
            //为AbortSignal增加监听器
            options.signal
                .addEventListener(
                    "abort",
                    onAbort,
                    {
                        once: true,//只执行一次
                    },
                );
            // 为子进程的标准输出流绑定监听器
            child.stdout.on(
                "data",
                (
                    chunk:
                    Buffer,
                ) => {
                    // 如果早停，直接返回
                    if (
                        terminatedEarly
                    ) {
                        return;
                    }
                    // 将chunk加入到pending中
                    pending +=
                        stdoutDecoder
                            .write(
                                chunk,
                            );
                    // 消费pending中的记录
                    consumeRecords();
                },
            );
            // 标准错误流绑定监听器
            child.stderr.on(
                "data",
                (
                    chunk:
                    Buffer,
                ) => {
                    // 如果错误流的总字节数大于上限，直接抛弃
                    if (
                        stderrBytes >=
                        MAX_STDERR_BYTES
                    ) {
                        return;
                    }
                    // 记录还可以记录的字节数
                    const remaining =
                        MAX_STDERR_BYTES -
                        stderrBytes;
                    // 从错误流中复制
                    const selected =
                        chunk.subarray(
                            0,
                            remaining,
                        );
                    // 更新错误信息的长度
                    stderrBytes +=
                        selected.length;
                    // 增加错误信息
                    stderr +=
                        stderrDecoder
                            .write(
                                selected,
                            );
                },
            );
            //处理进程本身启动或者运行基础设施层面的错误
            child.once(
                "error",
                (error) => {
                    // 如果用户已经中断
                    if (
                        options.signal
                            .aborted
                    ) {
                        // Promise返回Abort signal的错误
                        rejectOnce(
                            getAbortReason(
                                options
                                    .signal,
                            ),
                        );

                        return;
                    }
                    // Promise返回程序报错的错误
                    rejectOnce(
                        error,
                    );
                },
            );
            // 真正的完成逻辑
            child.once(
                "close",
                (exitCode) => {
                    // StringDecoder.write() 可能还保留未完成字符。
                    stderr +=
                        stderrDecoder.end();
                    // 如果用户中断，Promise返回Abort signal的错误
                    if (
                        options.signal
                            .aborted
                    ) {
                        rejectOnce(
                            getAbortReason(
                                options
                                    .signal,
                            ),
                        );

                        return;
                    }
                    // 如果消费中出现错误。promise返回消费中的错误
                    if (
                        consumerError !==
                        null
                    ) {
                        rejectOnce(
                            consumerError,
                        );

                        return;
                    }
                    // 如果没有早停
                    if (
                        !terminatedEarly
                    ) {
                        // 处理解码器剩余的字符
                        pending +=
                            stdoutDecoder
                                .end();
                        // 如果pending还有数据，继续消费
                        if (
                            pending.length >
                            0
                        ) {
                            try {
                                options.onRecord(
                                    pending,
                                );
                            } catch (
                                error
                                ) {
                                rejectOnce(
                                    error,
                                );

                                return;
                            }
                        }
                    }
                    // promise返回数据
                    resolveOnce({
                        exitCode,

                        stderr,

                        terminatedEarly,
                    });
                },
            );
        },
    );
}

/**
 * 解析rg可执行文件的path
 */
async function resolveRipgrepPath():
    Promise<string> {
    // 如果有缓存则直接返回
    if (
        cachedRgPath !== null
    ) {
        return cachedRgPath;
    }
    // 如果没有缓存，则导入模块
    const module =
        await import(
            "@vscode/ripgrep"
            );
    // 将rg可执行文件的path缓存
    cachedRgPath =
        module.rgPath;

    return cachedRgPath;
}

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