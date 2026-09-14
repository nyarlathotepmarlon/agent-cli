import {
    afterEach,
    beforeEach,
    expect,
    it,
} from "vitest";

import {
    mkdir,
    mkdtemp,
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

import {
    createGlobTool,
} from "../../../src/infrastructure/tools/glob-tool.js";

import {
    createGrepTool,
} from "../../../src/infrastructure/tools/grep-tool.js";

let temporary: string;

let root: string;

let workspace:
    NodeWorkspace;

function signal():
    AbortSignal {
    return new AbortController()
        .signal;
}

beforeEach(
    async () => {
        temporary =
            await mkdtemp(
                path.join(
                    tmpdir(),
                    "agentcli-phase7-",
                ),
            );

        root =
            path.join(
                temporary,
                "repo",
            );

        await mkdir(
            path.join(
                root,
                ".git",
            ),
            {
                recursive: true,
            },
        );

        await mkdir(
            path.join(
                root,
                "src",
            ),
            {
                recursive: true,
            },
        );

        await mkdir(
            path.join(
                root,
                ".github",
            ),
            {
                recursive: true,
            },
        );

        await mkdir(
            path.join(
                root,
                "ignored",
            ),
            {
                recursive: true,
            },
        );

        await mkdir(
            path.join(
                root,
                "node_modules",
                "pkg",
            ),
            {
                recursive: true,
            },
        );

        await writeFile(
            path.join(
                root,
                ".gitignore",
            ),
            "ignored/\n",
            "utf8",
        );

        await writeFile(
            path.join(
                root,
                "src",
                "auth.ts",
            ),
            [
                "export class AuthService {",
                "  validateToken() {}",
                "}",
            ].join("\n"),
            "utf8",
        );

        await writeFile(
            path.join(
                root,
                "src",
                "user.ts",
            ),
            "export class UserService {}\n",
            "utf8",
        );

        await writeFile(
            path.join(
                root,
                ".github",
                "workflow.ts",
            ),
            "export const workflow = true;\n",
            "utf8",
        );

        await writeFile(
            path.join(
                root,
                "ignored",
                "secret.ts",
            ),
            "validateToken();\n",
            "utf8",
        );

        await writeFile(
            path.join(
                root,
                "node_modules",
                "pkg",
                "index.ts",
            ),
            "validateToken();\n",
            "utf8",
        );

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
        await rm(
            temporary,
            {
                recursive: true,
                force: true,
            },
        );
    },
);

it(
    "finds files while respecting repository ignores",
    async () => {
        const result =
            await workspace.globFiles(
                {
                    basePath:
                        ".",

                    pattern:
                        "**/*.ts",

                    maxResults:
                        100,
                },

                signal(),
            );

        expect(
            result.paths,
        ).toContain(
            "src/auth.ts",
        );

        expect(
            result.paths,
        ).toContain(
            "src/user.ts",
        );

        expect(
            result.paths,
        ).toContain(
            ".github/workflow.ts",
        );

        expect(
            result.paths,
        ).not.toContain(
            "ignored/secret.ts",
        );

        expect(
            result.paths,
        ).not.toContain(
            "node_modules/pkg/index.ts",
        );
    },
);
it(
    "searches repository text with line numbers",
    async () => {
        const result =
            await workspace.searchText(
                {
                    basePath:
                        ".",

                    query:
                        "validateToken",

                    mode:
                        "literal",

                    caseSensitive:
                        true,

                    maxResults:
                        50,
                },

                signal(),
            );

        expect(
            result.matches,
        ).toEqual([
            {
                path:
                    "src/auth.ts",

                line:
                    2,

                text:
                    "  validateToken() {}",

                textTruncated:
                    false,
            },
        ]);
    },
);
it(
    "searches repository text with line numbers",
    async () => {
        const result =
            await workspace.searchText(
                {
                    basePath:
                        ".",

                    query:
                        "validateToken",

                    mode:
                        "literal",

                    caseSensitive:
                        true,

                    maxResults:
                        50,
                },

                signal(),
            );

        expect(
            result.matches,
        ).toEqual([
            {
                path:
                    "src/auth.ts",

                line:
                    2,

                text:
                    "  validateToken() {}",

                textTruncated:
                    false,
            },
        ]);
    },
);
it(
    "supports explicit regex search",
    async () => {
        const result =
            await workspace.searchText(
                {
                    basePath:
                        "src",

                    query:
                        "(Auth|User)Service",

                    mode:
                        "regex",

                    caseSensitive:
                        true,

                    maxResults:
                        50,
                },

                signal(),
            );

        expect(
            result.matches.map(
                (match) =>
                    match.path,
            ),
        ).toEqual([
            "src/auth.ts",
            "src/user.ts",
        ]);
    },
);
it(
    "reports truncated search results",
    async () => {
        const result =
            await workspace.searchText(
                {
                    basePath:
                        "src",

                    query:
                        "class",

                    mode:
                        "literal",

                    caseSensitive:
                        true,

                    maxResults:
                        1,
                },

                signal(),
            );

        expect(
            result.matches,
        ).toHaveLength(1);

        expect(
            result.truncated,
        ).toBe(true);
    },
);
it(
    "rejects search traversal outside the workspace",
    async () => {
        await expect(
            workspace.searchText(
                {
                    basePath:
                        "..",

                    query:
                        "anything",

                    mode:
                        "literal",

                    caseSensitive:
                        true,

                    maxResults:
                        10,
                },

                signal(),
            ),
        ).rejects.toMatchObject({
            code:
                "outside_workspace",
        });
    },
);