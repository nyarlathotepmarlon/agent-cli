import type {
    FunctionTool,
    ResponseInputItem,
} from "openai/resources/responses/responses";

import type {
    ModelMessage,
} from "../../../core/model/model-message.js";

import type {
    ModelProviderData,
} from "../../../core/model/model-provider-data.js";

import type {
    ModelToolDefinition,
} from "../../../core/model/model-tool-definition.js";

const OPENAI_PROVIDER =
    "openai";

const REPLAY_KIND =
    "responses_replay_items";

export function toOpenAIInput(
    messages:
    readonly ModelMessage[],// 内部消息数组

    modelId: string, // 当前的模型
): ResponseInputItem[] {
    // 创建返回的结果数组
    const input:
        ResponseInputItem[] = [];
    // 遍历内部的消息数组
    for (const message of messages) {
        // 根据内部消息的message.role来转换到对应的Openai的消息
        switch (message.role) {
            case "system": {
                //往Openai的结果数组中放一条System消息
                input.push({
                    role: "system",
                    content:
                    message.content,
                });

                break;
            }

            case "user": {
                // 往Openai的结果数组中放一条User消息
                input.push({
                    role: "user",
                    content:
                    message.content,
                });

                break;
            }

            case "assistant": {
                // 往Openai的结果数组中放入一条Assistant消息
                const replay =
                    getReplayItems(
                        message.providerData,
                        modelId,
                    );
                // 如果replay！==null，那么这条消息来自openai的模型
                if (replay !== null) {
                    // 直接放入
                    input.push(
                        ...replay,
                    );

                    break;
                }

                /*
                 * Cross-provider / legacy fallback.
                 *
                 * 如果没有 OpenAI providerData，
                 * 只能从语义层重建 assistant history。
                 */
                if (
                    message.content.length > 0
                ) {
                    // 插入一条assistantMessage
                    input.push({
                        role: "assistant",
                        content:
                        message.content,
                    });
                }
                // 如果当条assistantMessage中还有工具调用
                for (
                    const call
                    of message.toolCalls
                    ) {
                    // 插入function_call消息
                    input.push({
                        type:
                            "function_call",

                        call_id:
                        call.id,

                        name:
                        call.name,

                        arguments:
                            JSON.stringify(
                                call.input,
                            ),
                    });
                }

                break;
            }

            case "tool": {
                // 插入一条工具结果消息
                input.push({
                    type:
                        "function_call_output",

                    call_id:
                    message.toolCallId,

                    output:
                    message.content,
                });

                break;
            }

            default: {
                const unreachable:
                    never = message;

                throw new Error(
                    `Unsupported model message: ${String(
                        unreachable,
                    )}`,
                );
            }
        }
    }

    return input;
}

/**
 * 将内部定义的工具格式转为openai的工具格式
 * @param tools
 */
export function toOpenAITools(
    tools:
    readonly ModelToolDefinition[], // 内部定义的工具格式
): FunctionTool[]{
    return tools.map(
        (tool) => ({
            type: "function",

            name:
            tool.name,

            description:
            tool.description,

            parameters:
            tool.inputSchema,

            /*
             * Phase 5 再建立 strict-compatible
             * schema validator。
             */
            strict: false,
        }),
    );
}
// 恢复Openai原始历史
function getReplayItems(
    providerData:
        ModelProviderData | null,

    modelId: string,
): readonly ResponseInputItem[] | null {
    // 检查是否是对应的供应商以及模型
    if (
        providerData === null ||
        providerData.provider !==
        OPENAI_PROVIDER ||
        providerData.model !== modelId
    ) {
        return null;
    }
    // 获取数据
    const kind =
        providerData.data["kind"];

    const items =
        providerData.data["items"];

    if (
        kind !== REPLAY_KIND ||
        !Array.isArray(items)
    ) {
        return null;
    }

    /*
     * data 只能由 OpenAI Adapter 创建。
     * Session loader 在 Phase 12
     * 会再次做持久化数据 validation。
     */
    return items as unknown as
        readonly ResponseInputItem[];
}

export {
    OPENAI_PROVIDER,
    REPLAY_KIND,
};