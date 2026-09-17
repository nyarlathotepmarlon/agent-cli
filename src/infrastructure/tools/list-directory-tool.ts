import { z } from "zod";
import type { Workspace } from "../../core/workspace/workspace.js";
import { defineTool } from "./define-tool.js";
import { workspaceToolResult } from "./workspace-tool-result.js";

export function createListDirectoryTool(workspace: Workspace) {
    return defineTool({
        name: "list_directory",
        description:
            "List one directory level using a workspace-relative path. " +
            "Use '.' for the root. Returns at most 200 entries. " +
            "Symlink entries are reported without traversing them; truncated means incomplete.",

        schema: z.strictObject({
            path: z.string().min(1).max(4096).default("."),
        }),
        permission: {
            action:
                "workspace.read",

            describe(
                input,
            ) {
                return `Read file ${JSON.stringify(
                    input.path,
                )}`;
            },
        },
        async execute(input, context) {
            return workspaceToolResult(
                context.signal,
                () => workspace.listDirectory(
                    input.path,
                    context.signal,
                ),
            );
        },
    });
}