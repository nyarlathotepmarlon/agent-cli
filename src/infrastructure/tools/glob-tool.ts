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
// GLOB最多的个数上限200
export const MAX_GLOB_RESULTS =
    200;

export function createGlobTool(
    workspace:
    SearchWorkspace,
) {
    return defineTool({
        name:
            "glob",

        description:
            "Find files by glob pattern. " +
            "The pattern is relative to path, which defaults to the workspace root. " +
            "Search respects repository ignore rules, includes useful hidden files, " +
            "does not traverse symlinks, and excludes .git and node_modules. " +
            "Use this to discover files before reading them. " +
            "truncated=true means more matching files exist.",

        schema:
            z.strictObject({
                pattern:
                    z.string()
                        .min(1)
                        .max(4096)
                        .describe(
                            "Positive glob such as **/*.ts or **/*auth*.ts.",
                        ),

                path:
                    z.string()
                        .min(1)
                        .max(4096)
                        .default(".")
                        .describe(
                            "Workspace-relative directory to search.",
                        ),

                maxResults:
                    z.number()
                        .int()
                        .min(1)
                        .max(
                            MAX_GLOB_RESULTS,
                        )
                        .default(100),
            }),
        permission: {
            action:
                "workspace.search",

            describe(
                input,
            ) {
                return `Search files matching ${JSON.stringify(
                    input.pattern,
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
                        .globFiles(
                            {
                                basePath:
                                input.path,

                                pattern:
                                input.pattern,

                                maxResults:
                                input.maxResults,
                            },

                            context.signal,
                        ),
            );
        },
    });
}