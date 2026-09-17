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
import type {
    PermissionAuthorizer,
} from "../../core/permissions/permission.js";
import {
    createReadFileTool,
} from "./read-file-tool.js";
import {createEditFileTool} from "./edit-file-tool.js";
import {createCreateFileTool} from "./create-file-tool.js";
import {NodeProcessRunner} from "../process/node-process-runner.js";
import {createRunCommandTool} from "./run_command.js";

export async function createWorkspaceToolRuntime(
    cwd: string,
    signal: AbortSignal,
    authorizer:PermissionAuthorizer
): Promise<AgentToolRuntime> {
    const workspace =
        await NodeWorkspace.create(
            cwd,
            signal,
        );
    const processRunner =
        await NodeProcessRunner.create(
            workspace.root,
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

            createEditFileTool(
                workspace,
            ),

            createCreateFileTool(
                workspace,
            ),
            createRunCommandTool(
                processRunner,
            ),
        ]),authorizer
    );
}