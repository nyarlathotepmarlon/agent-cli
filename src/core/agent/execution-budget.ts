import type { ModelUsage } from "../model/model-response.js";
import type { BudgetStopReason } from "./stop-reason.js";
export interface ExecutionBudgetLimits {
    readonly maxTurns: number;
    readonly maxToolCalls: number;
    readonly maxTotalTokens: number | null;
}

export interface ExecutionBudgetUsage {
    readonly turns: number;
    readonly toolCalls: number;
    readonly totalTokens: number;
}

export interface ExecutionBudget {
    readonly limits: ExecutionBudgetLimits;
    readonly usage: ExecutionBudgetUsage;
}

export function createExecutionBudget(
    limits: ExecutionBudgetLimits,
): ExecutionBudget {
    assertPositiveInteger(
        limits.maxTurns,
        "maxTurns",
    );

    assertPositiveInteger(
        limits.maxToolCalls,
        "maxToolCalls",
    );

    if (limits.maxTotalTokens !== null) {
        assertPositiveInteger(
            limits.maxTotalTokens,
            "maxTotalTokens",
        );
    }

    return {
        limits,
        usage: {
            turns: 0,
            toolCalls: 0,
            totalTokens: 0,
        },
    };
}

/**
 * 将当次成本加入原有的成本
 * @param budget 原有的budget limits和budget usages
 * @param usage 这一轮的usage
 */
export function recordModelUsage(
    budget: ExecutionBudget,
    usage: ModelUsage | null,
): ExecutionBudget {
    // 计算档当次使用的tokens
    const addedTokens =
        usage === null
            ? 0
            : usage.inputTokens + usage.outputTokens;

    return {
        ...budget,

        usage: {
            ...budget.usage,

            turns: budget.usage.turns + 1,

            totalTokens:
                budget.usage.totalTokens +
                addedTokens,
        },
    };
}

/**
 * 记录工具调用的次数
 * @param budget
 */
export function recordToolCall(
    budget: ExecutionBudget,
): ExecutionBudget {
    return {
        ...budget,

        usage: {
            ...budget.usage,

            toolCalls:
                budget.usage.toolCalls + 1,
        },
    };
}

function assertPositiveInteger(
    value: number,
    field: string,
): void {
    if (
        !Number.isSafeInteger(value) ||
        value <= 0
    ) {
        throw new RangeError(
            `${field} must be a positive safe integer`,
        );
    }
}

/**
 * 判断有没有超过对应的限制
 * @param budget 传入运行时的budget
 */
export function getBudgetStopReason(
    budget: ExecutionBudget,
): BudgetStopReason | null {
    const { limits, usage } = budget;

    if (usage.turns >= limits.maxTurns) {
        return {
            kind: "max_turns",
            limit: limits.maxTurns,
            used: usage.turns,
        };
    }

    if (
        usage.toolCalls >=
        limits.maxToolCalls
    ) {
        return {
            kind: "max_tool_calls",
            limit: limits.maxToolCalls,
            used: usage.toolCalls,
        };
    }

    if (
        limits.maxTotalTokens !== null &&
        usage.totalTokens >=
        limits.maxTotalTokens
    ) {
        return {
            kind: "max_total_tokens",
            limit: limits.maxTotalTokens,
            used: usage.totalTokens,
        };
    }

    return null;
}