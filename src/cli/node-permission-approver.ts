import {
    createInterface,
} from "node:readline/promises";

import type {
    PermissionApprover,
    PermissionRequest,
} from "../core/permissions/permission.js";

/**
 * 运行在Node.js命令行环境中的权限确认器
 */
export class NodePermissionApprover
    implements PermissionApprover
{
    public async approve(
        request:
        PermissionRequest,

        signal:
        AbortSignal,
    ): Promise<boolean> {
        // 快速失败
        signal.throwIfAborted();
        // 创建命令行交互接口
        const readline =
            createInterface({
                input:
                process.stdin,

                output:
                process.stderr,

                terminal:
                    true,
            });
        // 打印权限信息
        try {
            process.stderr.write(
                [
                    "",
                    "Permission required",
                    `  Tool:   ${request.toolName}`,
                    `  Action: ${request.action}`,
                    `  Request: ${request.summary}`,
                    "",
                ].join(
                    "\n",
                ),
            );
            // 接受用户回答
            const answer =
                await readline
                    .question(
                        "Allow once? [y/N] ",

                        {
                            signal,
                        },
                    );
            // 用户输入y或者yes，就代表同一，反之不同意
            return /^(?:y|yes)$/iu
                .test(
                    answer.trim(),
                );
        } catch (error) {
            if (
                signal.aborted
            ) {
                signal
                    .throwIfAborted();
            }

            throw error;
        } finally {
            readline.close();
        }
    }
}