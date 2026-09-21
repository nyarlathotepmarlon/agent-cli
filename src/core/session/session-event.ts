/**
 * Session事件日志
 */
import type {
    ModelResponse,
} from "../model/model-response.js";

import type {
    PermissionMode,
} from "../permissions/permission.js";

import type {
    JsonValue,
} from "../shared/json.js";

import type {
    ToolCall,
} from "../tools/tool-call.js";

import type {
    ToolResult,
} from "../tools/tool-result.js";
// session版本号
export const SESSION_SCHEMA_VERSION =
    1 as const;

export type SessionSchemaVersion =
    typeof SESSION_SCHEMA_VERSION;
// session交互模式
export type SessionRunMode =
    | "interactive"
    | "non-interactive";
//代表会话的开始
export interface SessionStartedEvent {
    readonly type:
        "session.started";

    /**
     * Absolute canonical workspace
     * root owned by this session.
     */
    // 当前session所拥有/操作的workspace根目录，是一个绝对路径
    readonly workspaceRoot:
        string;
}
// 代表用户向Agent发送了一次请求
export interface SessionUserMessageEvent {
    readonly type:
        "user.message";

    readonly content:
        string;

    readonly model: {
        readonly provider:
            string;

        readonly model:
            string;
    };

    readonly permissionMode:
        PermissionMode;

    readonly runMode:
        SessionRunMode;
}
//代表Model的一次调用完成
export interface SessionModelCompletedEvent {
    readonly type:
        "model.completed";

    readonly response:
        ModelResponse;
}
//代表 Agent开始执行一个Tool
export interface SessionToolStartedEvent {
    readonly type:
        "tool.started";

    readonly call:
        ToolCall;
}
// 代表Agent完成一个Tool的执行
export interface SessionToolCompletedEvent {
    readonly type:
        "tool.completed";

    readonly toolCallId:
        string;

    readonly result:
        ToolResult;
}
// 描述一次AgentRun是如何结束的
export type SessionRunStatus =
    | "completed" // 正常完成
    | "stopped" /// agent主动停止
    | "cancelled" //外部取消
    | "failed"// 出现错误
    | "interrupted";// 被打断
// 描述一次Run达到最终状态
export interface SessionRunFinishedEvent {
    readonly type:
        "run.finished";

    readonly status:
        SessionRunStatus;

    /*
     * Agent stop reason or
     * session-recovery metadata.
     *
     * Stored as JSON because session
     * schema should not be tightly coupled
     * to every future AgentStopReason
     * variant.
     */
    readonly reason:
        JsonValue | null;
}

export type SessionEvent =
    | SessionStartedEvent
    | SessionUserMessageEvent
    | SessionModelCompletedEvent
    | SessionToolStartedEvent
    | SessionToolCompletedEvent
    | SessionRunFinishedEvent;

export interface SessionEventEnvelope {
    readonly schemaVersion:
        SessionSchemaVersion;

    readonly sessionId:
        string;

    readonly sequence:// Event在Session中的顺序
        number;

    readonly recordedAt:
        string;

    readonly event:
        SessionEvent;
}
