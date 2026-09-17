import type {
    PermissionApprover,
    PermissionAuthorization,
    PermissionAuthorizer,
    PermissionPolicy,
    PermissionRequest,
} from "./permission.js";

/**
 * 具体授权器的实现
 */
export class DefaultPermissionAuthorizer
    implements PermissionAuthorizer
{
    public constructor(
        private readonly policy:
        PermissionPolicy,

        /**
         * null means:
         * there is no interactive
         * approval channel.
         */
        private readonly approver:
            PermissionApprover | null,// approver=null代表没有交互能力
    ) {}

    /**
     * 接受request，返回最终的权限决策
     * @param request
     * @param signal
     */
    public async authorize(
        request:
        PermissionRequest,

        signal:
        AbortSignal,
    ): Promise<PermissionAuthorization> {
        // 快速失败
        signal.throwIfAborted();
        // 通过权限策略获取对应的 策略决定
        const decision =
            this.policy.decide(
                request,
            );
        // 处理策略决定的三个结果
        switch (decision.kind) {
            case "allow":
                return {
                    allowed:
                        true,

                    source:
                        "policy",
                };

            case "deny":
                return {
                    allowed:
                        false,

                    reason:
                        "policy_denied",

                    message:
                    decision.reason,
                };
            // 需要用户审批
            case "ask": {
                /*
                 * Non-interactive environment:
                 *
                 * never silently escalate
                 * ask -> allow.
                 */
                if (
                    this.approver === null
                ) {
                    return {
                        allowed:
                            false,

                        reason:
                            "approval_required",

                        message:
                            `Permission required for ${request.toolName}, but interactive approval is unavailable`,
                    };
                }
                // 有交互能力的情况，与用户进行交互
                const approved =
                    await this.approver
                        .approve(
                            request,

                            signal,
                        );

                signal.throwIfAborted();
                // 根据用户的决定，返回对应的最终授权
                if (!approved) {
                    return {
                        allowed:
                            false,

                        reason:
                            "user_denied",

                        message:
                            `User denied permission for ${request.toolName}`,
                    };
                }

                return {
                    allowed:
                        true,

                    source:
                        "user",
                };
            }
        }
    }
}