import { z } from "zod";
import { toJsonValue } from "../../core/shared/json.js";
import type { JsonObject, JsonValue } from "../../core/shared/json.js";
import type {Tool, ToolExecutionContext, ToolPreparation} from "../../core/tools/tool.js";
import type { ToolResult } from "../../core/tools/tool-result.js";
import type {PermissionAction} from "../../core/permissions/permission.js";
// 限制 描述字符
const MAX_PERMISSION_SUMMARY_CHARS =
    1_000;
// DefineTool的参数
export interface DefineToolOptions<
    TInput,
    TOutput extends JsonValue,
> {
    readonly name: string; // 工具名
    readonly description: string; //工具描述
    readonly schema: z.ZodType<TInput>; // 输入参数的唯一事实来源
    // 增加权限
    readonly permission: {
        readonly action:
            PermissionAction;

        describe(
            input: TInput,
        ): string;
    };

    execute(
        input: TInput,
        context: ToolExecutionContext,
    ): Promise<ToolResult<TOutput>>;
}
// 核心工厂函数
/**
 * 给出TInput，TOutput，以及name，description以及执行逻辑，就转为一个Tool
 * @param options
 */
export function defineTool<
    TInput,
    TOutput extends JsonValue,
>(
    options: DefineToolOptions<TInput, TOutput>,
): Tool{
    // 将Zod schema转为Json schema
    // 这个Schem做两个事情：1. 给模型和框架看，2.运行时校验输入
    const jsonSchema = z.toJSONSchema(options.schema, {
        io: "input",// 按输入方向生产
        target: "draft-07",// json的版本号
        unrepresentable: "throw",// 如果转换就直接抛错
    });
    // 强制工具输入必须是严格对象
    if (
        jsonSchema.type !== "object" ||
        jsonSchema.additionalProperties !== false // 不允许未声明字段
    ) {
        throw new Error(
            `Tool "${options.name}" must use a strict object input schema`,
        );
    }

    // 这里转换的是 Zod 生成的 Schema，模型的输入仍须在下面校验。
    const inputSchema = toJsonValue(jsonSchema) as JsonObject;
    // 冻结对象，防止工具定义注册之后被意外修改
    return Object.freeze({
        name: options.name,
        description: options.description,
        inputSchema,
        prepare(input: unknown): ToolPreparation {
            //解析input并校验input
            const parsed = options.schema.safeParse(input);
            // 如果input格式不正确
            if (!parsed.success) {
                return {
                    ok: false,
                    error: {
                        code: "invalid_input",
                        message: `Invalid arguments for tool: ${options.name}`,
                        retryable: false,
                        details: {
                            // 告诉LLM 哪些字段出了问题
                            issues: parsed.error.issues.map((issue) => ({
                                path: issue.path.map(String).join("."),
                                message: issue.message,
                            })),
                        },
                    },
                };
            }

            const normalized =
                toJsonValue(
                    parsed.data,
                );
            if (
                typeof normalized !==
                "object" ||
                normalized === null ||
                Array.isArray(
                    normalized,
                )
            ) {
                throw new Error(
                    `Tool "${options.name}" produced non-object normalized input`,
                );
            }
            // 工具的summary
            const rawSummary =
                options
                    .permission
                    .describe(
                        parsed.data,
                    )
                    .trim();
            if (
                rawSummary.length ===
                0
            ) {
                throw new Error(
                    `Tool "${options.name}" produced an empty permission summary`,
                );
            }
            // 对summary做处理，过长就直接截断
            const summary =
                rawSummary.length <=
                MAX_PERMISSION_SUMMARY_CHARS
                    ? rawSummary
                    : `${rawSummary.slice(
                        0,
                        MAX_PERMISSION_SUMMARY_CHARS,
                    )}…`;
            return {
                ok:
                    true as const,

                prepared: {
                    input:
                        normalized as
                            JsonObject,

                    permission: {
                        action:
                        options
                            .permission
                            .action,

                        summary,
                    },

                    async execute(
                        context:
                        ToolExecutionContext,
                    ) {
                        context.signal
                            .throwIfAborted();

                        return options
                            .execute(
                                parsed.data,

                                context,
                            );
                    },
                },
            };
        }

    });
}


