/**
 * 当子进程不断产生stdout/stderr时，如何在有限内存下保留最有价值的输出
 * 采用前75%，后25%
 */

/**
 * 表示最终捕获结果
 */
export interface BoundedOutput {
    readonly text: // 结果文本
        string;

    readonly truncated:// 是否截断
        boolean;

    readonly totalBytes:// 实际总字节数
        number;
}

/**
 * 有限字节流捕获器
 */
export class BoundedByteCapture {

    private readonly headLimit:// head最多存储多少字节
        number;

    private readonly tailLimit:// tail最多存储多少字节
        number;

    private head =
        Buffer.alloc(0);

    private tail =
        Buffer.alloc(0);

    private totalBytes = 0;// 输出真正总共字节数

    public constructor(
        private readonly maxBytes:
        number,
    ) {
        // 检验参数是否是正整数
        if (
            !Number.isSafeInteger(
                maxBytes,
            ) ||
            maxBytes <= 0
        ) {
            throw new RangeError(
                "maxBytes must be a positive safe integer",
            );
        }

        /*
         * 保留大约 75% 开头 + 25% 结尾。
         *
         * 开头通常包含 command context，
         * 结尾通常包含 test/build error summary。
         */
        this.headLimit =
            Math.max(
                1,
                Math.floor(
                    maxBytes * 0.75,
                ),
            );// 最少一个字节，最大maxBytes*0.75往下取整

        this.tailLimit =
            Math.max(
                0,
                maxBytes -
                this.headLimit,
            );
    }

    public append(
        chunk: Buffer,
    ): void {
        // 统计总字节数
        this.totalBytes +=
            chunk.length;

        let offset = 0;

        if (
            this.head.length <
            this.headLimit
        ) { // 计算head还能装多少
            const remaining =
                this.headLimit -
                this.head.length;
            // 计算实际上能从buffer拿多少
            const take =
                Math.min(
                    remaining,
                    chunk.length,
                );
            // 将内容写入head
            this.head =
                Buffer.concat([
                    this.head,

                    chunk.subarray(
                        0,
                        take,
                    ),
                ]);
            // 记录buffer已经被拿的偏移量
            offset = take;
        }
        // 如果是buffer中还有数据，且tail中可以放数据
        if (
            offset <
            chunk.length &&
            this.tailLimit > 0
        ) {
            // 往tail中放数据+
            this.tail =
                Buffer.concat([
                    this.tail,

                    chunk.subarray(
                        offset,
                    ),
                ]);
            // 如果tail中超限了，那么就截断tail前面的内容
            if (
                this.tail.length >
                this.tailLimit
            ) {
                this.tail =
                    this.tail.subarray(
                        this.tail.length -
                        this.tailLimit,
                    );
            }
        }
    }

    /**
     * 数据流结束，将缓存结果整理成最终输出
     */
    public finish():
        BoundedOutput {
        // 是否截断
        const truncated =
            this.totalBytes >
            this.maxBytes;
        // 如果没有截断
        if (!truncated) {
            return {
                text:
                    Buffer.concat([
                        this.head,

                        this.tail,
                    ]).toString(
                        "utf8",
                    ),

                truncated:
                    false,

                totalBytes:
                this.totalBytes,
            };
        }
        // 被截断的情况

        // 忽略了多少字节
        const omitted =
            Math.max(
                0,

                this.totalBytes -
                this.head.length -
                this.tail.length,
            );
        // 记录
        const marker =
            Buffer.from(
                `\n... [${omitted} output bytes omitted] ...\n`,

                "utf8",
            );
        // 返回被截断情况的结果
        return {
            text:
                Buffer.concat([
                    this.head,
                    marker,
                    this.tail,
                ]).toString(
                    "utf8",
                ),

            truncated:
                true,

            totalBytes:
            this.totalBytes,
        };
    }
}