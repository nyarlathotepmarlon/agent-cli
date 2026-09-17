import {
    describe,
    expect,
    it,
    vi
} from "vitest";

import {
    ModePermissionPolicy,
} from "../../../src/core/permissions/mode-permission-policy.js";

import type {
    PermissionRequest,
} from "../../../src/core/permissions/permission.js";
import {DefaultPermissionAuthorizer} from "../../../src/core/permissions/default-permission-authorizer.js";
import {DefaultAgentToolRuntime} from "../../../src/core/tools/default-agent-tool-runtime.js";
import {ToolRegistry} from "../../../src/core/tools/tool-registry.js";
import {defineTool} from "../../../src/infrastructure/tools/define-tool.js";
import {z} from "zod";

function request(
    action:
    PermissionRequest["action"],
): PermissionRequest {
    return {
        callId:
            "call_1",

        toolName:
            "test_tool",

        action,

        summary:
            "test",

        input: {},
    };
}

describe(
    "ModePermissionPolicy",
    () => {
        it(
            "allows read-only observations in safe mode",
            () => {
                const policy =
                    new ModePermissionPolicy(
                        "safe",
                    );

                expect(
                    policy.decide(
                        request(
                            "workspace.read",
                        ),
                    ).kind,
                ).toBe(
                    "allow",
                );

                expect(
                    policy.decide(
                        request(
                            "workspace.search",
                        ),
                    ).kind,
                ).toBe(
                    "allow",
                );
            },
        );

        it(
            "asks before mutations in safe mode",
            () => {
                const policy =
                    new ModePermissionPolicy(
                        "safe",
                    );

                expect(
                    policy.decide(
                        request(
                            "workspace.write",
                        ),
                    ).kind,
                ).toBe(
                    "ask",
                );

                expect(
                    policy.decide(
                        request(
                            "process.execute",
                        ),
                    ).kind,
                ).toBe(
                    "ask",
                );
            },
        );

        it(
            "denies side effects in read-only mode",
            () => {
                const policy =
                    new ModePermissionPolicy(
                        "read-only",
                    );

                expect(
                    policy.decide(
                        request(
                            "workspace.write",
                        ),
                    ).kind,
                ).toBe(
                    "deny",
                );
            },
        );
    },
);
it(
    "allows an ask decision after user approval",
    async () => {
        const approver = {
            approve:
                vi.fn(
                    async () =>
                        true,
                ),
        };

        const authorizer =
            new DefaultPermissionAuthorizer(
                new ModePermissionPolicy(
                    "safe",
                ),

                approver,
            );

        const result =
            await authorizer
                .authorize(
                    {
                        callId:
                            "call_1",

                        toolName:
                            "edit_file",

                        action:
                            "workspace.write",

                        summary:
                            "Edit src/a.ts",

                        input: {
                            path:
                                "src/a.ts",
                        },
                    },

                    new AbortController()
                        .signal,
                );

        expect(
            result,
        ).toEqual({
            allowed:
                true,

            source:
                "user",
        });

        expect(
            approver.approve,
        ).toHaveBeenCalledOnce();
    },
);
it(
    "allows an ask decision after user approval",
    async () => {
        const approver = {
            approve:
                vi.fn(
                    async () =>
                        true,
                ),
        };

        const authorizer =
            new DefaultPermissionAuthorizer(
                new ModePermissionPolicy(
                    "safe",
                ),

                approver,
            );

        const result =
            await authorizer
                .authorize(
                    {
                        callId:
                            "call_1",

                        toolName:
                            "edit_file",

                        action:
                            "workspace.write",

                        summary:
                            "Edit src/a.ts",

                        input: {
                            path:
                                "src/a.ts",
                        },
                    },

                    new AbortController()
                        .signal,
                );

        expect(
            result,
        ).toEqual({
            allowed:
                true,

            source:
                "user",
        });

        expect(
            approver.approve,
        ).toHaveBeenCalledOnce();
    },
);
it(
    "rejects invalid input before permission authorization",
    async () => {
        const authorize =
            vi.fn();

        const authorizer = {
            authorize,
        };

        const execute =
            vi.fn(
                async () => ({
                    ok:
                        true as const,

                    output:
                        "ok",
                }),
            );

        const tool =
            defineTool({
                name:
                    "dangerous_tool",

                description:
                    "A test tool.",

                schema:
                    z.strictObject({
                        value:
                            z.number(),
                    }),

                permission: {
                    action:
                        "workspace.write",

                    describe:
                        () =>
                            "Dangerous action",
                },

                execute,
            });

        const runtime =
            new DefaultAgentToolRuntime(
                new ToolRegistry([
                    tool,
                ]),

                authorizer,
            );

        const result =
            await runtime.execute(
                {
                    id:
                        "call_1",

                    name:
                        "dangerous_tool",

                    input: {
                        value:
                            "not-number",
                    },
                },

                {
                    signal:
                    new AbortController()
                        .signal,
                },
            );

        expect(
            result,
        ).toMatchObject({
            ok:
                false,

            error: {
                code:
                    "invalid_input",
            },
        });

        expect(
            authorize,
        ).not
            .toHaveBeenCalled();

        expect(
            execute,
        ).not
            .toHaveBeenCalled();
    },
);
it(
    "denies ask decisions when no approval channel exists",
    async () => {
        const authorizer =
            new DefaultPermissionAuthorizer(
                new ModePermissionPolicy(
                    "safe",
                ),

                null,
            );

        const result =
            await authorizer
                .authorize(
                    {
                        callId:
                            "call_1",

                        toolName:
                            "run_command",

                        action:
                            "process.execute",

                        summary:
                            "Run pnpm test",

                        input: {
                            command:
                                "pnpm",
                        },
                    },

                    new AbortController()
                        .signal,
                );

        expect(
            result,
        ).toMatchObject({
            allowed:
                false,

            reason:
                "approval_required",
        });
    },
);