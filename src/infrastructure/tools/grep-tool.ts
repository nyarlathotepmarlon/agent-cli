import {
    z,
} from "zod";

import type {
    SearchWorkspace,
} from "../../core/workspace/workspace-search.js";

import {
    defineTool,
} from "./define-tool.js";

import {
    workspaceToolResult,
} from "./workspace-tool-result.js";

export const MAX_GREP_RESULTS =
    100;

export function createGrepTool(
    workspace:
    SearchWorkspace,
) {
    return defineTool({
        name:
            "grep",

        description:
            "Search repository text and return matching lines with 1-based line numbers. " +
            "Literal search is the default; set regex=true only when regex semantics are needed. " +
            "Search respects repository ignore rules, skips binary files and symlink traversal, " +
            "and excludes .git and node_modules. " +
            "Use path to narrow large searches. truncated=true means additional matches exist.",

        schema:
            z.strictObject({
                query:
                    z.string()
                        .min(1)
                        .max(4096)
                        .describe(
                            "Text or regex to search for.",
                        ),

                path:
                    z.string()
                        .min(1)
                        .max(4096)
                        .default(".")
                        .describe(
                            "Workspace-relative directory to search.",
                        ),

                regex:
                    z.boolean()
                        .default(false),

                caseSensitive:
                    z.boolean()
                        .default(true),

                maxResults:
                    z.number()
                        .int()
                        .min(1)
                        .max(
                            MAX_GREP_RESULTS,
                        )
                        .default(50),
            }),
        permission: {
            action:
                "workspace.search",

            describe(
                input,
            ) {
                return `Search repository text for ${JSON.stringify(
                    input.query,
                )} under ${JSON.stringify(
                    input.path,
                )}`;
            },
        },
        async execute(
            input,
            context,
        ) {
            return workspaceToolResult(
                context.signal,

                () =>
                    workspace
                        .searchText(
                            {
                                basePath:
                                input.path,

                                query:
                                input.query,

                                mode:
                                    input.regex
                                        ? "regex"
                                        : "literal",

                                caseSensitive:
                                input
                                    .caseSensitive,

                                maxResults:
                                input
                                    .maxResults,
                            },

                            context.signal,
                        ),
            );
        },
    });
}