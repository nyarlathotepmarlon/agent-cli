import {
    z,
} from "zod";

import type {
    EditableWorkspace,
} from "../../core/workspace/workspace-edit.js";

import {
    defineTool,
} from "./define-tool.js";

import {
    workspaceToolResult,
} from "./workspace-tool-result.js";

export const MAX_CREATE_TEXT_CHARS =
    200_000;

export function createCreateFileTool(
    workspace:
    EditableWorkspace,
) {
    return defineTool({
        name:
            "create_file",

        description:
            "Create a new UTF-8 text file inside the workspace. " +
            "The parent directory must already exist. " +
            "The operation never overwrites an existing path; existing files return a conflict. " +
            "Use edit_file for existing files.",

        schema:
            z.strictObject({
                path:
                    z.string()
                        .min(1)
                        .max(4096),

                content:
                    z.string()
                        .max(
                            MAX_CREATE_TEXT_CHARS,
                        ),
            }),

        async execute(
            input,
            context,
        ) {
            return workspaceToolResult(
                context.signal,

                () =>
                    workspace
                        .createTextFile(
                            {
                                path:
                                input.path,

                                content:
                                input.content,
                            },

                            context.signal,
                        ),
            );
        },
    });
}