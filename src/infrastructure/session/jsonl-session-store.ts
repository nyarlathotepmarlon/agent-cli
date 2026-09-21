import {
    randomUUID,
} from "node:crypto";

import {
    constants as fsConstants,
    type Stats,
} from "node:fs";

import type {
    FileHandle,
} from "node:fs/promises";

import {
    lstat,
    mkdir,
    open,
    realpath,
    stat,
    unlink,
} from "node:fs/promises";

import * as path
    from "node:path";

import {
    TextDecoder,
} from "node:util";

import type {
    LoadedSession,
    SessionLease,
    SessionStore,
} from "../../application/session-store.js";

import {
    SESSION_SCHEMA_VERSION,
    type SessionEvent,
    type SessionEventEnvelope,
} from "../../core/session/session-event.js";

import {
    SessionError,
} from "../../core/session/session-error.js";

import {
    normalizeSessionId,
} from "../../core/session/session-id.js";

import {
    assertSessionEventEnvelopeForWrite,
    parseSessionEventEnvelope,
} from "./session-event-schema.js";

// 单session最大：64mb
export const MAX_SESSION_BYTES =
    64 * 1024 * 1024;
// 单event最大：4mb
export const MAX_SESSION_EVENT_BYTES =
    4 * 1024 * 1024;

const CONTROL_DIRECTORY_NAME =
    ".agent";

const SESSION_DIRECTORY_NAME =
    "sessions";

const SESSION_FILE_SUFFIX =
    ".jsonl";

const SESSION_LOCK_SUFFIX =
    ".lock";
// Unix权限 rwx
const DIRECTORY_MODE =
    0o700;
// Unix权限 rw
const FILE_MODE =
    0o600;

// 读取JSONL的结果
interface ReadSessionResult {
    readonly events:
        readonly SessionEventEnvelope[];

    readonly byteLength:
        number;
}

// 类Unix文件系统中
interface FileIdentity {
    readonly dev:
        number;// 哪个文件系统

    readonly ino:
        number; // 文件系统中的哪个inode
}

// 这个类代表拥有session的写权限
class FileSessionLease
    implements SessionLease
{
    public readonly events:
        SessionEventEnvelope[];

    private nextSequence:
        number;

    private currentBytes:
        number;
    //lock 保证只有一个 FileSessionLease 写
    //appendQueue 保证这个 lease 内只有一个 append 在写
    private appendQueue:
        Promise<void> =
        Promise.resolve();// 作为当前的尾部，代表之前的Promise全部执行完成
    // 关闭状态控制
    private acceptingAppends =
        true;
    // 写失败和普通append失败分开，
    private writerFailed =
        false;
    // 存Promise
    private closePromise:
        Promise<void> | null =
        null;

    public constructor(
        public readonly sessionId:
        string,

        public readonly workspaceRoot:
        string,

        private readonly handle:
        FileHandle,

        events:
        readonly SessionEventEnvelope[],

        byteLength:
        number,

        private readonly releaseLock:
        () => Promise<void>,
    ) {
        this.events = [
            ...events,
        ];

        this.nextSequence =
            events.length;

        this.currentBytes =
            byteLength;
    }

    /**
     * 同一个 lease 上的 append 也可能被并发调用。
     * promise chain 保证序列号分配和文件写入严格串行。
     */
    public append(
        event:
        SessionEvent,
    ): Promise<SessionEventEnvelope> {
        // 判断能够追加内容
        if (!this.acceptingAppends) {
            return Promise.reject(
                new SessionError(
                    "io_error",

                    "Cannot append to a closed session lease",
                ),
            );
        }
        //将新任务挂载到队尾
        const result =
            this.appendQueue
                .then(
                    () =>
                        this.appendNow(
                            event,
                        ),
                );

        /*
         * queue 自身始终恢复为 fulfilled，一次 invalid_event
         * 不会让后续合法 append 永久跳过。
         */
        /**
         * 这里的两个 () => undefined 分别是 onFulfilled 和 onRejected。它的作用是：
         *
         * 无论 result 是成功还是失败，新的 appendQueue 永远 fulfilled，值为 undefined。
         *
         * 也就是说，队列不会因为一次失败而“卡死”。
         */
        this.appendQueue =
            result.then(
                () => undefined,

                () => undefined,
            );

        return result;
    }

    /**
     * 真正的事务边界，真正的写入文件
     * @param event
     * @private
     */
    private async appendNow(
        event:
        SessionEvent,
    ): Promise<SessionEventEnvelope> {
        // 如果写失败，直接报错
        if (this.writerFailed) {
            throw new SessionError(
                "io_error",

                "Session writer is unusable after a previous I/O failure",
            );
        }
        // 生产envelope
        const envelope:
            SessionEventEnvelope =
            {
                schemaVersion:
                SESSION_SCHEMA_VERSION,

                sessionId:
                this.sessionId,

                sequence:
                this.nextSequence,

                recordedAt:
                    new Date()
                        .toISOString(),

                event,
            };

        let bytes:
            Buffer;

        try {
            /*
             * TypeScript 类型在运行时并不可信。写入前验证可拦住
             * undefined、NaN、Infinity 等 JSON 无法无损表达的数据。
             */
            // 运行时校验
            assertSessionEventEnvelopeForWrite(
                envelope,
            );
            // 序列化envelope
            bytes =
                Buffer.from(
                    `${JSON.stringify(
                        envelope,
                    )}\n`,

                    "utf8",
                );
        } catch (error) {
            if (
                error instanceof
                SessionError
            ) {
                throw error;
            }

            throw new SessionError(
                "invalid_event",

                "Session event is not JSON serializable",

                {
                    cause:
                    error,
                },
            );
        }
        // 如果envelop超限
        if (
            bytes.length >
            MAX_SESSION_EVENT_BYTES
        ) {
            throw new SessionError(
                "event_too_large",

                "Session event exceeds persistence limit",
            );
        }
        // 如果jsonl文件超限
        if (
            this.currentBytes +
            bytes.length >
            MAX_SESSION_BYTES
        ) {
            throw new SessionError(
                "session_too_large",

                "Session exceeds persistence limit",
            );
        }
        // 循环写入文件
        try {
            let offset =
                0;

            /*
             * handle 使用 O_APPEND 打开；position=null 会追加到文件尾。
             * 循环用于处理少量写入。
             */
            while (
                offset <
                bytes.length
                ) {
                const {
                    bytesWritten,
                } =
                    await this.handle
                        .write(
                            bytes,

                            offset,

                            bytes.length -
                            offset,

                            null,// 从文件尾部写
                        );

                if (
                    bytesWritten <=
                    0
                ) {
                    throw new Error(
                        "Session writer made no progress",
                    );
                }

                offset +=
                    bytesWritten;
            }

            /*
             * 只有 sync 成功后才更新内存状态。write/sync 失败时，
             * 文件尾状态不确定，因此 writer 不允许继续使用。
             */
            await this.handle
                .sync();
        } catch (error) {
            //如果在写入过程中失败，记录写失败
            this.writerFailed =
                true;

            throw asIoError(
                error,

                "Failed to append session event",
            );
        }
        // 在刷盘成功后，更新内存状态
        // 写成功的情况：将envelop加入events
        this.events.push(
            envelope,
        );
        // 计算下一个sequence
        this.nextSequence +=
            1;
        // 计算bytes
        this.currentBytes +=
            bytes.length;

        return envelope;
    }

    /**
     * 等待已进入队列的 append 完成，再关闭数据文件并释放锁。
     * close 是幂等的。
     */
    public close():
        Promise<void> {
        // 如果closePromise！=null，说明已经关闭了
        if (
            this.closePromise !==
            null
        ) {
            return this.closePromise;
        }
        // 第一次关闭
        this.acceptingAppends =
            false;
        //调用closeResource()，复制close回调
        this.closePromise =
            this.closeResources();
        // 返回close回调
        return this.closePromise;
    }

    /**
     * 真正关闭资源：
     * 1. 等待队列中的任务全部完成
     * 2. 关闭文件
     * 3. 释放锁
     * @private
     */
    private async closeResources():
        Promise<void> {
        // 等待queue中的任务处理完
        await this.appendQueue;

        let firstError:
            unknown;

        try {
            // 关闭文件句柄
            await this.handle
                .close();
        } catch (error) {
            firstError =
                error;
        }

        try {
            // 释放锁
            await this.releaseLock();
        } catch (error) {
            firstError ??=
                error;
        }
        // 对关闭资源产生的错误做处理
        if (
            firstError !==
            undefined
        ) {
            throw asIoError(
                firstError,

                "Failed to close session lease",
            );
        }
    }
}


/**
 * 每个 workspace 的会话保存在：
 *
 * .agent/sessions/<uuid>.jsonl
 *
 * 写租约使用同目录下的 <uuid>.lock 文件互斥。
 */
/**
 * | API        | session 是否存在 | 写权限 | lock |
 * | ---------- | ------------ | --- | ---- |
 * | `create()` | 新建           | 有   | 有    |
 * | `open()`   | 已存在          | 有   | 有    |
 * | `load()`   | 已存在          | 无   | 无    |
 */
export class JsonlSessionStore
    implements SessionStore
{
    /**
     * 创建Session
     * @param workspaceRoot
     * @param signal
     */
    public async create(
        workspaceRoot:
        string,

        signal:
        AbortSignal,
    ): Promise<SessionLease> {
        // 快速失败
        signal.throwIfAborted();

        try {
            // 解析真正的路径
            const canonicalWorkspace =
                await canonicalizeWorkspace(
                    workspaceRoot,

                    signal,
                );

            const sessionDirectory =
                // 预备Session目录
                await prepareSessionDirectory(
                    canonicalWorkspace,

                    true,

                    signal,
                );
            // 用uuid生成
            const sessionId =
                normalizeSessionId(
                    randomUUID(),
                );
            // session file路径
            const target =
                sessionFilePath(
                    sessionDirectory,

                    sessionId,
                );
            // 获取文件锁
            const releaseLock =
                await acquireLock(
                    sessionDirectory,

                    sessionId,

                    signal,
                );
            // session文件的句柄
            let handle:
                FileHandle | null =
                null;

            let lease:
                FileSessionLease | null =
                null;

            let sessionFileCreated =
                false;

            try {
                // 快速失败
                signal.throwIfAborted();
                // 打开session文件的句柄
                handle =
                    await open(
                        target,

                        fsConstants.O_CREAT |
                        fsConstants.O_EXCL |
                        fsConstants.O_RDWR |
                        fsConstants.O_APPEND,

                        FILE_MODE,
                    );
                // session文件标记为创建
                sessionFileCreated =
                    true;
                // 判断session文件是否安全
                await assertSafeOpenFile(
                    handle,

                    null,
                );
                // 获取lease
                lease =
                    new FileSessionLease(
                        sessionId,

                        canonicalWorkspace,

                        handle,

                        [],

                        0,

                        releaseLock,
                    );

                handle =
                    null;
                // 因为是create，增加session.started事件
                await lease.append({
                    type:
                        "session.started",

                    workspaceRoot:
                    canonicalWorkspace,
                });

                signal.throwIfAborted();
                // 返回租约
                return lease;
            } catch (error) {
                // 报错的时候，回滚
                if (
                    lease !==
                    null
                ) {
                    // 通过租约关闭 资源
                    await lease.close()
                        .catch(
                            () => undefined,
                        );
                } else {
                    // 关闭handler和lock
                    await handle?.close()
                        .catch(
                            () => undefined,
                        );

                    await releaseLock()
                        .catch(
                            () => undefined,
                        );
                }
                // 如果文件已经被创建，还要删除文件
                if (sessionFileCreated) {
                    await unlink(
                        target,
                    ).catch(
                        () => undefined,
                    );
                }

                throw error;
            }
        } catch (error) {
            return rethrowSessionOperationError(
                error,

                signal,

                "Failed to create session",
            );
        }
    }

    /**
     * 打开session
     * @param workspaceRoot
     * @param sessionId
     * @param signal
     */
    public async open(
        workspaceRoot:
        string,

        sessionId:
        string,

        signal:
        AbortSignal,
    ): Promise<SessionLease> {
        // 快速失败
        signal.throwIfAborted();
        // 规范化sessionId
        const normalizedSessionId =
            normalizeSessionId(
                sessionId,
            );

        try {
            // 解析真实路径
            const canonicalWorkspace =
                await canonicalizeWorkspace(
                    workspaceRoot,

                    signal,
                );
            // 获取session目录
            const sessionDirectory =
                await prepareSessionDirectory(
                    canonicalWorkspace,

                    false,

                    signal,
                );
            // 获取session file路径
            const target =
                sessionFilePath(
                    sessionDirectory,

                    normalizedSessionId,
                );
            // 获取文件锁
            const releaseLock =
                await acquireLock(
                    sessionDirectory,

                    normalizedSessionId,

                    signal,
                );

            let handle:
                FileHandle | null =
                null;

            try {
                const pathMetadata =
                    await assertSafeSessionFilePath(
                        target,
                    );

                signal.throwIfAborted();
                // 打开session文件的句柄
                handle =
                    await open(
                        target,

                        fsConstants.O_RDWR |
                        fsConstants.O_APPEND,
                    );
                // 校验文件
                await assertSafeOpenFile(
                    handle,

                    fileIdentity(
                        pathMetadata,
                    ),
                );
                // 加载session
                const loaded =
                    await readSession(
                        handle,

                        normalizedSessionId,

                        canonicalWorkspace,

                        signal,
                    );
                // 包装成lease
                const lease =
                    new FileSessionLease(
                        normalizedSessionId,

                        canonicalWorkspace,

                        handle,

                        loaded.events,

                        loaded.byteLength,

                        releaseLock,
                    );

                handle =
                    null;

                return lease;
            } catch (error) {
                await handle?.close()
                    .catch(
                        () => undefined,
                    );

                await releaseLock()
                    .catch(
                        () => undefined,
                    );

                throw error;
            }
        } catch (error) {
            if (
                isNodeError(
                    error,

                    "ENOENT",
                )
            ) {
                throw new SessionError(
                    "not_found",

                    `Session not found: ${normalizedSessionId}`,

                    {
                        cause:
                        error,
                    },
                );
            }

            return rethrowSessionOperationError(
                error,

                signal,

                "Failed to open session",
            );
        }
    }

    /**
     * 只加载session
     * @param workspaceRoot
     * @param sessionId
     * @param signal
     */
    public async load(
        workspaceRoot:
        string,

        sessionId:
        string,

        signal:
        AbortSignal,
    ): Promise<LoadedSession> {
        signal.throwIfAborted();

        const normalizedSessionId =
            normalizeSessionId(
                sessionId,
            );

        let handle:
            FileHandle | null =
            null;

        try {
            const canonicalWorkspace =
                await canonicalizeWorkspace(
                    workspaceRoot,

                    signal,
                );

            const sessionDirectory =
                await prepareSessionDirectory(
                    canonicalWorkspace,

                    false,

                    signal,
                );

            const target =
                sessionFilePath(
                    sessionDirectory,

                    normalizedSessionId,
                );

            const pathMetadata =
                await assertSafeSessionFilePath(
                    target,
                );

            signal.throwIfAborted();

            handle =
                await open(
                    target,

                    fsConstants.O_RDONLY,
                );

            await assertSafeOpenFile(
                handle,

                fileIdentity(
                    pathMetadata,
                ),
            );

            const loaded =
                await readSession(
                    handle,

                    normalizedSessionId,

                    canonicalWorkspace,

                    signal,
                );

            return {
                sessionId:
                normalizedSessionId,

                workspaceRoot:
                canonicalWorkspace,

                events:
                loaded.events,
            };
        } catch (error) {
            if (
                isNodeError(
                    error,

                    "ENOENT",
                )
            ) {
                throw new SessionError(
                    "not_found",

                    `Session not found: ${normalizedSessionId}`,

                    {
                        cause:
                        error,
                    },
                );
            }

            return rethrowSessionOperationError(
                error,

                signal,

                "Failed to load session",
            );
        } finally {
            await handle?.close()
                .catch(
                    () => undefined,
                );
        }
    }
}


async function canonicalizeWorkspace(
    workspaceRoot:
    string,

    signal:
    AbortSignal,
): Promise<string> {
    signal.throwIfAborted();

    const canonical =
        await realpath(
            path.resolve(
                workspaceRoot,
            ),
        );

    signal.throwIfAborted();

    const metadata =
        await stat(
            canonical,
        );

    if (!metadata.isDirectory()) {
        throw new SessionError(
            "unsafe_storage",

            "Workspace root must be a directory",
        );
    }

    return canonical;
}


async function prepareSessionDirectory(
    workspaceRoot:
    string,

    create:
    boolean,

    signal:
    AbortSignal,
): Promise<string> {
    const controlDirectory =
        path.join(
            workspaceRoot,

            CONTROL_DIRECTORY_NAME,
        );

    const sessionDirectory =
        path.join(
            controlDirectory,

            SESSION_DIRECTORY_NAME,
        );

    if (create) {
        await createDirectoryIfMissing(
            controlDirectory,
        );
    }

    await assertSafeDirectory(
        controlDirectory,
    );

    signal.throwIfAborted();

    if (create) {
        await createDirectoryIfMissing(
            sessionDirectory,
        );
    }

    await assertSafeDirectory(
        sessionDirectory,
    );

    signal.throwIfAborted();

    return sessionDirectory;
}


async function createDirectoryIfMissing(
    target:
    string,
): Promise<void> {
    try {
        await mkdir(
            target,

            {
                mode:
                DIRECTORY_MODE,
            },
        );
    } catch (error) {
        if (
            !isNodeError(
                error,

                "EEXIST",
            )
        ) {
            throw error;
        }
    }
}


async function assertSafeDirectory(
    target:
    string,
): Promise<void> {
    const metadata =
        await lstat(
            target,
        );

    if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory()
    ) {
        throw new SessionError(
            "unsafe_storage",

            `Session storage is not a regular directory: ${target}`,
        );
    }

    const canonical =
        await realpath(
            target,
        );

    if (
        !samePath(
            canonical,

            target,
        )
    ) {
        throw new SessionError(
            "unsafe_storage",

            `Session storage resolves through an unsafe path: ${target}`,
        );
    }
}


async function assertSafeSessionFilePath(
    target:
    string,
): Promise<Stats> {
    const metadata =
        await lstat(
            target,
        );

    if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.nlink !== 1
    ) {
        throw new SessionError(
            "unsafe_storage",

            "Session path must be a regular, non-linked file",
        );
    }

    return metadata;
}


async function assertSafeOpenFile(
    handle:
    FileHandle,

    expectedIdentity:
        FileIdentity | null,
): Promise<Stats> {
    const metadata =
        await handle.stat();

    if (
        !metadata.isFile() ||
        metadata.nlink !== 1
    ) {
        throw new SessionError(
            "unsafe_storage",

            "Session file handle must refer to a regular, non-linked file",
        );
    }

    if (
        expectedIdentity !==
        null &&
        !sameFileIdentity(
            expectedIdentity,

            fileIdentity(
                metadata,
            ),
        )
    ) {
        throw new SessionError(
            "unsafe_storage",

            "Session file changed while it was being opened",
        );
    }

    return metadata;
}

/**
 * 获取文件锁
 * @param sessionDirectory
 * @param sessionId
 * @param signal
 */
async function acquireLock(
    sessionDirectory:
    string,

    sessionId:
    string,

    signal:
    AbortSignal,
): Promise<() => Promise<void>> {
    // 快速失败
    signal.throwIfAborted();
    // 文件锁路径
    const target =
        lockFilePath(
            sessionDirectory,

            sessionId,
        );

    let handle:
        FileHandle;
    // w写写模式创建文件，x要求文件必须不存在
    try {
        handle =
            await open(
                target,

                "wx",

                FILE_MODE,
            );
    } catch (error) {
        // 文件锁已经存在
        if (
            isNodeError(
                error,

                "EEXIST",
            )
        ) {
            // 确认它是一个合理的文件锁
            await assertExistingLockIsSafe(
                target,
            );

            throw new SessionError(
                "locked",

                `Session is already open for writing: ${sessionId}`,

                {
                    cause:
                    error,
                },
            );
        }

        throw error;
    }
    // 标识真正打开的是哪个底层文件
    let identity:
        FileIdentity;

    try {
        const metadata =
            await assertSafeOpenFile(
                handle,

                null,
            );
        // 保存identity是为了释放锁时别删错文件
        identity =
            fileIdentity(
                metadata,
            );
        // 写入诊断信息
        await handle.writeFile(
            `${JSON.stringify({
                pid:
                process.pid,// 在文件锁里面记录pid，别的进程检测的时候，不仅检测，文件锁是否存在，而且检测文件锁的pid是否存活

                acquiredAt:
                     new Date()
                        .toISOString(),
            })}\n`,

            "utf8",
        );
        // 刷盘
        await handle.sync();

        signal.throwIfAborted();
    } catch (error) {
        // 如果出错，关闭handler
        await handle.close()
            .catch(
                () => undefined,
            );
        // 删除target 文件锁
        await unlink(
            target,
        ).catch(
            () => undefined,
        );

        throw error;
    }
    // 记录是否释放
    let released =
        false;

    return async () => {
        //如果已经释放，则直接返回
        if (released) {
            return;
        }
        // 设置释放状态
        released =
            true;

        let closeError:
            unknown;

        try {
            // 关闭锁文件句柄
            await handle.close();
        } catch (error) {
            closeError =
                error;
        }

        try {
            // 检测当前target路径锁文件和原本的锁文件是否真的是一个东西
            const current =
                await lstat(
                    target,
                );

            if (
                current.isSymbolicLink() ||
                !current.isFile() ||
                !sameFileIdentity(
                    identity,

                    fileIdentity(
                        current,
                    ),
                )
            ) {
                throw new SessionError(
                    "unsafe_storage",

                    "Session lock changed while the lease was active",
                );
            }
            // 删除锁文件
            await unlink(
                target,
            );
        } catch (error) {
            if (
                !isNodeError(
                    error,

                    "ENOENT",
                )
            ) {
                closeError ??=
                    error;
            }
        }

        if (
            closeError !==
            undefined
        ) {
            throw closeError;
        }
    };
}


async function assertExistingLockIsSafe(
    target:
    string,
): Promise<void> {
    const metadata =
        await lstat(
            target,
        );

    if (
        metadata.isSymbolicLink() ||
        !metadata.isFile() ||
        metadata.nlink !== 1
    ) {
        throw new SessionError(
            "unsafe_storage",

            "Session lock path is unsafe",
        );
    }
}

/**
 * 读取session文件
 * @param handle
 * @param sessionId
 * @param workspaceRoot
 * @param signal
 */
async function readSession(
    handle:
    FileHandle,

    sessionId:
    string,

    workspaceRoot:
    string,

    signal:
    AbortSignal,
): Promise<ReadSessionResult> {
    //
    signal.throwIfAborted();
    // 校验文件
    const metadata =
        await assertSafeOpenFile(
            handle,

            null,
        );
    // 判断大小
    if (
        !Number.isSafeInteger(
            metadata.size,
        ) ||
        metadata.size <
        0
    ) {
        throw new SessionError(
            "corrupt",

            "Session has an invalid file size",
        );
    }

    if (
        metadata.size >
        MAX_SESSION_BYTES
    ) {
        throw new SessionError(
            "session_too_large",

            "Session exceeds persistence limit",
        );
    }
    // 分配内存
    const bytes =
        Buffer.alloc(
            metadata.size,
        );

    let offset =
        0;

    while (
        offset <
        bytes.length
        ) {
        signal.throwIfAborted();

        const {
            bytesRead,
        } =
            await handle.read(
                bytes,

                offset,

                bytes.length -
                offset,

                offset,
            );

        if (
            bytesRead <=
            0
        ) {
            throw new SessionError(
                "corrupt",

                "Session file ended while it was being read",
            );
        }

        offset +=
            bytesRead;
    }
    // 解析每一行JSONL
    const events =
        parseJsonLines(
            decodeUtf8(
                bytes,
            ),
        );

    validateSessionIdentity(
        events,

        sessionId,

        workspaceRoot,
    );

    return {
        events,

        byteLength:
        bytes.length,
    };
}


function decodeUtf8(
    bytes:
    Uint8Array,
): string {
    try {
        return new TextDecoder(
            "utf-8",

            {
                fatal:
                    true,
            },
        ).decode(
            bytes,
        );
    } catch (error) {
        throw new SessionError(
            "corrupt",

            "Session file is not valid UTF-8",

            {
                cause:
                error,
            },
        );
    }
}


function parseJsonLines(
    text:
    string,
): readonly SessionEventEnvelope[] {
    const lines =
        text.split(
            "\n",
        );

    if (
        lines.at(-1) ===
        ""
    ) {
        lines.pop();
    }

    if (
        lines.length ===
        0
    ) {
        throw new SessionError(
            "corrupt",

            "Session file is empty",
        );
    }

    const events:
        SessionEventEnvelope[] =
        [];

    for (
        const [index, line]
        of lines.entries()
        ) {
        if (
            line.trim().length ===
            0
        ) {
            throw new SessionError(
                "corrupt",

                `Session contains an empty line at ${index + 1}`,
            );
        }

        if (
            Buffer.byteLength(
                line,

                "utf8",
            ) +
            1 >
            MAX_SESSION_EVENT_BYTES
        ) {
            throw new SessionError(
                "event_too_large",

                `Session event at line ${index + 1} exceeds persistence limit`,
            );
        }

        let value:
            unknown;

        try {
            value =
                JSON.parse(
                    line,
                );
        } catch (error) {
            throw new SessionError(
                "corrupt",

                `Session contains invalid JSON at line ${index + 1}`,

                {
                    cause:
                    error,
                },
            );
        }

        try {
            events.push(
                parseSessionEventEnvelope(
                    value,
                ),
            );
        } catch (error) {
            if (
                error instanceof
                SessionError &&
                error.code ===
                "unsupported_version"
            ) {
                throw error;
            }

            throw new SessionError(
                "corrupt",

                `Session event at line ${index + 1} failed validation`,

                {
                    cause:
                    error,
                },
            );
        }
    }

    return events;
}


function validateSessionIdentity(
    events:
    readonly SessionEventEnvelope[],

    sessionId:
    string,

    workspaceRoot:
    string,
): void {
    const first =
        events[0];

    if (
        first ===
        undefined ||
        first.event.type !==
        "session.started"
    ) {
        throw new SessionError(
            "corrupt",

            "Session must start with session.started",
        );
    }

    for (
        const [index, envelope]
        of events.entries()
        ) {
        if (
            envelope.sessionId !==
            sessionId
        ) {
            throw new SessionError(
                "corrupt",

                `Session id mismatch at sequence ${index}`,
            );
        }

        if (
            envelope.sequence !==
            index
        ) {
            throw new SessionError(
                "corrupt",

                `Invalid session sequence: expected ${index}, received ${envelope.sequence}`,
            );
        }

        if (
            index >
            0 &&
            envelope.event.type ===
            "session.started"
        ) {
            throw new SessionError(
                "corrupt",

                "Session contains more than one session.started event",
            );
        }
    }

    if (
        !path.isAbsolute(
            first.event.workspaceRoot,
        ) ||
        !samePath(
            first.event.workspaceRoot,

            workspaceRoot,
        )
    ) {
        throw new SessionError(
            "workspace_mismatch",

            "Session belongs to a different workspace",
        );
    }
}


function sessionFilePath(
    sessionDirectory:
    string,

    sessionId:
    string,
): string {
    return path.join(
        sessionDirectory,

        `${sessionId}${SESSION_FILE_SUFFIX}`,
    );
}


function lockFilePath(
    sessionDirectory:
    string,

    sessionId:
    string,
): string {
    return path.join(
        sessionDirectory,

        `${sessionId}${SESSION_LOCK_SUFFIX}`,
    );
}


function samePath(
    left:
    string,

    right:
    string,
): boolean {
    const normalizedLeft =
        path.resolve(
            left,
        );

    const normalizedRight =
        path.resolve(
            right,
        );

    if (
        process.platform ===
        "win32"
    ) {
        return normalizedLeft
                .toLowerCase() ===
            normalizedRight
                .toLowerCase();
    }

    return normalizedLeft ===
        normalizedRight;
}


function fileIdentity(
    metadata:
    Stats,
): FileIdentity {
    return {
        dev:
        metadata.dev,

        ino:
        metadata.ino,
    };
}


function sameFileIdentity(
    left:
    FileIdentity,

    right:
    FileIdentity,
): boolean {
    return left.dev ===
        right.dev &&
        left.ino ===
        right.ino;
}


function isNodeError(
    error:
    unknown,

    code:
    string,
): error is NodeJS.ErrnoException {
    return error instanceof
        Error &&
        "code" in error &&
        error.code ===
        code;
}


function asIoError(
    error:
    unknown,

    message:
    string,
): SessionError {
    if (
        error instanceof
        SessionError
    ) {
        return error;
    }

    return new SessionError(
        "io_error",

        message,

        {
            cause:
            error,
        },
    );
}


function rethrowSessionOperationError(
    error:
    unknown,

    signal:
    AbortSignal,

    message:
    string,
): never {
    if (signal.aborted) {
        signal.throwIfAborted();
    }

    throw asIoError(
        error,

        message,
    );
}
