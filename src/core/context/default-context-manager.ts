/**
 * 超过 token 预算后，按照信息价值分层降级：
 *
 * 完整历史 → 去 Provider 重放数据 → 按冷热压缩文本 →
 * 丢弃最老 assistant/tool 回合 → 紧急压缩 → 继续丢弃 → 明确报 overflow
 *
 * system/user 被视为不可静默丢失的语义状态，而 assistant/tool 历史属于可降级的重放历史。
 *
 * 为什么user message也是尽量不压缩呢？因为用户的要求和规范一旦压缩丢失语义，就会跑偏
 */
import type {
    AssistantModelMessage,
    ModelMessage,
    SystemModelMessage,
    ToolModelMessage,
    UserModelMessage,
} from "../model/model-message.js";

import type {
    ContextBuildOutcome,
    ContextBuildRequest,
    ContextManager,
    ContextPolicy,
} from "./context-manager.js";

import type {
    TokenEstimator,
} from "./token-estimator.js";
// 锚点message，不能被修改
type AnchorMessage =
    | SystemModelMessage
    | UserModelMessage;

interface AnchorSegment {
    readonly kind:
        "anchor";

    readonly message:
        AnchorMessage;
}

interface TurnSegment {
    readonly kind:
        "turn";
    // AssistantMessage与其对应的ToolMessage是不可随便拆散的原子结构
    readonly assistant:
        AssistantModelMessage;

    readonly tools:
        readonly ToolModelMessage[];
}

type ContextSegment =
    | AnchorSegment
    | TurnSegment;

interface SegmentTransform {
    readonly segments:
        readonly ContextSegment[];

    readonly changed:
        boolean;
}

export class DefaultContextManager
    implements ContextManager
{
    public constructor(
        private readonly estimator:
        TokenEstimator,// 怎么估算大小

        private readonly policy:
        ContextPolicy,// 怎么裁剪
    ) {
        validateContextPolicy(
            policy,
        );
    }

    /**
     * 多阶段降级算法
     * @param request
     * @param signal
     */
    public async build(
        request:
        ContextBuildRequest,// 包含messages和tool definitions

        signal:
        AbortSignal,
    ): Promise<ContextBuildOutcome> {
        // 快速失败
        signal.throwIfAborted();
        // 估算整个messages和tool definitions的总tokens
        const originalTokens =
            this.estimator
                .estimateRequest(
                    request.messages,

                    request.tools,
                );
        // 估算tool definitions的总token
        const toolTokens =
            this.estimator
                .estimateTools(
                    request.tools,
                );

        /*
         * Fast path:
         *
         * preserve exact semantic +
         * provider replay history.
         */
        // 如果全部的messages+tool definitions都没有超过预算，完全不做上下文优化
        if (
            originalTokens <=
            this.policy
                .maxEstimatedInputTokens
        ) {
            return {
                ok:
                    true,

                result: {
                    messages:
                        [
                            ...request
                                .messages,
                        ],

                    stats: {
                        originalMessageCount:
                        request
                            .messages
                            .length,

                        projectedMessageCount:
                        request
                            .messages
                            .length,

                        originalEstimatedTokens:
                        originalTokens,

                        projectedEstimatedTokens:
                        originalTokens,

                        toolDefinitionEstimatedTokens:
                        toolTokens,

                        droppedTurns:
                            0,

                        providerReplayStripped:
                            false,

                        compacted:
                            false,
                    },
                },
            };
        }
        // 将message转为segment
        let segments =
            parseSegments(
                request.messages,
            );
        // 记录是否改变
        let changed =
            false;
        // 删除的轮次
        let droppedTurns =
            0;

        /*
         * Stage 1:
         *
         * Provider replay is an optimization,
         * not authoritative semantic state.
         *
         * Once the exact transcript no longer
         * fits, switch to semantic replay.
         */
        // 删除provider replay数据，
        // 消息语义
        //     >
        // provider replay metadata
        const stripped =
            stripProviderReplay(
                segments,
            );

        segments =
            stripped.segments;

        changed =
            changed ||
            stripped.changed;

        signal.throwIfAborted();
        // 重新估算token
        let estimated =
            this.estimateSegments(
                segments,
                request,
            );

        if (
            estimated <=
            this.policy
                .maxEstimatedInputTokens
        ) {
            return this.success(
                request,
                segments,
                originalTokens,
                toolTokens,
                droppedTurns,
                stripped.changed,
                true,
            );
        }
        // 如果去掉providerData仍然放不下，进行hot/cold分层压缩
        /*
         * Stage 2:
         *
         * hot/cold text compaction.
         */
        const ageCompacted =
            compactByAge(
                segments,

                this.policy,
            );
        // 获取到压缩后的segments
        segments =
            ageCompacted
                .segments;

        changed =
            changed ||
            ageCompacted
                .changed;

        signal.throwIfAborted();
        // 继续估算
        estimated =
            this.estimateSegments(
                segments,
                request,
            );

        /*
         * Stage 3:
         *
         * Evict oldest cold turns.
         *
         * Keep newest hotTurns intact
         * as a set of turn groups.
         */
        // 如果压缩还不够，就开始删除cold Turn
        while (
            estimated >
            this.policy
                .maxEstimatedInputTokens &&
            countTurns(
                segments,
            ) >
            this.policy
                .hotTurns
            ) {
            // 删除旧turn segment
            segments =
                dropOldestTurn(
                    segments,
                );
            // 增加删除的turn segment的数量
            droppedTurns += 1;

            changed = true;
            // 再次评估
            estimated =
                this.estimateSegments(
                    segments,
                    request,
                );

            signal
                .throwIfAborted();
        }
        //再次判断是否符合要求了
        if (
            estimated <=
            this.policy
                .maxEstimatedInputTokens
        ) {
            return this.success(
                request,
                segments,
                originalTokens,
                toolTokens,
                droppedTurns,
                stripped.changed,
                changed,
            );
        }
        // 最近的hot turn自己都太大了，进入紧急模式
        /*
         * Stage 4:
         *
         * The remaining hot context is
         * still too large, so compact it
         * more aggressively.
         */
        // 压缩所有的hot turn
        const emergency =
            compactAllTurns(
                segments,

                this.policy
                    .emergencyAssistantChars,

                this.policy
                    .emergencyToolResultChars,
            );

        segments =
            emergency.segments;

        changed =
            changed ||
            emergency.changed;
        // 再次估算
        estimated =
            this.estimateSegments(
                segments,
                request,
            );

        /*
         * Stage 5:
         *
         * If necessary, evict even older
         * hot turns, but always preserve
         * minRetainedTurns.
         */
        // 要是还不满足，就直接开始删除hot turn，只保留minRetainedTurns
        while (
            estimated >
            this.policy
                .maxEstimatedInputTokens &&
            countTurns(
                segments,
            ) >
            this.policy
                .minRetainedTurns
            ) {
            segments =
                dropOldestTurn(
                    segments,
                );

            droppedTurns += 1;

            changed = true;

            estimated =
                this.estimateSegments(
                    segments,
                    request,
                );

            signal
                .throwIfAborted();
        }

        if (
            estimated <=
            this.policy
                .maxEstimatedInputTokens
        ) {
            return this.success(
                request,
                segments,
                originalTokens,
                toolTokens,
                droppedTurns,
                stripped.changed,
                changed,
            );
        }

        /*
         * Never silently truncate
         * system/user instructions.
         *
         * If pinned state itself cannot fit,
         * stop explicitly.
         */
        // 绝不静默截断System/user
        const pinnedMessages =
            segments
                .filter(
                    (
                        segment,
                    ): segment is
                        AnchorSegment =>
                        segment.kind ===
                        "anchor",
                )
                .map(
                    (segment) =>
                        segment.message,
                );
        // 单独计算绝对不能丢的数据
        const pinnedEstimatedTokens =
            this.estimator
                .estimateRequest(
                    pinnedMessages,

                    request.tools,
                );

        return {
            ok:
                false,

            error: {
                code:
                    "context_overflow",

                limit:
                this.policy
                    .maxEstimatedInputTokens,

                estimated,

                pinnedEstimatedTokens,
            },
        };
    }

    private estimateSegments(
        segments:
        readonly ContextSegment[],

        request:
        ContextBuildRequest,
    ): number {
        return this.estimator
            .estimateRequest(
                flattenSegments(
                    segments,
                ),

                request.tools,
            );
    }

    private success(
        request:
        ContextBuildRequest,

        segments:
        readonly ContextSegment[],

        originalTokens:
        number,

        toolTokens:
        number,

        droppedTurns:
        number,

        providerReplayStripped:
        boolean,

        compacted:
        boolean,
    ): ContextBuildOutcome {
        const messages =
            flattenSegments(
                segments,
            );

        const projectedTokens =
            this.estimator
                .estimateRequest(
                    messages,

                    request.tools,
                );

        return {
            ok:
                true,

            result: {
                messages,

                stats: {
                    originalMessageCount:
                    request
                        .messages
                        .length,

                    projectedMessageCount:
                    messages.length,

                    originalEstimatedTokens:
                    originalTokens,

                    projectedEstimatedTokens:
                    projectedTokens,

                    toolDefinitionEstimatedTokens:
                    toolTokens,

                    droppedTurns,

                    providerReplayStripped,

                    compacted,
                },
            },
        };
    }
}

/**
 * 将messages转为可安全删除的segment
 * @param messages
 */
function parseSegments(
    messages:
    readonly ModelMessage[],
): readonly ContextSegment[] {
    const segments:
        ContextSegment[] = [];

    let index = 0;
    // 从头到尾扫描messages
    while (
        index <
        messages.length
        ) {
        // 获取当前的message
        const message =
            messages[index];
        // 防御性编程
        if (
            message ===
            undefined
        ) {
            break;
        }
        // 判断这条messages是不是anchorMessage
        if (
            message.role ===
            "system" ||
            message.role ===
            "user"
        ) {
            // 添加anchorSegments
            segments.push({
                kind:
                    "anchor",

                message,
            });

            index += 1;

            continue;
        }
        // 如果直接看到tool message，判断这是一条孤儿消息
        if (
            message.role ===
            "tool"
        ) {
            throw new Error(
                `Orphan tool message: ${message.toolCallId}`,
            );
        }
        // 当前消息是assistant message
        const assistant =
            message;
        // 接收后面的tool message
        const tools:
            ToolModelMessage[] =
            [];

        let cursor =
            index + 1;
        // 从assistant message后面开始遍历
        while (
            cursor <
            messages.length
            ) {
            // 获取子遍历的消息
            const next =
                messages[cursor];
            // 如果不是tool message代表tool message已经接收完
            if (
                next === undefined ||
                next.role !==
                "tool"
            ) {
                break;
            }
            // 接受tool message
            tools.push(
                next,
            );

            cursor += 1;
        }
        // 对于这一条assistant message的tool message已经接受完，开始校验
        validateToolPairing(
            assistant,
            tools,
        );
        // 将turn segments加入
        segments.push({
            kind:
                "turn",

            assistant,

            tools,
        });

        index = cursor;
    }

    return segments;
}

/**
 * 校验assistant message和tool message的关系是否能对上，toolcalls和toolresul一一对应
 * @param assistant
 * @param tools
 */
function validateToolPairing(
    assistant:
    AssistantModelMessage,

    tools:
    readonly ToolModelMessage[],
): void {
    // 如果assistant message没有tool calls但是却有tool message，直接抛异常
    if (
        assistant
            .toolCalls
            .length === 0
    ) {
        if (
            tools.length > 0
        ) {
            throw new Error(
                "Tool messages follow an assistant message without tool calls",
            );
        }

        return;
    }
    // assistant message 期待的tool id
    const expected =
        new Set(
            assistant
                .toolCalls
                .map(
                    (call) =>
                        call.id,
                ),
        );

    const seen =
        new Set<string>();
    // 遍历tool messages
    for (
        const tool
        of tools
        ) {
        // 如果该tool messages的tool call id并不在assistant message中，直接报错
        if (
            !expected.has(
                tool.toolCallId,
            )
        ) {
            throw new Error(
                `Unexpected tool result: ${tool.toolCallId}`,
            );
        }
        // 如果第二次见到这个tool call id，则报错
        if (
            seen.has(
                tool.toolCallId,
            )
        ) {
            throw new Error(
                `Duplicate tool result: ${tool.toolCallId}`,
            );
        }
        // 将这个tool call id加入集合
        seen.add(
            tool.toolCallId,
        );
    }
    // 数量要对应
    if (
        seen.size !==
        expected.size
    ) {
        throw new Error(
            "Assistant tool call is missing a corresponding tool result",
        );
    }
}
function stripProviderReplay(
    segments:
    readonly ContextSegment[],
): SegmentTransform {
    let changed =
        false;

    const next =
        segments.map(
            (segment):
            ContextSegment => {
                if (
                    segment.kind ===
                    "anchor"
                ) {
                    return segment;
                }

                if (
                    segment
                        .assistant
                        .providerData ===
                    null
                ) {
                    return segment;
                }

                changed = true;

                return {
                    ...segment,

                    assistant: {
                        ...segment
                            .assistant,

                        providerData:
                            null,
                    },
                };
            },
        );

    return {
        segments:
        next,

        changed,
    };
}

/**
 * 根据hot和cold分层压缩
 * @param segments
 * @param policy
 */
function compactByAge(
    segments:
    readonly ContextSegment[],

    policy:
    ContextPolicy,
): SegmentTransform {
    // 计算现有的所有turnSegment的个数
    const turnCount =
        countTurns(
            segments,
        );
    // 计算从什么时候开始算hotTurns
    const hotStart =
        Math.max(
            0,

            turnCount -
            policy.hotTurns,
        );
    // 计算当前的turnIndex
    let turnIndex = 0;

    let changed =
        false;
    //
    const next =
        segments.map(
            (segment):
            ContextSegment => {
                // 如果是anchor segment，则直接返回
                if (
                    segment.kind ===
                    "anchor"
                ) {
                    return segment;
                }
                // 如果是turn segment，则判断是不是hot segment
                const isHot =
                    turnIndex >=
                    hotStart;

                turnIndex += 1;
                // 根据hot/cold压缩turn messgae
                const compacted =
                    compactTurn(
                        segment,

                        isHot
                            ? policy
                                .hotAssistantChars
                            : policy
                                .coldAssistantChars,

                        isHot
                            ? policy
                                .hotToolResultChars
                            : policy
                                .coldToolResultChars,
                    );

                changed =
                    changed ||
                    compacted.changed;

                return compacted
                    .segment;
            },
        );

    return {
        segments:
        next,

        changed,
    };
}

/**
 * 压缩turn segment
 * @param segment
 * @param assistantLimit
 * @param toolLimit
 */
function compactTurn(
    segment:
    TurnSegment,

    assistantLimit:
    number,

    toolLimit:
    number,
): {
    readonly segment:
        TurnSegment;

    readonly changed:
        boolean;
} {
    // 压缩assistant message的内容
    const assistantContent =
        truncateContextText(
            segment
                .assistant
                .content,

            assistantLimit,
        );

    let changed =
        assistantContent.changed;
    // 压缩 tool message的内容
    const tools =
        segment.tools.map(
            (
                tool,
            ): ToolModelMessage => {
                const content =
                    truncateContextText(
                        tool.content,

                        toolLimit,
                    );

                changed =
                    changed ||
                    content.changed;

                if (
                    !content.changed
                ) {
                    return tool;
                }

                return {
                    ...tool,

                    content:
                    content.text,
                };
            },
        );
    // 返回压缩过后的turn segment
    return {
        segment: {
            ...segment,

            assistant:
                assistantContent
                    .changed
                    ? {
                        ...segment
                            .assistant,

                        content:
                        assistantContent
                            .text,
                    }
                    : segment
                        .assistant,

            tools,
        },

        changed,
    };
}

/**
 * 压缩内容
 * @param text
 * @param maxChars
 */
function truncateContextText(
    text: string,
    maxChars: number,
): {
    readonly text:
        string;

    readonly changed:
        boolean;
} {
    // 如果内容长度小于限制，直接返回
    if (
        text.length <=
        maxChars
    ) {
        return {
            text,

            changed:
                false,
        };
    }
    //截断上下文
    const omitted =
        text.length -
        maxChars;

    const marker =
        `\n...[context compacted; approximately ${omitted} characters omitted]...\n`;
    if (
        marker.length >=
        maxChars
    ) {
        return {
            text:
                text.slice(
                    0,
                    maxChars,
                ),

            changed:
                true,
        };
    }
    // 计算可用的长度
    const available =
        maxChars -
        marker.length;
    // 截断头部
    const head =
        Math.ceil(
            available *
            0.65,
        );
    // 计算尾部的长度
    const tail =
        available -
        head;
    // 返回头部+marker+尾部
    return {
        text:
            text.slice(
                0,
                head,
            ) +
            marker +
            (
                tail > 0
                    ? text.slice(
                        -tail,
                    )
                    : ""
            ),

        changed:
            true,
    };
}
function compactAllTurns(
    segments:
    readonly ContextSegment[],

    assistantLimit:
    number,

    toolLimit:
    number,
): SegmentTransform {
    let changed =
        false;

    const next =
        segments.map(
            (segment):
            ContextSegment => {
                if (
                    segment.kind ===
                    "anchor"
                ) {
                    return segment;
                }

                const compacted =
                    compactTurn(
                        segment,

                        assistantLimit,

                        toolLimit,
                    );

                changed =
                    changed ||
                    compacted.changed;

                return compacted
                    .segment;
            },
        );

    return {
        segments:
        next,

        changed,
    };
}

/**
 * 直接按照kind来删除一个旧turn segments
 * @param segments
 */
function dropOldestTurn(
    segments:
    readonly ContextSegment[],
): readonly ContextSegment[] {
    // 获取第一个turn segments
    const index =
        segments.findIndex(
            (segment) =>
                segment.kind ===
                "turn",
        );
    // 如果没有turn segment，直接返回
    if (
        index < 0
    ) {
        return segments;
    }

    return [
        ...segments.slice(
            0,
            index,
        ),

        ...segments.slice(
            index + 1,
        ),
    ];
}

/**
 * 计算segments中的turn segment个数
 * @param segments
 */
function countTurns(
    segments:
    readonly ContextSegment[],
): number {
    let count = 0;

    for (
        const segment
        of segments
        ) {
        if (
            segment.kind ===
            "turn"
        ) {
            count += 1;
        }
    }

    return count;
}

function flattenSegments(
    segments:
    readonly ContextSegment[],
): readonly ModelMessage[] {
    const messages:
        ModelMessage[] = [];

    for (
        const segment
        of segments
        ) {
        if (
            segment.kind ===
            "anchor"
        ) {
            messages.push(
                segment.message,
            );

            continue;
        }

        messages.push(
            segment.assistant,
            ...segment.tools,
        );
    }

    return messages;
}
function validateContextPolicy(
    policy:
    ContextPolicy,
): void {
    assertPositiveInteger(
        policy
            .maxEstimatedInputTokens,

        "maxEstimatedInputTokens",
    );

    assertPositiveInteger(
        policy.hotTurns,
        "hotTurns",
    );

    assertPositiveInteger(
        policy.minRetainedTurns,
        "minRetainedTurns",
    );

    if (
        policy.minRetainedTurns >
        policy.hotTurns
    ) {
        throw new RangeError(
            "minRetainedTurns must be less than or equal to hotTurns",
        );
    }

    const charLimits = [
        [
            "hotAssistantChars",
            policy.hotAssistantChars,
        ],
        [
            "hotToolResultChars",
            policy.hotToolResultChars,
        ],
        [
            "coldAssistantChars",
            policy.coldAssistantChars,
        ],
        [
            "coldToolResultChars",
            policy.coldToolResultChars,
        ],
        [
            "emergencyAssistantChars",
            policy.emergencyAssistantChars,
        ],
        [
            "emergencyToolResultChars",
            policy.emergencyToolResultChars,
        ],
    ] as const;

    for (
        const [
            name,
            value,
        ]
        of charLimits
        ) {
        assertPositiveInteger(
            value,
            name,
        );
    }

    if (
        policy.coldAssistantChars >
        policy.hotAssistantChars
    ) {
        throw new RangeError(
            "coldAssistantChars cannot exceed hotAssistantChars",
        );
    }

    if (
        policy.coldToolResultChars >
        policy.hotToolResultChars
    ) {
        throw new RangeError(
            "coldToolResultChars cannot exceed hotToolResultChars",
        );
    }
}

function assertPositiveInteger(
    value: number,
    name: string,
): void {
    if (
        !Number.isSafeInteger(
            value,
        ) ||
        value <= 0
    ) {
        throw new RangeError(
            `${name} must be a positive safe integer`,
        );
    }
}