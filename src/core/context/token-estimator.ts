import type {
    ModelMessage,
} from "../model/model-message.js";

import type {
    ModelToolDefinition,
} from "../model/model-tool-definition.js";

export interface TokenEstimator {
    /**
     * 计算聊天消息成本
     * @param messages
     */
    estimateMessages(
        messages:
        readonly ModelMessage[],
    ): number;

    /**
     * 计算Tool Schema成本
     * @param tools
     */
    estimateTools(
        tools:
        readonly ModelToolDefinition[],
    ): number;

    /**
     * 计算完整请求的预算
     * @param messages
     * @param tools
     */
    estimateRequest(
        messages:
        readonly ModelMessage[],

        tools:
        readonly ModelToolDefinition[],
    ): number;
}

/**
 * Provider-neutral conservative estimate.
 *
 * This is deliberately NOT advertised
 * as exact tokenizer output.
 */
export class HeuristicTokenEstimator
    implements TokenEstimator
{
    private readonly encoder =
        new TextEncoder();

    /**
     * 估算消息的token
     * @param messages
     */
    public estimateMessages(
        messages:
        readonly ModelMessage[],
    ): number {
        let total = 0;

        for (
            const message
            of messages
            ) {


            total += 8;// 聊天模型内部有framing，因此每条消息+8，作为每message的协议固定开销

            total +=
                this.estimateSerialized(
                    message,
                );
        }

        return total;
    }

    public estimateTools(
        tools:
        readonly ModelToolDefinition[],
    ): number {
        let total = 0;

        for (
            const tool
            of tools
            ) {
            total += 16;// 理由同message估算

            total +=
                this.estimateSerialized(
                    tool,
                );
        }

        return total;
    }

    public estimateRequest(
        messages:
        readonly ModelMessage[],

        tools:
        readonly ModelToolDefinition[],
    ): number {
        return (
            this.estimateMessages(
                messages,
            ) +
            this.estimateTools(
                tools,
            )
        );
    }

    private estimateSerialized(
        value: unknown,
    ): number {
        // 序列化成UTF-8
        const serialized =
            JSON.stringify(
                value,
            );

        if (
            serialized ===
            undefined
        ) {
            throw new TypeError(
                "Context value is not JSON serializable",
            );
        }
        // 统计字节数
        const bytes =
            this.encoder
                .encode(
                    serialized,
                )
                .byteLength;

        /*
         * Roughly 3 UTF-8 bytes/token.
         *
         * For English/code this tends to
         * be more conservative than the
         * common 4 chars/token heuristic,
         * while behaving more reasonably
         * for CJK text.
         */
        return Math.max(
            1,

            Math.ceil(
                bytes / 3,
            ),
        );
    }
}