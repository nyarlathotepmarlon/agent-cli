import type {
    JsonObject,
} from "../shared/json.js";

/**
 *             PermissionRequest
 *                     │
 *                     ▼
 *            PermissionPolicy
 *                     │
 *           ┌─────────┼─────────┐
 *           │         │         │
 *         allow      ask       deny
 *           │         │         │
 *           │         ▼         │
 *           │   PermissionApprover
 *           │         │
 *           │      ┌──┴──┐
 *           │      │     │
 *           │     yes    no
 *           │      │     │
 *           ▼      ▼     ▼
 *         ┌──────────────────┐
 *         │ Permission       │
 *         │ Authorization    │
 *         └──────────────────┘
 */
// 权限模型
export const PERMISSION_MODES = [
    "read-only",// 只能读取，不能修改、执行
    "safe",// 允许低风险操作，高风险操作询问
    "auto-edit",// 自动修改文件，但危险命令仍要询问
    "full-access",// 最大权限
] as const;

export type PermissionMode =
    typeof PERMISSION_MODES[number];
// 定义工具究竟准备做什么事情
export type PermissionAction =
    | "local.compute"
    | "workspace.read"
    | "workspace.search"
    | "workspace.write"
    | "process.execute";

// 权限请求
export interface PermissionRequest {
    readonly callId: string; //工具调用的唯一标识

    readonly toolName: string;//什么工具提出的申请

    readonly action:
        PermissionAction;// 工具动作

    // summary 必须由真正知道工具行为的 tool implementation 生成。
    readonly summary: string;

    /**
     * 权限判断与真正执行的数据必须尽量一致
     */
    readonly input:
        JsonObject;
}
// 建模 权限审批 结果
export type PermissionPolicyDecision =
    | {
    readonly kind: "allow";

    readonly reason: string;
}
    | {
    readonly kind: "ask";

    readonly reason: string;
}
    | {
    readonly kind: "deny";

    readonly reason: string;
};
// 策略层：根据当前权限模式和PermissionRequest，判断应该结果
export interface PermissionPolicy {
    decide(
        request: PermissionRequest,
    ): PermissionPolicyDecision;
}
// 专门处理询问用户的
export interface PermissionApprover {
    approve(
        request: PermissionRequest,
        signal: AbortSignal,
    ): Promise<boolean>;
}
// 最终到底能不能执行
export type PermissionAuthorization =
    | {
    readonly allowed: true;

    readonly source:
        "policy" | "user";
}
    | {
    readonly allowed: false;

    readonly reason:
        | "policy_denied"
        | "approval_required"// 在没有用户审批能力的时候，最终无法授权
        | "user_denied";

    readonly message:
        string;
};
// 对外主要的接口
export interface PermissionAuthorizer {
    authorize(
        request: PermissionRequest,
        signal: AbortSignal,
    ): Promise<PermissionAuthorization>;
}

/**
 * 将外部的普通string转换成可信的PermissionMode
 * @param value
 */
export function parsePermissionMode(
    value: string,
): PermissionMode {
    if (
        (
            PERMISSION_MODES as
                readonly string[]
        ).includes(value)
    ) {
        return value as
            PermissionMode;
    }

    throw new Error(
        `Invalid permission mode: ${value}`,
    );
}