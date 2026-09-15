import {
    afterEach,
    beforeEach,
    expect,
    it,
} from "vitest";

import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";

import {
    tmpdir,
} from "node:os";

import * as path
    from "node:path";

import {
    NodeWorkspace,
} from "../../../src/infrastructure/workspace/node-workspace.js";


let temporary: string;

let root: string;

let workspace: NodeWorkspace;


/**
 * 每个测试使用一个独立 AbortSignal。
 */
function signal(): AbortSignal {
    return new AbortController()
        .signal;
}


beforeEach(
    async () => {
        /*
         * 创建：
         *
         * <系统临时目录>/
         *   agentcli-phase8-xxxxxx/
         *     repo/
         *       src/
         */
        temporary =
            await mkdtemp(
                path.join(
                    tmpdir(),
                    "agentcli-phase8-",
                ),
            );

        root =
            path.join(
                temporary,
                "repo",
            );

        /*
         * stale edit 测试会写：
         *
         * src/auth.ts
         *
         * 所以 src 必须先存在。
         */
        await mkdir(
            path.join(
                root,
                "src",
            ),
            {
                recursive: true,
            },
        );

        /*
         * 创建真正用于测试的 Workspace。
         */
        workspace =
            await NodeWorkspace
                .create(
                    root,
                    signal(),
                );
    },
);


afterEach(
    async () => {
        /*
         * 防御性检查。
         *
         * 测试 cleanup 用 rm recursive，
         * 所以一定要确认删除的是我们刚才创建的临时目录。
         */
        const target =
            path.resolve(
                temporary,
            );

        const tempRoot =
            path.resolve(
                tmpdir(),
            );

        if (
            path.dirname(
                target,
            ) !== tempRoot ||
            !path.basename(
                target,
            ).startsWith(
                "agentcli-phase8-",
            )
        ) {
            throw new Error(
                "Refusing to remove an unexpected test directory",
            );
        }

        await rm(
            target,
            {
                recursive: true,
                force: true,
            },
        );
    },
);


it(
    "rejects a stale edit without overwriting the user's changes",
    async () => {
        const target =
            path.join(
                root,
                "src",
                "auth.ts",
            );

        /*
         * Version A
         *
         * 这是 Agent 第一次读取时看到的文件。
         */
        await writeFile(
            target,
            "const value = 1;\n",
            "utf8",
        );

        /*
         * Agent read_file。
         *
         * before.revision 应该对应：
         *
         * const value = 1;
         */
        const before =
            await workspace
                .readTextFile(
                    "src/auth.ts",
                    signal(),
                );

        /*
         * 模拟 Agent read 之后，
         * 用户在 IDE 中修改文件。
         *
         * Version A
         *      ↓
         * Version B
         */
        await writeFile(
            target,
            "const value = 99;\n",
            "utf8",
        );

        /*
         * Agent 仍然拿着旧 revision A
         * 尝试提交修改。
         *
         * 正确行为：
         *
         * current revision != expected revision
         *
         * → conflict
         * → 不允许写入
         */
        await expect(
            workspace
                .replaceText(
                    {
                        path:
                            "src/auth.ts",

                        expectedRevision:
                        before
                            .revision,

                        oldText:
                            "const value = 1;",

                        newText:
                            "const value = 2;",
                    },

                    signal(),
                ),
        ).rejects.toMatchObject({
            code:
                "conflict",

            details: {
                reason:
                    "stale_revision",
            },
        });

        /*
         * 最关键的 assertion。
         *
         * Agent 的：
         *
         * const value = 2;
         *
         * 绝对不能覆盖用户已经写入的：
         *
         * const value = 99;
         */
        const actual =
            await readFile(
                target,
                "utf8",
            );

        expect(
            actual,
        ).toBe(
            "const value = 99;\n",
        );
    },
);
it(
    "applies one exact edit and returns a new revision",
    async () => {
        await writeFile(
            path.join(
                root,
                "src",
                "auth.ts",
            ),

            [
                "export function login() {",
                "  return false;",
                "}",
                "",
            ].join("\n"),

            "utf8",
        );

        const before =
            await workspace
                .readTextFile(
                    "src/auth.ts",

                    signal(),
                );

        const result =
            await workspace
                .replaceText(
                    {
                        path:
                            "src/auth.ts",

                        expectedRevision:
                        before
                            .revision,

                        oldText:
                            "  return false;",

                        newText:
                            "  return true;",
                    },

                    signal(),
                );

        expect(
            result.changed,
        ).toBe(true);

        expect(
            result.revision,
        ).not.toBe(
            before.revision,
        );

        expect(
            await readFile(
                path.join(
                    root,
                    "src",
                    "auth.ts",
                ),

                "utf8",
            ),
        ).toContain(
            "return true;",
        );
    },
);
it(
    "rejects an ambiguous exact replacement",
    async () => {
        const target =
            path.join(
                root,
                "duplicate.ts",
            );

        await writeFile(
            target,

            "foo();\nfoo();\n",

            "utf8",
        );

        const before =
            await workspace
                .readTextFile(
                    "duplicate.ts",

                    signal(),
                );

        await expect(
            workspace.replaceText(
                {
                    path:
                        "duplicate.ts",

                    expectedRevision:
                    before
                        .revision,

                    oldText:
                        "foo();",

                    newText:
                        "bar();",
                },

                signal(),
            ),
        ).rejects.toMatchObject({
            code:
                "conflict",

            details: {
                reason:
                    "ambiguous",
            },
        });

        expect(
            await readFile(
                target,
                "utf8",
            ),
        ).toBe(
            "foo();\nfoo();\n",
        );
    },
);
it(
    "rejects an ambiguous exact replacement",
    async () => {
        const target =
            path.join(
                root,
                "duplicate.ts",
            );

        await writeFile(
            target,

            "foo();\nfoo();\n",

            "utf8",
        );

        const before =
            await workspace
                .readTextFile(
                    "duplicate.ts",

                    signal(),
                );

        await expect(
            workspace.replaceText(
                {
                    path:
                        "duplicate.ts",

                    expectedRevision:
                    before
                        .revision,

                    oldText:
                        "foo();",

                    newText:
                        "bar();",
                },

                signal(),
            ),
        ).rejects.toMatchObject({
            code:
                "conflict",

            details: {
                reason:
                    "ambiguous",
            },
        });

        expect(
            await readFile(
                target,
                "utf8",
            ),
        ).toBe(
            "foo();\nfoo();\n",
        );
    },
);
it(
    "preserves an existing UTF-8 BOM",
    async () => {
        const target =
            path.join(
                root,
                "bom.ts",
            );

        const bom =
            Buffer.from([
                0xef,
                0xbb,
                0xbf,
            ]);

        await writeFile(
            target,

            Buffer.concat([
                bom,

                Buffer.from(
                    "const x = 1;\n",
                    "utf8",
                ),
            ]),
        );

        const before =
            await workspace
                .readTextFile(
                    "bom.ts",

                    signal(),
                );

        await workspace
            .replaceText(
                {
                    path:
                        "bom.ts",

                    expectedRevision:
                    before
                        .revision,

                    oldText:
                        "const x = 1;",

                    newText:
                        "const x = 2;",
                },

                signal(),
            );

        const bytes =
            await readFile(
                target,
            );

        expect(
            bytes.subarray(
                0,
                3,
            ),
        ).toEqual(
            bom,
        );
    },
);
it(
    "creates a file but never overwrites an existing file",
    async () => {
        const created =
            await workspace
                .createTextFile(
                    {
                        path:
                            "src/new.ts",

                        content:
                            "export const value = 1;\n",
                    },

                    signal(),
                );

        expect(
            created.path,
        ).toBe(
            "src/new.ts",
        );

        await expect(
            workspace
                .createTextFile(
                    {
                        path:
                            "src/new.ts",

                        content:
                            "overwrite",
                    },

                    signal(),
                ),
        ).rejects.toMatchObject({
            code:
                "conflict",
        });

        expect(
            await readFile(
                path.join(
                    root,
                    "src",
                    "new.ts",
                ),

                "utf8",
            ),
        ).toBe(
            "export const value = 1;\n",
        );
    },
);