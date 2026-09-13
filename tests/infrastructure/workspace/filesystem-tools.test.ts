import { afterEach, beforeEach, expect, it } from "vitest";
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    symlink,
    unlink,
    writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
    NodeWorkspace,
    MAX_FILE_BYTES,
    MAX_DIRECTORY_ENTRIES,
} from "../../../src/infrastructure/workspace/node-workspace.js";
import {
    createReadFileTool,
    MAX_READ_TEXT_CHARS,
} from "../../../src/infrastructure/tools/read-file-tool.js";
import { createListDirectoryTool } from "../../../src/infrastructure/tools/list-directory-tool.js";
import { createWorkspaceToolRuntime } from "../../../src/infrastructure/tools/create-workspace-tool-runtime.js";
import { DefaultAgentApplication } from "../../../src/application/agent-application.js";
import { DefaultAgentRuntime } from "../../../src/core/agent/agent-runtime.js";
import { ExponentialBackoffModelRetryPolicy } from "../../../src/core/agent/model-retry-policy.js";
import { NodeDelay } from "../../../src/infrastructure/time/node-delay.js";
import type { Model } from "../../../src/core/model/model.js";
import type { ModelResponse } from "../../../src/core/model/model-response.js";
import type { ToolCall } from "../../../src/core/tools/tool-call.js";

let temporary: string;
let root: string;
let outside: string;
let workspace: NodeWorkspace;

const links: string[] = [];

function signal() {
    return new AbortController().signal;
}

beforeEach(async () => {
    temporary = await mkdtemp(
        path.join(tmpdir(), "agentcli-phase6-"),
    );

    root = path.join(temporary, "repo");
    outside = path.join(temporary, "repo-extra");

    await mkdir(
        path.join(root, "中文 目录"),
        { recursive: true },
    );
    await mkdir(outside);

    await writeFile(
        path.join(root, "中文 目录", "示例.txt"),
        "\uFEFF第一行\r\n第二行\r\n",
        "utf8",
    );

    await writeFile(
        path.join(root, "marker.txt"),
        "project A",
        "utf8",
    );

    await writeFile(
        path.join(outside, "marker.txt"),
        "project B",
        "utf8",
    );

    workspace = await NodeWorkspace.create(root, signal());
});

afterEach(async () => {
    const target = path.resolve(temporary);
    const tempRoot = path.resolve(tmpdir());

    if (
        path.dirname(target) !== tempRoot ||
        !path.basename(target).startsWith("agentcli-phase6-")
    ) {
        throw new Error(
            "Refusing to remove an unexpected test directory",
        );
    }

    // 先移除本测试创建的链接，再清理独立测试目录。
    for (const link of links.splice(0)) {
        await unlink(link);
    }

    await rm(target, { recursive: true, force: true });
});

it("reads Chinese paths, strips UTF-8 BOM and preserves source newlines", async () => {
    const file = await workspace.readTextFile(
        "中文 目录\\示例.txt",
        signal(),
    );

    expect(file.path).toBe("中文 目录/示例.txt");
    expect(file.content).toBe("第一行\r\n第二行\r\n");
    expect(file.byteLength).toBe(
        Buffer.byteLength("\uFEFF第一行\r\n第二行\r\n"),
    );
});

it("rejects traversal including a sibling with the same prefix", async () => {
    for (const input of [
        "../repo-extra/marker.txt",
        "..\\repo-extra\\marker.txt",
    ]) {
        await expect(
            workspace.readTextFile(input, signal()),
        ).rejects.toMatchObject({
            code: "outside_workspace",
        });
    }
});

it("rejects absolute paths and ambiguous Windows path forms", async () => {
    for (const input of [
        path.join(root, "marker.txt"),
        "C:marker.txt",
        "marker.txt:secret",
        "\\\\server\\share\\file",
        "NUL.txt",
        "COM¹",
        ".. /marker.txt",
    ]) {
        await expect(
            workspace.readTextFile(input, signal()),
        ).rejects.toMatchObject({
            code: "invalid_path",
        });
    }
});

it("returns expected errors for missing files, directories and wrong roots", async () => {
    await expect(
        workspace.readTextFile("missing.txt", signal()),
    ).rejects.toMatchObject({ code: "not_found" });

    await expect(
        workspace.readTextFile(".", signal()),
    ).rejects.toMatchObject({ code: "not_file" });

    await expect(
        workspace.listDirectory("marker.txt", signal()),
    ).rejects.toMatchObject({ code: "not_directory" });

    await expect(
        NodeWorkspace.create(
            path.join(root, "marker.txt"),
            signal(),
        ),
    ).rejects.toMatchObject({ code: "not_directory" });
});

it("accepts the byte limit and rejects larger files, invalid UTF-8 and binary data", async () => {
    await writeFile(
        path.join(root, "exact.txt"),
        Buffer.alloc(MAX_FILE_BYTES, 97),
    );

    expect(
        (await workspace.readTextFile("exact.txt", signal()))
            .byteLength,
    ).toBe(MAX_FILE_BYTES);

    const cases = [
        {
            name: "large.txt",
            bytes: Buffer.alloc(MAX_FILE_BYTES + 1, 97),
            code: "file_too_large",
        },
        {
            name: "bad.txt",
            bytes: Buffer.from([0xc3, 0x28]),
            code: "invalid_encoding",
        },
        {
            name: "binary.dat",
            bytes: Buffer.from([65, 0, 66]),
            code: "binary_file",
        },
    ];

    for (const item of cases) {
        await writeFile(
            path.join(root, item.name),
            item.bytes,
        );

        await expect(
            workspace.readTextFile(item.name, signal()),
        ).rejects.toMatchObject({
            code: item.code,
        });
    }
});

it("allows internal directory links and rejects links escaping the workspace", async () => {
    const type =
        process.platform === "win32" ? "junction" : "dir";

    const internalLink = path.join(root, "internal-link");
    const externalLink = path.join(root, "external-link");

    await symlink(
        path.join(root, "中文 目录"),
        internalLink,
        type,
    );
    links.push(internalLink);

    await symlink(outside, externalLink, type);
    links.push(externalLink);

    expect(
        (
            await workspace.readTextFile(
                "internal-link/示例.txt",
                signal(),
            )
        ).content,
    ).toContain("第一行");

    await expect(
        workspace.readTextFile(
            "external-link/marker.txt",
            signal(),
        ),
    ).rejects.toMatchObject({
        code: "outside_workspace",
    });

    await expect(
        workspace.listDirectory("external-link", signal()),
    ).rejects.toMatchObject({
        code: "outside_workspace",
    });

    const listing =
        await workspace.listDirectory(".", signal());

    expect(listing.entries).toContainEqual({
        name: "external-link",
        kind: "symlink",
    });
});

it("bounds directory enumeration and marks the result incomplete", async () => {
    const many = path.join(root, "many");
    await mkdir(many);

    for (
        let index = 0;
        index <= MAX_DIRECTORY_ENTRIES;
        index += 1
    ) {
        await writeFile(
            path.join(many, `${index}.txt`),
            "",
            "utf8",
        );
    }

    const listing =
        await workspace.listDirectory("many", signal());

    expect(listing.entries)
        .toHaveLength(MAX_DIRECTORY_ENTRIES);

    expect(listing.truncated).toBe(true);
});

it("paginates complete lines and supplies the next line number", async () => {
    const tool = createReadFileTool(workspace);

    const first = await tool.execute(
        {
            path: "中文 目录/示例.txt",
            maxLines: 1,
        },
        { signal: signal() },
    );

    expect(first).toMatchObject({
        ok: true,
        output: {
            totalLines: 2,
            startLine: 1,
            endLine: 1,
            content: "第一行",
            truncated: true,
            nextLine: 2,
        },
    });

    expect(
        await tool.execute(
            {
                path: "中文 目录/示例.txt",
                startLine: 2,
            },
            { signal: signal() },
        ),
    ).toMatchObject({
        ok: true,
        output: {
            content: "第二行",
            truncated: false,
            nextLine: null,
        },
    });
});

it("handles empty files and rejects invalid ranges or oversized single lines", async () => {
    await writeFile(
        path.join(root, "empty.txt"),
        "",
        "utf8",
    );

    await writeFile(
        path.join(root, "long.txt"),
        "x".repeat(MAX_READ_TEXT_CHARS + 1),
        "utf8",
    );

    const tool = createReadFileTool(workspace);

    expect(
        await tool.execute(
            { path: "empty.txt" },
            { signal: signal() },
        ),
    ).toMatchObject({
        ok: true,
        output: {
            totalLines: 0,
            startLine: null,
            endLine: null,
            content: "",
            nextLine: null,
        },
    });

    expect(
        await tool.execute(
            {
                path: "empty.txt",
                startLine: 2,
            },
            { signal: signal() },
        ),
    ).toMatchObject({
        ok: false,
        error: {
            code: "invalid_input",
        },
    });

    expect(
        await tool.execute(
            { path: "long.txt" },
            { signal: signal() },
        ),
    ).toMatchObject({
        ok: false,
        error: {
            details: {
                workspaceCode: "text_too_large",
            },
        },
    });
});

it("maps workspace failures to observations and supplies directory defaults", async () => {
    expect(
        await createReadFileTool(workspace).execute(
            { path: "../repo-extra/marker.txt" },
            { signal: signal() },
        ),
    ).toMatchObject({
        ok: false,
        error: {
            code: "permission_denied",
        },
    });

    expect(
        await createListDirectoryTool(workspace).execute(
            {},
            { signal: signal() },
        ),
    ).toMatchObject({
        ok: true,
        output: {
            path: ".",
            truncated: false,
        },
    });
});

it("preserves cancellation", async () => {
    const controller = new AbortController();
    const reason = new Error("Cancelled");

    controller.abort(reason);

    await expect(
        createReadFileTool(workspace).execute(
            { path: "marker.txt" },
            { signal: controller.signal },
        ),
    ).rejects.toBe(reason);
});

function response(
    toolCalls: readonly ToolCall[] = [],
    content = "",
): ModelResponse {
    return {
        message: {
            role: "assistant",
            content,
            toolCalls,
            providerData: null,
        },
        finishReason:
            toolCalls.length > 0 ? "tool_calls" : "completed",
        usage: null,
        providerRequestId: null,
    };
}

it("binds each application run to its requested cwd and feeds file content back", async () => {
    const model: Model = {
        provider: "test",
        id: "filesystem-script",

        async generate(request, abortSignal) {
            abortSignal.throwIfAborted();

            const last = request.messages.at(-1);

            if (last?.role === "user") {
                return response([
                    {
                        id: "list_1",
                        name: "list_directory",
                        input: {},
                    },
                ]);
            }

            if (
                last?.role === "tool" &&
                last.toolName === "list_directory"
            ) {
                expect(last.isError).toBe(false);
                expect(last.content).toContain("marker.txt");

                return response([
                    {
                        id: "read_1",
                        name: "read_file",
                        input: {
                            path: "marker.txt",
                        },
                    },
                ]);
            }

            if (
                last?.role === "tool" &&
                last.toolName === "read_file"
            ) {
                expect(last.isError).toBe(false);
                expect(last.toolCallId).toBe("read_1");

                return response([], last.content);
            }

            throw new Error("Unexpected model request");
        },
    };

    const application = new DefaultAgentApplication({
        limits: {
            maxTurns: 6,
            maxToolCalls: 6,
            maxTotalTokens: null,
        },

        modelResolver: {
            resolve: () => model,
        },

        runtime: new DefaultAgentRuntime(
            new ExponentialBackoffModelRetryPolicy({
                maxAttempts: 1,
                baseDelayMs: 1,
                maxDelayMs: 1,
            }),
            new NodeDelay(),
        ),

        createToolRuntime:
        createWorkspaceToolRuntime,
    });

    for (
        const [cwd, expected]
        of [
        [root, "project A"],
        [outside, "project B"],
    ] as const
        ) {
        const result = await application.run({
            prompt: "Read marker.txt",
            cwd,
            mode: "non-interactive",
            model: {
                provider: "test",
                model: "filesystem-script",
            },
            signal: signal(),
        });

        expect(result.status).toBe("completed");
        expect(result.output).toContain(expected);

        expect(result.state.budget.usage).toMatchObject({
            turns: 3,
            toolCalls: 2,
        });

        expect(
            await readFile(
                path.join(cwd, "marker.txt"),
                "utf8",
            ),
        ).toBe(expected);
    }
});