import type {
    ModelError,
} from "../model/model-error.js";

export interface ModelRetryPolicy {
    //最大允许尝试多少次
    readonly maxAttempts:
        number;
    // 判断一次失败之后还应不应该继续重试
    shouldRetry(
        error: ModelError, //传入发生的模型错误，因为有些错误适合重试，有些不适合
        failedAttempt: number, // 失败的是第几次尝试
    ): boolean;
    // 根据失败次数计算下一次重试前等待多少毫秒
    getDelayMs(
        failedAttempt: number,
    ): number;
}
// 指数退避策略的配置
export interface ExponentialBackoffOptions {
    // 最大重试次数
    readonly maxAttempts:
        number;
    // 延迟基值
    readonly baseDelayMs:
        number;
    // 最大延迟值
    readonly maxDelayMs:
        number;
}
//指数退避重试策略实现
/**
 * 如果服务器端已经过载，客户端还不断发起更多请求，只会使得问题更加严重
 */
export class ExponentialBackoffModelRetryPolicy
    implements ModelRetryPolicy
{
    public readonly maxAttempts:
        number;

    private readonly baseDelayMs:
        number;

    private readonly maxDelayMs:
        number;

    public constructor(
        options:
        ExponentialBackoffOptions,
    ) {
        assertPositiveInteger(
            options.maxAttempts,
            "maxAttempts",
        );

        assertPositiveInteger(
            options.baseDelayMs,
            "baseDelayMs",
        );

        assertPositiveInteger(
            options.maxDelayMs,
            "maxDelayMs",
        );

        if (
            options.maxDelayMs <
            options.baseDelayMs
        ) {
            throw new RangeError(
                "maxDelayMs must be greater than or equal to baseDelayMs",
            );
        }

        this.maxAttempts =
            options.maxAttempts;

        this.baseDelayMs =
            options.baseDelayMs;

        this.maxDelayMs =
            options.maxDelayMs;
    }

    public shouldRetry(
        error: ModelError,
        failedAttempt: number,
    ): boolean {
        // 重试的条件包含两个：1.该错误可以重试  2. 没有达到最大重试次数
        return (
            error.retryable &&
            failedAttempt <
            this.maxAttempts
        );
    }

    public getDelayMs(
        failedAttempt: number,
    ): number {
        assertPositiveInteger(
            failedAttempt,
            "failedAttempt",
        );
        //delay=baseDelayMs×2^(failedAttempt−1)
        const exponential =
            this.baseDelayMs *
            2 ** (
                failedAttempt - 1
            );
        // 实际等待时间不会超过最大的等待时间
        return Math.min(
            exponential,
            this.maxDelayMs,
        );
    }
}

function assertPositiveInteger(
    value: number,
    name: string,
): void {
    if (
        !Number.isSafeInteger(value) ||
        value <= 0
    ) {
        throw new RangeError(
            `${name} must be a positive safe integer`,
        );
    }
}