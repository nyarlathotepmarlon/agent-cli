/**
 * 基于事件日志的会话恢复器
 *
 * 如果一个AI Agent在执行过程中欧你突然崩溃、进程被杀死、机器重启，要已经持久化的事件日志，把对话恢复到一个语义上有效的状态
 *
 * 采用Event Souring/Event Replay
 */
import type {
    ModelMessage,
    ToolModelMessage,
} from "../model/model-message.js";

import type {
    ToolCall,
} from "../tools/tool-call.js";

import {
    renderToolResult,
} from "../tools/render-tool-result.js";

import type {
    SessionEventEnvelope,
    SessionRunStatus,
} from "./session-event.js";
// Session回放的结果
export interface SessionReplayResult {
    readonly sessionId:
        string;

    readonly workspaceRoot:
        string;

    /**
     * Does NOT include the current
     * system prompt.
     *
     * Application adds the CURRENT
     * system policy during resume.
     */
    readonly messages:
        readonly ModelMessage[];

    readonly hasOpenRun:
        boolean;// Event Log结束的时候，是否存在一个尚未正常结束的Run

    readonly lastSequence:
        number;// 最后一个事件的sequence
}
// 悬挂的工具调用：代表模型已经产生一个Tool Call，但是这个Tool Call还没有得到最终的tool.completed
interface PendingToolCall {
    readonly call:
        ToolCall;

    readonly started:// 代表工具是否开始执行
        boolean;
}

/**
 * 根据事件日志来重放会话
 * @param events
 */
export function replaySession(
    events:
    readonly SessionEventEnvelope[],
): SessionReplayResult {
    // 空session直接报错
    if (
        events.length === 0
    ) {
        throw new Error(
            "Session contains no events",
        );
    }
    // 获取第一个event
    const first =
        events[0];
    // 如果第一个event不是session.started，报错
    if (
        first === undefined ||
        first.event.type !==
        "session.started"
    ) {
        throw new Error(
            "Session must start with session.started",
        );
    }
    // 从session.started事件中，获取SessionID和Workspace
    const sessionId =
        first.sessionId;

    const workspaceRoot =
        first.event
            .workspaceRoot;
    // 存储恢复后的messages数组
    const messages:
        ModelMessage[] = [];
    // 存储call.id到PendingToolCall的映射
    const pending =
        new Map<
            string,
            PendingToolCall
        >();
    // 记录状态openRun，当前是否存在一个正在进行的AgentRun
    let openRun =
        false;
    // 遍历Event Log
    for (
        let index = 0;
        index < events.length;
        index += 1
    ) {
        // 获取当前的event
        const envelope =
            events[index];
        // 防御性编程
        if (
            envelope === undefined
        ) {
            continue;
        }
        // 验证event的sessionI一致
        if (
            envelope.sessionId !==
            sessionId
        ) {
            throw new Error(
                "Session id changed inside event log",
            );
        }
        // 判断sequence是否顺序
        if (
            envelope.sequence !==
            index
        ) {
            throw new Error(
                `Invalid session sequence: expected ${index}, received ${envelope.sequence}`,
            );
        }
        // 获取实际的event
        const event =
            envelope.event;
        // 根据event的type来选择对应的逻辑
        switch (
            event.type
            ) {
            // 如果是session.started，且index!=0则直接报错
            case "session.started": {
                if (index !== 0) {
                    throw new Error(
                        "Duplicate session.started",
                    );
                }

                break;
            }

            case "user.message": {
                // 如果是用户的消息，但是之前的run没有结束，报错
                if (openRun) {
                    throw new Error(
                        "A new run started before the previous run was closed",
                    );
                }
                // agent run开始
                openRun =
                    true;
                // 将user message放入messages中
                messages.push({
                    role:
                        "user",

                    content:
                    event.content,
                });

                break;
            }

            case "model.completed": {
                // 当已经到达调用模型阶段，agent run是关闭状态，报错
                if (!openRun) {
                    throw new Error(
                        "model.completed outside a run",
                    );
                }
                // 在模型调用结束之后，还有工具没执行完
                if (
                    pending.size > 0
                ) {
                    throw new Error(
                        "A new model response arrived before previous tool calls were resolved",
                    );
                }
                // 加入messages
                messages.push(
                    event.response
                        .message,
                );
                // 遍历tool call ，将所有tool call作为未开始加入
                for (
                    const call
                    of event.response
                    .message
                    .toolCalls
                    ) {
                    pending.set(
                        call.id,

                        {
                            call,

                            started:
                                false,
                        },
                    );
                }

                break;
            }
            case "tool.started": {
                // 从对应的pending中通过call id取出
                const current =
                    pending.get(
                        event.call.id,
                    );
                // 如果不存在，则这条tool开始记录没有对上
                if (
                    current ===
                    undefined
                ) {
                    throw new Error(
                        `Unexpected tool.started: ${event.call.id}`,
                    );
                }
                // 如果存在，则将对应call id的状态置为true，代表开始
                pending.set(
                    event.call.id,

                    {
                        call:
                        current.call,

                        started:
                            true,
                    },
                );

                break;
            }

            case "tool.completed": {
                // 从pending中取出tool call
                const current =
                    pending.get(
                        event.toolCallId,
                    );
                // 如果pending中不存在
                if (
                    current ===
                    undefined
                ) {
                    throw new Error(
                        `Unexpected tool.completed: ${event.toolCallId}`,
                    );
                }
                // 将对应的tool message恢复，代表tool完成
                messages.push({
                    role:
                        "tool",

                    toolCallId:
                    current
                        .call
                        .id,

                    toolName:
                    current
                        .call
                        .name,

                    content:
                        renderToolResult(
                            event.result,
                        ),

                    isError:
                        !event
                            .result
                            .ok,
                });
                // 并从pending中移除
                pending.delete(
                    event.toolCallId,
                );

                break;
            }

            case "run.finished": {
                // 如果未开启，报错
                if (!openRun) {
                    throw new Error(
                        "run.finished outside a run",
                    );
                }

                sealPendingToolCalls(
                    messages,
                    pending,
                    event.status,
                );
                // 将状态置为关闭
                openRun =
                    false;

                break;
            }
        }
    }

    /*
     * Abrupt process death:
     *
     * No run.finished exists.
     *
     * Build a semantically valid
     * recovered transcript, but tell
     * Application that it must durably
     * close the old run before starting
     * another one.
     */
    // 遍历了所有的事件，发现openRun依然开启
    if (openRun) {
        sealPendingToolCalls(
            messages,
            pending,
            "interrupted",
        );
    }

    return {
        sessionId,

        workspaceRoot,

        messages,

        hasOpenRun:
        openRun,

        lastSequence:
            events.length - 1,
    };
}

/**
 * 把所有没有结果的 Tool Call 封口
 * @param messages
 * @param pending
 * @param status
 */
function sealPendingToolCalls(
    messages:
    ModelMessage[],

    pending:
    Map<
        string,
        PendingToolCall
    >,

    status:
    SessionRunStatus,
): void {
    // 循环遍历pending
    for (
        const {
            call,
            started,
        }
        of pending.values()
        ) {
        messages.push(
            createRecoveryToolMessage(
                call,
                started,
                status,
            ),
        );
    }
    // 清空pending
    pending.clear();
}

/**
 * 恢复ToolMessage
 * @param call
 * @param started
 * @param status
 */
function createRecoveryToolMessage(
    call:
    ToolCall,

    started:
    boolean,

    status:
    SessionRunStatus,
): ToolModelMessage {
    // 如果Tool开始执行了
    if (started) {
        return {
            role:
                "tool",

            toolCallId:
            call.id,

            toolName:
            call.name,

            isError:
                true,

            content:
                JSON.stringify({
                    error: {
                        code:
                            "unavailable",

                        message:
                            "The previous run ended after this tool call started but before a durable result was recorded. The operation may have produced partial or complete side effects. Re-inspect the environment before retrying.",

                        retryable:
                            false,

                        details: {
                            sessionRecovery:
                                true,

                            executionState:
                                "uncertain",

                            previousRunStatus:
                            status,
                        },
                    },
                }),
        };
    }
    // 如果没有开始
    return {
        role:
            "tool",

        toolCallId:
        call.id,

        toolName:
        call.name,

        isError:
            true,

        content:
            JSON.stringify({
                error: {
                    code:
                        "unavailable",

                    message:
                        "The previous run ended before this tool call started.",

                    retryable:
                        false,

                    details: {
                        sessionRecovery:
                            true,

                        executionState:
                            "not_started",

                        previousRunStatus:
                        status,
                    },
                },
            }),
    };
}