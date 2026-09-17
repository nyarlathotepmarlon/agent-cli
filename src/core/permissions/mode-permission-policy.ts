import type {
    PermissionAction,
    PermissionMode,
    PermissionPolicy,
    PermissionPolicyDecision,
    PermissionRequest,
} from "./permission.js";

type DecisionKind =
    PermissionPolicyDecision["kind"];

const POLICY_MATRIX = {
    "read-only": {
        "local.compute":
            "allow",

        "workspace.read":
            "allow",

        "workspace.search":
            "allow",

        "workspace.write":
            "deny",

        "process.execute":
            "deny",
    },

    "safe": {
        "local.compute":
            "allow",

        "workspace.read":
            "allow",

        "workspace.search":
            "allow",

        "workspace.write":
            "ask",

        "process.execute":
            "ask",
    },

    "auto-edit": {
        "local.compute":
            "allow",

        "workspace.read":
            "allow",

        "workspace.search":
            "allow",

        "workspace.write":
            "allow",

        "process.execute":
            "ask",
    },

    "full-access": {
        "local.compute":
            "allow",

        "workspace.read":
            "allow",

        "workspace.search":
            "allow",

        "workspace.write":
            "allow",

        "process.execute":
            "allow",
    },
} satisfies Record<
    PermissionMode,
    Record<
        PermissionAction,
        DecisionKind
    >
>;

/**
 * 权限策略
 */
export class ModePermissionPolicy
    implements PermissionPolicy
{
    public constructor(
        private readonly mode:
        PermissionMode,
    ) {}

    /**
     * 根据当前的mode和请求的action，返回策略决定
     * @param request
     */
    public decide(
        request: PermissionRequest,
    ): PermissionPolicyDecision {
        // 通过mode以及action查询策略矩阵
        const decision =
            POLICY_MATRIX[
                this.mode
                ][
                request.action
                ];
        //根据查询的结果
        switch (decision) {
            case "allow":
                return {
                    kind:
                        "allow",

                    reason:
                        `Permission mode "${this.mode}" allows ${request.action}`,
                };

            case "ask":
                return {
                    kind:
                        "ask",

                    reason:
                        `Permission mode "${this.mode}" requires approval for ${request.action}`,
                };

            case "deny":
                return {
                    kind:
                        "deny",

                    reason:
                        `Permission mode "${this.mode}" denies ${request.action}`,
                };
        }
    }
}