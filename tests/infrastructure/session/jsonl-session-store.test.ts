import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from "vitest";

import {
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rm,
    writeFile,
} from "node:fs/promises";

import {
    tmpdir,
} from "node:os";

import * as path
    from "node:path";

import type {
    SessionLease,
} from "../../../src/application/session-store.js";

import {
    JsonlSessionStore,
    MAX_SESSION_EVENT_BYTES,
} from "../../../src/infrastructure/session/jsonl-session-store.js";


let temporary:
    string;

let workspace:
    string;

let store:
    JsonlSessionStore;

const openLeases =
    new Set<SessionLease>();


function signal():
    AbortSignal {
    return new AbortController()
        .signal;
}


function remember(
    lease:
    SessionLease,
): SessionLease {
    openLeases.add(
        lease,
    );

    return lease;
}


async function close(
    lease:
    SessionLease,
): Promise<void> {
    await lease.close();

    openLeases.delete(
        lease,
    );
}


beforeEach(
    async () => {
        temporary =
            await mkdtemp(
                path.join(
                    tmpdir(),

                    "agent-cli-session-",
                ),
            );

        workspace =
            path.join(
                temporary,

                "中文 workspace",
            );

        await mkdir(
            workspace,
        );

        store =
            new JsonlSessionStore();
    },
);


afterEach(
    async () => {
        for (
            const lease
            of openLeases
        ) {
            await lease.close()
                .catch(
                    () => undefined,
                );
        }

        openLeases.clear();

        await rm(
            temporary,

            {
                recursive:
                true,

                force:
                true,
            },
        );
    },
);


describe(
    "JsonlSessionStore",

    () => {
        it(
            "creates, appends, loads and reopens a session",

            async () => {
                const created =
                    remember(
                        await store.create(
                            workspace,

                            signal(),
                        ),
                    );

                expect(
                    created.events,
                ).toHaveLength(
                    1,
                );

                expect(
                    created.events[0],
                ).toMatchObject({
                    sequence:
                    0,

                    event: {
                        type:
                            "session.started",

                        workspaceRoot:
                            await realpath(
                                workspace,
                            ),
                    },
                });

                const appended =
                    await created.append({
                        type:
                            "user.message",

                        content:
                            "你好，Session",

                        model: {
                            provider:
                                "test",

                            model:
                                "test-model",
                        },

                        permissionMode:
                            "safe",

                        runMode:
                            "interactive",
                    });

                expect(
                    appended.sequence,
                ).toBe(
                    1,
                );

                await close(
                    created,
                );

                const loaded =
                    await store.load(
                        workspace,

                        created.sessionId,

                        signal(),
                    );

                expect(
                    loaded.events.map(
                        (item) =>
                            item.sequence,
                    ),
                ).toEqual([
                    0,
                    1,
                ]);

                const reopened =
                    remember(
                        await store.open(
                            workspace,

                            created.sessionId,

                            signal(),
                        ),
                    );

                const terminal =
                    await reopened.append({
                        type:
                            "run.finished",

                        status:
                            "completed",

                        reason:
                            null,
                    });

                expect(
                    terminal.sequence,
                ).toBe(
                    2,
                );

                await close(
                    reopened,
                );

                const persisted =
                    await readFile(
                        path.join(
                            workspace,

                            ".agent",

                            "sessions",

                            `${created.sessionId}.jsonl`,
                        ),

                        "utf8",
                    );

                expect(
                    persisted.endsWith(
                        "\n",
                    ),
                ).toBe(
                    true,
                );

                expect(
                    persisted.trimEnd()
                        .split(
                            "\n",
                        ),
                ).toHaveLength(
                    3,
                );
            },
        );

        it(
            "serializes concurrent appends without duplicate sequences",

            async () => {
                const lease =
                    remember(
                        await store.create(
                            workspace,

                            signal(),
                        ),
                    );

                const envelopes =
                    await Promise.all(
                        Array.from(
                            {
                                length:
                                20,
                            },

                            (_, index) =>
                                lease.append({
                                    type:
                                        "user.message",

                                    content:
                                        String(
                                            index,
                                        ),

                                    model: {
                                        provider:
                                            "test",

                                        model:
                                            "test-model",
                                    },

                                    permissionMode:
                                        "safe",

                                    runMode:
                                        "non-interactive",
                                }),
                        ),
                    );

                expect(
                    envelopes.map(
                        (item) =>
                            item.sequence,
                    ),
                ).toEqual(
                    Array.from(
                        {
                            length:
                            20,
                        },

                        (_, index) =>
                            index +
                            1,
                    ),
                );

                await close(
                    lease,
                );
            },
        );

        it(
            "allows readers but rejects a second writer while leased",

            async () => {
                const lease =
                    remember(
                        await store.create(
                            workspace,

                            signal(),
                        ),
                    );

                await expect(
                    store.open(
                        workspace,

                        lease.sessionId,

                        signal(),
                    ),
                ).rejects.toMatchObject({
                    code:
                        "locked",
                });

                await expect(
                    store.load(
                        workspace,

                        lease.sessionId,

                        signal(),
                    ),
                ).resolves.toMatchObject({
                    sessionId:
                    lease.sessionId,
                });

                await close(
                    lease,
                );

                const reopened =
                    remember(
                        await store.open(
                            workspace,

                            lease.sessionId,

                            signal(),
                        ),
                    );

                await close(
                    reopened,
                );
            },
        );

        it(
            "rejects invalid events before writing and enforces the event limit",

            async () => {
                const lease =
                    remember(
                        await store.create(
                            workspace,

                            signal(),
                        ),
                    );

                await expect(
                    lease.append({
                        type:
                            "run.finished",

                        status:
                            "completed",

                        reason:
                            Number.NaN,
                    }),
                ).rejects.toMatchObject({
                    code:
                        "invalid_event",
                });

                await expect(
                    lease.append({
                        type:
                            "user.message",

                        content:
                            "x".repeat(
                                MAX_SESSION_EVENT_BYTES,
                            ),

                        model: {
                            provider:
                                "test",

                            model:
                                "test-model",
                        },

                        permissionMode:
                            "safe",

                        runMode:
                            "interactive",
                    }),
                ).rejects.toMatchObject({
                    code:
                        "event_too_large",
                });

                expect(
                    lease.events,
                ).toHaveLength(
                    1,
                );

                await close(
                    lease,
                );
            },
        );

        it(
            "reports invalid ids, missing sessions and corrupt JSONL",

            async () => {
                await expect(
                    store.load(
                        workspace,

                        "../escape",

                        signal(),
                    ),
                ).rejects.toMatchObject({
                    code:
                        "invalid_id",
                });

                await expect(
                    store.load(
                        workspace,

                        "00000000-0000-4000-8000-000000000000",

                        signal(),
                    ),
                ).rejects.toMatchObject({
                    code:
                        "not_found",
                });

                const lease =
                    remember(
                        await store.create(
                            workspace,

                            signal(),
                        ),
                    );

                const sessionId =
                    lease.sessionId;

                await close(
                    lease,
                );

                await writeFile(
                    path.join(
                        workspace,

                        ".agent",

                        "sessions",

                        `${sessionId}.jsonl`,
                    ),

                    "{truncated",

                    "utf8",
                );

                await expect(
                    store.load(
                        workspace,

                        sessionId,

                        signal(),
                    ),
                ).rejects.toMatchObject({
                    code:
                        "corrupt",
                });
            },
        );

        it(
            "preserves the abort reason",

            async () => {
                const controller =
                    new AbortController();

                const reason =
                    new Error(
                        "user cancelled",
                    );

                controller.abort(
                    reason,
                );

                await expect(
                    store.create(
                        workspace,

                        controller.signal,
                    ),
                ).rejects.toBe(
                    reason,
                );
            },
        );
    },
);
