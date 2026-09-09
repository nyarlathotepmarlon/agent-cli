import type {
    Model,
    ModelRequest,
} from "../model/model.js";

import {
    ModelError,
} from "../model/model-error.js";

import type {
    ModelResponse,
} from "../model/model-response.js";

import type {
    IdleAgentState,
    RunningAgentState,
    TerminalAgentState,
} from "./agent-state.js";

import type {
    AgentToolRuntime,
} from "./agent-tool-runtime.js";

import type {
    Delay,
} from "./delay.js";

import {
    getBudgetStopReason,
} from "./execution-budget.js";

import type {
    ModelRetryPolicy,
} from "./model-retry-policy.js";

import type {
    ModelStopReason,
} from "./stop-reason.js";

import {
    cancelAgent,
    completeAgent,
    failAgent,
    recordModelResponse,
    recordToolResult,
    startAgent,
    stopAgent,
    stopAgentForBudget,
} from "./agent-transition.js";
//描述运行一次Agent必须提供的东西
export interface AgentRuntimeRequest {
    readonly state:
        IdleAgentState;

    readonly model:
        Model;

    readonly toolRuntime:
        AgentToolRuntime;

    readonly signal:
        AbortSignal;
}

export interface AgentRuntime {
    run(
        request: AgentRuntimeRequest,
    ): Promise<TerminalAgentState>;
}

type ModelCallResult =
    | {
    readonly ok: true;

    readonly response:
        ModelResponse;
}
    | {
    readonly ok: false;

    readonly error:
        ModelError;

    readonly attempts:
        number;
};

type ModelDecision =
    | {
    readonly kind:
        "complete";
}
    | {
    readonly kind:
        "tools";
}
    | {
    readonly kind:
        "stop";

    readonly reason:
        ModelStopReason;
}
    | {
    readonly kind:
        "invalid";

    readonly message:
        string;
};

export class DefaultAgentRuntime
    implements AgentRuntime
{
    public constructor(
        private readonly retryPolicy:
        ModelRetryPolicy,

        private readonly delay:
        Delay,
    ) {}

    public async run(
        request:
        AgentRuntimeRequest,
    ): Promise<TerminalAgentState> {
        let state =
            startAgent(
                request.state,
            );

        try {
            while (true) {
                // 每一轮开始检查 用户是否已经取消Agent
                if (
                    request.signal
                        .aborted
                ) {
                    return cancelAgent(
                        state,
                        getAbortReason(
                            request.signal,
                        ),
                    );
                }

                // 第一层预算网关
                const budgetReason =
                    getBudgetStopReason(
                        state.budget,
                    );

                if (
                    budgetReason !== null
                ) {
                    // 超出预算，直接停止
                    return stopAgentForBudget(
                        state,
                        budgetReason,
                    );
                }
                // 构造ModelRequest
                const modelRequest:
                    ModelRequest =
                    {
                        messages:
                        state.messages,

                        tools:
                        request
                            .toolRuntime
                            .definitions,
                    };
                // 调用模型
                const generated =
                    await this
                        .generateWithRetry(
                            request.model,
                            modelRequest,
                            request.signal,
                        );
                // 模型彻底失败
                if (!generated.ok) {
                    return failAgent(
                        state,
                        {
                            kind:
                                "model_error",

                            code:
                            generated
                                .error
                                .code,

                            provider:
                            generated
                                .error
                                .provider,

                            message:
                            generated
                                .error
                                .message,

                            retryable:
                            generated
                                .error
                                .retryable,

                            status:
                            generated
                                .error
                                .status,

                            requestId:
                            generated
                                .error
                                .requestId,

                            attempts:
                            generated
                                .attempts,
                        },
                    );
                }
                // 调用模型成功
                // 更新state维护的turns以及预算
                state =
                    recordModelResponse(
                        state,
                        generated.response,
                    );
                // 对模型回复进行分类
                const decision =
                    classifyModelResponse(
                        generated.response,
                    );
                // 如果是非法回复
                if (
                    decision.kind ===
                    "invalid"
                ) {
                    return failAgent(
                        state,
                        {
                            kind:
                                "runtime_error",

                            message:
                            decision.message,
                        },
                    );
                }
                // 如果是完成
                if (
                    decision.kind ===
                    "complete"
                ) {
                    return completeAgent(
                        state,
                    );
                }
                // 如果是停止
                if (
                    decision.kind ===
                    "stop"
                ) {
                    return stopAgent(
                        state,
                        decision.reason,
                    );
                }

                /*
                 * Model 已经消费了一轮。
                 *
                 * 如果此时 budget 达到 hard
                 * limit，不再产生外部 side effect。
                 */
                // 在模型已经消费一轮后，再次检查budget
                const postModelBudget =
                    getBudgetStopReason(
                        state.budget,
                    );
                // 如果达到预算，就不再任何model所需要的tool
                if (
                    postModelBudget !==
                    null
                ) {
                    return stopAgentForBudget(
                        state,
                        postModelBudget,
                    );
                }

                for (
                    const call
                    of generated
                    .response
                    .message
                    .toolCalls
                    ) {
                    // 每个工具执行前都判断是否被取消
                    if (
                        request.signal
                            .aborted
                    ) {
                        return cancelAgent(
                            state,
                            getAbortReason(
                                request.signal,
                            ),
                        );
                    }

                    // 每次工具调用之前都检查budget，因此每次调用工具之后都会更新budget
                    const toolBudget =
                        getBudgetStopReason(
                            state.budget,
                        );

                    if (
                        toolBudget !== null
                    ) {
                        // 超出预算
                        return stopAgentForBudget(
                            state,
                            toolBudget,
                        );
                    }
                    // 执行具体的tool调用
                    const result =
                        await request
                            .toolRuntime
                            .execute(
                                call,
                                {
                                    signal:
                                    request.signal,
                                },
                            );
                    // 更新state中的budget
                    state =
                        recordToolResult(
                            state,
                            call,
                            result,
                        );
                }
            }
        } catch (error) {
            // 出现预期之外的错误，首先检查是否中断，很多异步函数在取消的时候行为是抛异常
            if (
                request.signal
                    .aborted
            ) {
                return cancelAgent(
                    state,
                    getAbortReason(
                        request.signal,
                    ),
                );
            }

            return failAgent(
                state,
                {
                    kind:
                        "runtime_error",

                    message:
                        getErrorMessage(
                            error,
                        ),
                },
            );
        }
    }

    /**
     * 调用model，根据retryPolicy决定是否重试
     * @param model
     * @param request
     * @param signal
     * @private
     */
    private async generateWithRetry(
        model: Model,
        request: ModelRequest,
        signal: AbortSignal,
    ): Promise<ModelCallResult> {
        // 设置重试次数
        let attempt = 0;

        while (true) {
            attempt += 1;
            // 每次调用模型之前，都要判断是否取消
            signal.throwIfAborted();

            try {
                return {
                    ok: true,

                    response:
                        await model.generate(
                            request,
                            signal,
                        ),
                };
            } catch (error) {
                // 如果是用户取消，直接抛出异常，让上层去处理
                if (signal.aborted) {
                    throw error;
                }

                /*
                 * 非 ModelError 说明违反了
                 * Model Port 的错误契约。
                 *
                 * 交给外层作为 runtime_error。
                 */
                if (
                    !(
                        error instanceof
                        ModelError
                    )
                ) {
                    throw error;
                }
                // 判断该次请求是否应该重试
                if (
                    !this.retryPolicy
                        .shouldRetry(
                            error,
                            attempt,
                        )
                ) {
                    return {
                        ok: false,

                        error,

                        attempts:
                        attempt,
                    };
                }
                // 计算等待时间
                const delayMs =
                    this.retryPolicy
                        .getDelayMs(
                            attempt,
                        );
                // 等待重试
                await this.delay.wait(
                    delayMs,
                    signal,
                );
            }
        }
    }
}

/**
 * 外部Model Response--> Runtime Decision
 * @param response
 */
function classifyModelResponse(
    response:
    ModelResponse,
): ModelDecision {
    // 计算Tool call的数量
    const toolCallCount =
        response.message
            .toolCalls
            .length;

    /*
     * Provider Adapter 必须满足：
     *
     * tool calls present
     *      ↕
     * finishReason === tool_calls
     */
    if (
        toolCallCount > 0 &&
        response.finishReason !==
        "tool_calls"
    ) {
        return {
            kind:
                "invalid",

            message:
                "Model response contains tool calls but finishReason is not tool_calls",
        };
    }

    if (
        toolCallCount === 0 &&
        response.finishReason ===
        "tool_calls"
    ) {
        return {
            kind:
                "invalid",

            message:
                "Model response has finishReason tool_calls but contains no tool calls",
        };
    }
    // 映射分类
    switch (
        response.finishReason
        ) {
        case "completed":
            return {
                kind:
                    "complete",
            };

        case "tool_calls":
            return {
                kind:
                    "tools",
            };

        case "max_output_tokens":
            return {
                kind:
                    "stop",

                reason: {
                    kind:
                        "max_output_tokens",
                },
            };

        case "content_filter":
            return {
                kind:
                    "stop",

                reason: {
                    kind:
                        "content_filter",
                },
            };

        case "refused":
            return {
                kind:
                    "stop",

                reason: {
                    kind:
                        "model_refused",
                },
            };

        case "unknown":
            return {
                kind:
                    "stop",

                reason: {
                    kind:
                        "unknown_model_finish_reason",

                    finishReason:
                    response
                        .finishReason,
                },
            };
    }
}

function getAbortReason(
    signal: AbortSignal,
): string | null {
    const reason =
        signal.reason;

    if (reason === undefined) {
        return null;
    }

    if (
        reason instanceof Error
    ) {
        return reason.message;
    }

    return String(reason);
}

function getErrorMessage(
    error: unknown,
): string {
    if (
        error instanceof Error
    ) {
        return error.message;
    }

    return String(error);
}