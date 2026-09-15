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

export const MAX_EDIT_TEXT_CHARS =
    200_000;

export function createEditFileTool(
    workspace:
    EditableWorkspace,
) {
    return defineTool({
        name:
            "edit_file",

        description:
            "Safely edit one existing UTF-8 text file using a unique exact-text replacement. " +
            "You must first read the file and pass its returned revision as expectedRevision. " +
            "oldText must match exactly one logical text region; newline differences between LF and CRLF are handled. " +
            "If the file changed after reading, the edit returns a conflict and you must read it again. " +
            "Use newText='' to delete the matched text.",

        schema:
            z.strictObject({
                path:
                    z.string()
                        .min(1)
                        .max(4096),

                expectedRevision:
                    z.string()
                        .regex(
                            /^sha256:[0-9a-f]{64}$/u,
                        ),

                oldText:
                    z.string()
                        .max(
                            MAX_EDIT_TEXT_CHARS,
                        ),

                newText:
                    z.string()
                        .max(
                            MAX_EDIT_TEXT_CHARS,
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
                        .replaceText(
                            {
                                path:
                                input.path,

                                expectedRevision:
                                input
                                    .expectedRevision,

                                oldText:
                                input.oldText,

                                newText:
                                input.newText,
                            },

                            context.signal,
                        ),
            );
        },
    });
}