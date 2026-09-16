/**
 * 定义进程执行子系统的建模
 */

// 进程结束状态建模
export type ProcessTermination =
    | "exited" // 进程自然退出
    | "signaled" // 进程不是自己退出，而是被外部终止
    | "timed_out";  // 进程超过允许执行时间，被ProcessRunner主动终止

// 运行请求建模
export type ProcessRunRequest ={
    // command和args分离：避免LLM进行shell注入
    readonly command: string; // 表示可执行程序，如:git

    readonly args:
        readonly string[];// 参数

    /**
     * Workspace-relative directory.
     */
    readonly cwd: string;// 相对于工作区的路径

    /**
     * null means close stdin immediately.
     */
    readonly stdin:
        string | null;// 标准输入流，如果为null，则代表不向任何程序发送任何内容，立刻关闭stdin

    readonly timeoutMs:// 超时限制
        number;

    /**
     * Capture limit per stream.
     *
     * The child is not killed just because
     * output is truncated.
     */
    readonly maxOutputBytes:// 标准输出流和标准错误流的输出限制，但是进程不会被杀死
        number;
}

// 进程运行的结果
export type ProcessRunResult ={
    readonly command: string; // 可执行程序

    readonly args:
        readonly string[]; // 参数

    readonly cwd: string;// 相对于workspace的相对路径

    readonly termination:
        ProcessTermination;// 进程停止的理由

    readonly exitCode:// 进程退出状态码
        number | null;

    readonly signal:// 正常退出是null，被信号终止是SIGTERM
        string | null;

    readonly stdout: // 标准输出流
        string;

    readonly stderr:// 标准错误流
        string;

    readonly stdoutTruncated: // 输出流有没有被截断
        boolean;

    readonly stderrTruncated: // 错误流有没有被截断
        boolean;

    readonly stdoutBytes: // 输出流字节数
        number;

    readonly stderrBytes:// 错误流字节数
        number;

    readonly durationMs:// 持续的时间
        number;
}
// 进程创建失败的错误码
export type ProcessStartErrorCode =
    | "invalid_cwd" // 非法工作区
    | "not_found" //没有对应的执行程序
    | "permission_denied" // 权限不足
    | "spawn_failed"; // 兜底错误
// 进程创建失败错误
export type ProcessStartError ={
    readonly code:
        ProcessStartErrorCode;

    readonly message:
        string;
}
// 进程结果
export type ProcessRunOutcome =
    | {
    readonly ok: true; // ok表达的是有没有成功完成运行进程这个操作

    readonly result:
        ProcessRunResult;
}
    | {
    readonly ok: false;

    readonly error:
        ProcessStartError;
};
// 对外核心抽象
export interface ProcessRunner {
    run(
        request: ProcessRunRequest,
        signal: AbortSignal,
    ): Promise<ProcessRunOutcome>;
}