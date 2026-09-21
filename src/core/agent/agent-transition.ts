import type {
    CancelledAgentState,
    CompletedAgentState,
    FailedAgentState,
    IdleAgentState,
    RunningAgentState,
    StoppedAgentState,
} from "./agent-state.js";

import type { ModelResponse } from "../model/model-response.js";

import type { ToolCall } from "../tools/tool-call.js";

import type { ToolResult } from "../tools/tool-result.js";

import {
    recordModelUsage,
    recordToolCall,
} from "./execution-budget.js";

import type {
    BudgetStopReason,
    ControlledStopReason,
    FailureStopReason,
} from "./stop-reason.js";
import {renderToolResult} from "../tools/render-tool-result.js";

/**
 *                     ┌─────────────┐
 *                     │    Idle     │
 *                     └──────┬──────┘
 *                            │ start
 *                            ▼
 *                     ┌─────────────┐
 *               ┌────►│   Running   │◄────┐
 *               │     └──────┬──────┘     │
 *               │            │            │
 *       model response       │        tool result
 *               │            │            │
 *               └────────────┴────────────┘
 *                            │
 *              ┌─────────────┼───────────────┐
 *              │             │               │
 *              ▼             ▼               ▼
 *         Completed       Stopped        Cancelled
 *
 *                            │
 *                            ▼
 *                          Failed
 */

/**
 * idle状态转为running状态
 * @param state idle状态
 */
export function startAgent(
    state: IdleAgentState,
): RunningAgentState {
    return {
        ...state,
        status: "running",
    };
}

/**
 * 只有再running状态
 * @param state running状态
 * @param response LLM response
 */
export function recordModelResponse(
    state: RunningAgentState,
    response: ModelResponse,
): RunningAgentState {
    // 获取最新的budget
    const budget = recordModelUsage(
        state.budget,
        response.usage,
    );

    const turn = budget.usage.turns;

    return {
        ...state,

        messages: [
            ...state.messages,
            response.message,
        ],

        steps: [
            ...state.steps,
            {
                kind: "model",
                turn,
                response,
            },
        ],

        budget,
    };
}

/**
 * 再running的状态才能记录工具调用
 * @param state running状态
 * @param call 要调用的工具
 * @param result 工具的结果
 */
export function recordToolResult(
    state: RunningAgentState,
    call: ToolCall,
    result: ToolResult,
): RunningAgentState {
    // 更新budget
    const budget =
        recordToolCall(state.budget);
    // 获取工具的结果(string化)
    const content =
        renderToolResult(result);

    return {
        ...state,
        // 将ToolMessage加入messages数组
        messages: [
            ...state.messages,
            {
                role: "tool",
                toolCallId: call.id,
                toolName: call.name,
                content,
                isError: !result.ok,
            },
        ],
        // 更新step，加入toolStep
        steps: [
            ...state.steps,
            {
                kind: "tool",
                turn: state.budget.usage.turns,
                call,
                result,
            },
        ],

        budget,
    };
}

/**
 * running状态转为complete状态
 * @param state running状态
 */
export function completeAgent(
    state: RunningAgentState,
): CompletedAgentState {
    return {
        ...state,

        status: "completed",

        stopReason: {
            kind: "completed",
        },
    };
}

/**
 * 将running状态转为stop状态
 * @param state running状态
 * @param reason stop原因：超过turns，超过tool-calls，超过tokens
 */
export function stopAgentForBudget(
    state: RunningAgentState,
    reason: BudgetStopReason,
): StoppedAgentState {
    return {
        ...state,

        status: "stopped",

        stopReason: reason,
    };
}
/**
 * 将running状态转为stop状态
 * @param state running状态
 * @param reason stop原因：包括BudgetStopReason以及ModelStopReason
 */
export function stopAgent(
    state: RunningAgentState,
    reason: ControlledStopReason,
): StoppedAgentState {
    return {
        ...state,

        status: "stopped",

        stopReason: reason,
    };
}
/**
 * 将running状态转为cancelled状态
 * @param state running状态
 * @param reason called理由
 */
export function cancelAgent(
    state: RunningAgentState,
    reason: string | null,
): CancelledAgentState {
    return {
        ...state,

        status: "cancelled",

        stopReason: {
            kind: "cancelled",
            reason,
        },
    };
}

/**
 * 将running状态转为fail状态
 * @param state running状态
 * @param reason 失败理由：模型错误或者运行时错误
 */
export function failAgent(
    state: RunningAgentState,
    reason: FailureStopReason,
): FailedAgentState {
    return {
        ...state,

        status: "failed",

        stopReason: reason,
    };
}

