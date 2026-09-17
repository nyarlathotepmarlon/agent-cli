import type {
    ModelToolDefinition,
} from "../model/model-tool-definition.js";

import type {
    PermissionAction,
} from "../permissions/permission.js";

import type {
    JsonObject,
} from "../shared/json.js";

import type {
    ToolError,
} from "./tool-error.js";

import type {
    ToolResult,
} from "./tool-result.js";

export interface ToolExecutionContext {
    readonly signal:
        AbortSignal;
}
// 描述Tool调用已经检查完了，可以进入待执行状态
export interface PreparedToolExecution {
    /**
     * Zod defaults and normalization
     * have already been applied.
     */
    readonly input:
        JsonObject;

    readonly permission: {
        readonly action:
            PermissionAction;

        readonly summary:
            string;
    };

    execute(
        context:
        ToolExecutionContext,
    ): Promise<ToolResult>;
}
// 工具预先准备的结果
export type ToolPreparation =
    | {
    readonly ok: true;

    readonly prepared:
        PreparedToolExecution;
}
    | {
    readonly ok: false;

    readonly error:
        ToolError;
};

export interface Tool
    extends ModelToolDefinition
{
    /**
     * 收到 unknown
     *     ↓
     *  prepare()
     *     ↓
     * 校验 / normalize / 权限判断
     *     ↓
     * PreparedToolExecution
     *     ↓
     *  execute(context)
     *     ↓
     * 真正执行
     * @param input
     */
    prepare(
        input: unknown,
    ): ToolPreparation;
}