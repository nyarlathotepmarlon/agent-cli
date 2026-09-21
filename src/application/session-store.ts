/**
 * Session持久化层的抽象接口
 */
import type {
    SessionEvent,
    SessionEventEnvelope,
} from "../core/session/session-event.js";
// 不仅仅代表Session数据，还代表一个有生命周期的资源句柄
export interface SessionLease {
    readonly sessionId:
        string;

    readonly workspaceRoot:
        string;

    readonly events:
        readonly SessionEventEnvelope[];

    append(
        event:
        SessionEvent,
    ): Promise<SessionEventEnvelope>;// session的持久化形式的追加日志

    close():
        Promise<void>;
}
// 加载的Session
export interface LoadedSession {
    readonly sessionId:
        string;

    readonly workspaceRoot:
        string;

    readonly events:
        readonly SessionEventEnvelope[];
}
// Session存储接口
export interface SessionStore {
    // 创建一个新的session
    create(
        workspaceRoot:
        string,

        signal:
        AbortSignal,
    ): Promise<SessionLease>;
    // 打开session并获取它的写入权限
    open(
        workspaceRoot:
        string,

        sessionId:
        string,

        signal:
        AbortSignal,
    ): Promise<SessionLease>;
    // 读取Session数据，但不取得写入权限，这就是LoadedSession与SessionLease的区别
    load(
        workspaceRoot:
        string,

        sessionId:
        string,

        signal:
        AbortSignal,
    ): Promise<LoadedSession>;
}