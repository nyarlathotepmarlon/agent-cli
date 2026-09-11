import { z } from "zod";
import { toJsonValue } from "../../core/shared/json.js";
import type { JsonObject, JsonValue } from "../../core/shared/json.js";
import type { Tool, ToolExecutionContext } from "../../core/tools/tool.js";
import type { ToolResult } from "../../core/tools/tool-result.js";

// DefineTool的参数
export interface DefineToolOptions<
    TInput,
    TOutput extends JsonValue,
> {
    readonly name: string; // 工具名
    readonly description: string; //工具描述
    readonly schema: z.ZodType<TInput>; // 输入参数的唯一事实来源

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
): Tool<unknown, TOutput> {
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

        async execute(
            input: unknown,
            context: ToolExecutionContext,
        ): Promise<ToolResult<TOutput>> {

            context.signal.throwIfAborted();
            // 解析input
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
            // 如果input解析成功，返回执行的结果
            return options.execute(parsed.data, context);
        },
    });
}


