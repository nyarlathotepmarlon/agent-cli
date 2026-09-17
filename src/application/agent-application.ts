import type {
    CancelledAgentState,
    CompletedAgentState,
    FailedAgentState,
    IdleAgentState,
    StoppedAgentState,
    TerminalAgentState,
} from "../core/agent/agent-state.js";

import type {
    AgentRuntime,
} from "../core/agent/agent-runtime.js";

import type {
    AgentToolRuntime,
} from "../core/agent/agent-tool-runtime.js";

import {
    createAgentState,
} from "../core/agent/create-agent-state.js";

import type {
    ExecutionBudgetLimits,
} from "../core/agent/execution-budget.js";

import type {
    ModelResolver,
    ModelSelection,
} from "./model-resolver.js";

import {
    DEFAULT_AGENT_SYSTEM_INSTRUCTIONS,
} from "./default-agent-instructions.js";
import type {PermissionMode} from "../core/permissions/permission.js";

export type AgentRunMode =
    | "interactive"
    | "non-interactive";

export interface AgentRunRequest {
    readonly prompt:
        string | null;

    readonly cwd:
        string;

    readonly mode:
        AgentRunMode;

    readonly model:
        ModelSelection;

    readonly signal:
        AbortSignal;
    readonly permissionMode:
        PermissionMode;
}

interface AgentRunResultBase {
    readonly prompt:
        string | null;

    readonly cwd:
        string;

    readonly mode:
        AgentRunMode;

    readonly model: {
        readonly provider:
            string;

        readonly id:
            string;
    };
}
// 等待输入：表示Agent尚未真正开始运行
export interface AwaitingInputAgentRunResult
    extends AgentRunResultBase {
    readonly status:
        "awaiting_input";

    readonly state:
        IdleAgentState;

    readonly output:
        null;
}
// 正常完成
export interface CompletedAgentRunResult
    extends AgentRunResultBase {
    readonly status:
        "completed";

    readonly state:
        CompletedAgentState;

    readonly output:
        string;
}
// 被停止
export interface StoppedAgentRunResult
    extends AgentRunResultBase {
    readonly status:
        "stopped";

    readonly state:
        StoppedAgentState;

    readonly output:
        string | null;// 可能产生部分回答，因此是string|null
}
// 被取消
export interface CancelledAgentRunResult
    extends AgentRunResultBase {
    readonly status:
        "cancelled";

    readonly state:
        CancelledAgentState;

    readonly output:
        string | null; //可能产生部分回答，因此是string/null
}
// 执行失败
export interface FailedAgentRunResult
    extends AgentRunResultBase {
    readonly status:
        "failed";

    readonly state:
        FailedAgentState;

    readonly output:
        string | null;
}
// 结果联合类型
export type AgentRunResult =
    | AwaitingInputAgentRunResult
    | CompletedAgentRunResult
    | StoppedAgentRunResult
    | CancelledAgentRunResult
    | FailedAgentRunResult;
// 整个应用层最对外暴露的接口
export interface AgentApplication {
    run(
        request: AgentRunRequest,
    ): Promise<AgentRunResult>;
}
export interface ToolRuntimeFactoryRequest {
    readonly cwd:
        string;

    readonly mode:
        AgentRunMode;

    readonly permissionMode:
        PermissionMode;

    readonly signal:
        AbortSignal;
}
// 默认AgentApplication实现的依赖配置
export interface DefaultAgentApplicationOptions {
    readonly limits:
        ExecutionBudgetLimits;

    readonly modelResolver:
        ModelResolver;

    readonly runtime:
        AgentRuntime;

    readonly createToolRuntime:
        (
            request:
            ToolRuntimeFactoryRequest,
        ) =>
            Promise<AgentToolRuntime>;

    readonly systemInstructions?:
        string;
}

export class DefaultAgentApplication
    implements AgentApplication
{
    private readonly systemInstructions:
        string;

    public constructor(
        private readonly options:
        DefaultAgentApplicationOptions,
    ) {

        this.systemInstructions =
            options.systemInstructions ??
            DEFAULT_AGENT_SYSTEM_INSTRUCTIONS;
    }

    public async run(
        request: AgentRunRequest,
    ): Promise<AgentRunResult> {
        request.signal
            .throwIfAborted();

        /*
         * Phase 4 暂时还没有 REPL。
         *
         * agent
         *
         * 先进入 awaiting_input，
         * 后续 CLI interactive phase
         * 再接真正 prompt loop。
         */
        // 如果用户没有输入任何prompt，状态就是等待输入
        if (
            request.prompt === null
        ) {
            return {
                status:
                    "awaiting_input",

                prompt:
                    null,

                cwd:
                request.cwd,

                mode:
                request.mode,

                model: {
                    provider:
                    request
                        .model
                        .provider,

                    id:
                    request
                        .model
                        .model,
                },

                state:
                    createAgentState(
                        this.options
                            .limits,
                    ),

                output:
                    null,
            };
        }
        const toolRuntime=await this.options.createToolRuntime({
            cwd:request.cwd, // 这是解析过后的工作区
            signal:request.signal,
            permissionMode:request.permissionMode,
            mode:request.mode,
        }
        )
        // 解析实际模型
        const model =
            this.options
                .modelResolver
                .resolve(
                    request.model,
                );
        // 创建Agent初始状态
        const initialState =
            createAgentState(
                this.options.limits,

                [
                    {
                        role:
                            "system",

                        content:
                            [
                                this.systemInstructions,

                                "",

                                `Workspace root: ${JSON.stringify(
                                    request.cwd,
                                )}`,
                            ].join("\n"),
                    },

                    {
                        role:
                            "user",

                        content:
                        request.prompt,
                    },
                ],
            );
        // 将领域状态转换为应用结果
        const state =
            await this.options
                .runtime
                .run(
                    {
                        state:
                        initialState,

                        model,

                        toolRuntime:
                        toolRuntime,

                        signal:
                        request.signal,
                    },
                );
        // 返回 AgentRunResult
        return createRunResult(
            request,
            state,
            model.provider,
            model.id,
        );
    }
}

function createRunResult(
    request: AgentRunRequest,
    state: TerminalAgentState,
    provider: string,
    modelId: string,
): AgentRunResult {
    // 获取最终LLM的输出，从消息数组中寻找最后一条assistant消息
    const output =
        getLastAssistantContent(
            state,
        );
    // 构造公共结果
    const base = {
        prompt:
        request.prompt,

        cwd:
        request.cwd,

        mode:
        request.mode,

        model: {
            provider,

            id:
            modelId,
        },
    } as const;
    // state的状态对应结果的状态
    switch (state.status) {
        case "completed":
            return {
                ...base,

                status:
                    "completed",

                state,

                output:
                    output ?? "",
            };

        case "stopped":
            return {
                ...base,

                status:
                    "stopped",

                state,

                output,
            };

        case "cancelled":
            return {
                ...base,

                status:
                    "cancelled",

                state,

                output,
            };

        case "failed":
            return {
                ...base,

                status:
                    "failed",

                state,

                output,
            };
    }
}

/**
 * 从消息数组中获取最后一条LLM返回的消息
 * @param state
 */
function getLastAssistantContent(
    state: TerminalAgentState,
): string | null {
    for (
        let index =
            state.messages.length - 1;

        index >= 0;

        index -= 1
    ) {
        const message =
            state.messages[index];

        if (
            message !== undefined &&
            message.role ===
            "assistant"
        ) {
            return message.content;
        }
    }

    return null;
}