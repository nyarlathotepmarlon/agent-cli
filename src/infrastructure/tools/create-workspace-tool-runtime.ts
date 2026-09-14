import type {
    AgentToolRuntime,
} from "../../core/agent/agent-tool-runtime.js";

import {
    DefaultAgentToolRuntime,
} from "../../core/tools/default-agent-tool-runtime.js";

import {
    ToolRegistry,
} from "../../core/tools/tool-registry.js";

import {
    NodeWorkspace,
} from "../workspace/node-workspace.js";

import {
    createGlobTool,
} from "./glob-tool.js";

import {
    createGrepTool,
} from "./grep-tool.js";

import {
    createListDirectoryTool,
} from "./list-directory-tool.js";

import {
    createReadFileTool,
} from "./read-file-tool.js";

export async function createWorkspaceToolRuntime(
    cwd: string,
    signal: AbortSignal,
): Promise<AgentToolRuntime> {
    const workspace =
        await NodeWorkspace.create(
            cwd,
            signal,
        );

    return new DefaultAgentToolRuntime(
        new ToolRegistry([
            createReadFileTool(
                workspace,
            ),

            createListDirectoryTool(
                workspace,
            ),

            createGlobTool(
                workspace,
            ),

            createGrepTool(
                workspace,
            ),
        ]),
    );
}