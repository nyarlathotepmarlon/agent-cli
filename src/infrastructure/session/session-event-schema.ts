import {
    z,
} from "zod";

import type {
    AssistantModelMessage,
} from "../../core/model/model-message.js";

import type {
    ModelResponse,
} from "../../core/model/model-response.js";

import {
    PERMISSION_MODES,
} from "../../core/permissions/permission.js";

import type {
    JsonObject,
    JsonValue,
} from "../../core/shared/json.js";

import type {
    SessionEvent,
    SessionEventEnvelope,
} from "../../core/session/session-event.js";

import {
    SESSION_SCHEMA_VERSION,
} from "../../core/session/session-event.js";
import {SESSION_ID_PATTERN} from "../../core/session/session-id.js";
import type {
    ToolCall,
} from "../../core/tools/tool-call.js";

import type {
    ToolError,
} from "../../core/tools/tool-error.js";

import type {
    ToolResult,
} from "../../core/tools/tool-result.js";
import {SessionError} from "../../core/session/session-error.js";


/**
 * JSON
 *
 * 注意：
 * JSON number 不允许：
 *
 * - NaN
 * - Infinity
 * - -Infinity
 *
 * 所以这里使用 finite()。
 */
export const jsonValueSchema:
    z.ZodType<JsonValue> =
    z.lazy(
        () =>
            z.union([
                z.string(),

                z.number()
                    .finite(),

                z.boolean(),

                z.null(),

                z.array(
                    jsonValueSchema,
                ),

                z.record(
                    z.string(),

                    jsonValueSchema,
                ),
            ]),
    );


export const jsonObjectSchema:
    z.ZodType<JsonObject> =
    z.record(
        z.string(),

        jsonValueSchema,
    );


/**
 * ToolCall
 */
export const toolCallSchema:
    z.ZodType<ToolCall> =
    z.strictObject({
        id:
            z.string()
                .min(1),

        name:
            z.string()
                .min(1),

        input:
        jsonObjectSchema,
    });


/**
 * ToolError
 *
 * 当前 core 定义：
 *
 * interface ToolError {
 *     code: ToolErrorCode;
 *     message: string;
 *     retryable: boolean;
 *     details?: JsonObject;
 * }
 */
const toolErrorCodeSchema =
    z.enum([
        "invalid_input",
        "permission_denied",
        "not_found",
        "conflict",
        "timeout",
        "cancelled",
        "execution_failed",
        "unavailable",
        "internal_error",
    ]);


/**
 * 这里没有简单写：
 *
 * details: jsonObjectSchema.optional()
 *
 * 原因是项目开启了：
 *
 * exactOptionalPropertyTypes: true
 *
 * persistence JSON 中：
 *
 * {}
 *
 * 和：
 *
 * {
 *     details: undefined
 * }
 *
 * 不应该被看成同一种合法数据。
 *
 * JSON 本身也不存在 undefined。
 */
export const toolErrorSchema:
    z.ZodType<ToolError> =
    z.union([
        z.strictObject({
            code:
            toolErrorCodeSchema,

            message:
                z.string(),

            retryable:
                z.boolean(),

            details:
            jsonObjectSchema,
        }),

        z.strictObject({
            code:
            toolErrorCodeSchema,

            message:
                z.string(),

            retryable:
                z.boolean(),
        }),
    ]);


/**
 * ToolResult
 */
export const toolResultSchema:
    z.ZodType<ToolResult> =
    z.discriminatedUnion(
        "ok",

        [
            z.strictObject({
                ok:
                    z.literal(true),

                output:
                jsonValueSchema,
            }),

            z.strictObject({
                ok:
                    z.literal(false),

                error:
                toolErrorSchema,
            }),
        ],
    );


/**
 * AssistantModelMessage
 */
export const assistantMessageSchema:
    z.ZodType<AssistantModelMessage> =
    z.strictObject({
        role:
            z.literal(
                "assistant",
            ),

        content:
            z.string(),

        toolCalls:
            z.array(
                toolCallSchema,
            ),

        providerData:
            z.strictObject({
                provider:
                    z.string(),

                model:
                    z.string(),

                data:
                jsonObjectSchema,
            })
                .nullable(),
    });


/**
 * ModelResponse
 */
export const modelResponseSchema:
    z.ZodType<ModelResponse> =
    z.strictObject({
        message:
        assistantMessageSchema,

        finishReason:
            z.enum([
                "completed",
                "tool_calls",
                "max_output_tokens",
                "content_filter",
                "refused",
                "unknown",
            ]),

        usage:
            z.strictObject({
                inputTokens:
                    z.number()
                        .int()
                        .nonnegative(),

                outputTokens:
                    z.number()
                        .int()
                        .nonnegative(),
            })
                .nullable(),

        providerRequestId:
            z.string()
                .nullable(),
    });


/**
 * session.started
 */
const sessionStartedEventSchema =
    z.strictObject({
        type:
            z.literal(
                "session.started",
            ),

        workspaceRoot:
            z.string()
                .min(1),
    });


/**
 * user.message
 */
const sessionUserMessageEventSchema =
    z.strictObject({
        type:
            z.literal(
                "user.message",
            ),

        content:
            z.string(),

        model:
            z.strictObject({
                provider:
                    z.string()
                        .min(1),

                model:
                    z.string()
                        .min(1),
            }),

        permissionMode:
            z.enum(
                PERMISSION_MODES,
            ),

        runMode:
            z.enum([
                "interactive",
                "non-interactive",
            ]),
    });


/**
 * model.completed
 */
const sessionModelCompletedEventSchema =
    z.strictObject({
        type:
            z.literal(
                "model.completed",
            ),

        response:
        modelResponseSchema,
    });


/**
 * tool.started
 */
const sessionToolStartedEventSchema =
    z.strictObject({
        type:
            z.literal(
                "tool.started",
            ),

        call:
        toolCallSchema,
    });


/**
 * tool.completed
 */
const sessionToolCompletedEventSchema =
    z.strictObject({
        type:
            z.literal(
                "tool.completed",
            ),

        toolCallId:
            z.string()
                .min(1),

        result:
        toolResultSchema,
    });


/**
 * run.finished
 */
const sessionRunFinishedEventSchema =
    z.strictObject({
        type:
            z.literal(
                "run.finished",
            ),

        status:
            z.enum([
                "completed",
                "stopped",
                "cancelled",
                "failed",
                "interrupted",
            ]),

        /*
         * JsonValue 本身已经包含 null。
         *
         * 这里保留 nullable()，
         * 主要是为了和领域类型：
         *
         * JsonValue | null
         *
         * 在语义上保持一致。
         */
        reason:
            jsonValueSchema
                .nullable(),
    });


/**
 * SessionEvent
 *
 * discriminatedUnion 会直接根据 event.type
 * 选择对应 schema。
 */
export const sessionEventSchema:
    z.ZodType<SessionEvent> =
    z.discriminatedUnion(
        "type",

        [
            sessionStartedEventSchema,

            sessionUserMessageEventSchema,

            sessionModelCompletedEventSchema,

            sessionToolStartedEventSchema,

            sessionToolCompletedEventSchema,

            sessionRunFinishedEventSchema,
        ],
    );


/**
 * recordedAt
 *
 * 当前采用你原来的策略：
 *
 * Date.parse(value)
 *
 * 它验证的是：
 *
 * "这是一个 JavaScript 能解析的时间字符串"
 *
 * 而不是真正意义上的严格 RFC3339。
 *
 * 如果以后你希望持久化格式严格固定，
 * 可以再切换到 Zod 的 ISO datetime schema。
 */
const recordedAtSchema =
    z.string()
        .refine(
            (value) =>
                Number.isFinite(
                    Date.parse(
                        value,
                    ),
                ),

            "Invalid ISO timestamp",
        );


/**
 * SessionEventEnvelope V1
 *
 * 这是 persisted format。
 *
 * 注意它明确叫 V1，
 * 不要把未来的 V2 继续塞进这个 schema。
 */
export const sessionEventEnvelopeV1Schema:
    z.ZodType<SessionEventEnvelope> =
    z.strictObject({
        schemaVersion:
            z.literal(
                SESSION_SCHEMA_VERSION,
            ),

        /**
         * 当前 GitHub 仓库没有 SESSION_ID_PATTERN
         * 的定义，因此这里不擅自发明 ID 格式。
         *
         * 如果你的未上传代码已经有：
         *
         * SESSION_ID_PATTERN
         *
         * 则改成：
         *
         * z.string().regex(SESSION_ID_PATTERN)
         */
        sessionId:
            z.string().regex(
                SESSION_ID_PATTERN,
                "invalid_session_id"
            ),


        sequence:
            z.number()
                .int()
                .nonnegative(),

        recordedAt:
        recordedAtSchema,

        event:
        sessionEventSchema,
    });


/**
 * ============================================================
 * Persistence decode / migration boundary
 * ============================================================
 *
 * 外部数据不要：
 *
 * value as SessionEventEnvelope
 *
 * 而应该统一经过这里。
 */


/**
 * 只负责读取 schemaVersion。
 *
 * 注意这里故意不能 strictObject，
 * 因为我们只是先探测 envelope version，
 * 后续再交给对应版本的完整 schema 校验。
 */
const envelopeVersionProbeSchema =
    z.object({
        schemaVersion:
            z.number()
                .int()
                .nonnegative(),
    });


/**
 * 目前 current internal representation
 * 与 V1 完全相同。
 *
 * 未来如果 internal representation 改变，
 * 就把这个类型替换成新的内部类型。
 */
export type CurrentSessionEventEnvelope =
    SessionEventEnvelope;


/**
 * V1 persisted format
 * ->
 * current internal representation
 *
 * 当前是 identity migration。
 *
 * 即使现在什么都不做，也建议保留这个函数，
 * 因为这样将来 V2 出现时，读取数据的调用方
 * 完全不用改变。
 */
function migrateV1ToCurrent(
    envelope: SessionEventEnvelope,
): CurrentSessionEventEnvelope {
    return envelope;
}


/**
 * persistence 层读取 Session Event 的唯一入口。
 *
 * unknown
 *   ↓
 * inspect version
 *   ↓
 * validate persisted schema
 *   ↓
 * migrate
 *   ↓
 * current internal representation
 */
export function decodeSessionEventEnvelope(
    value: unknown,
): CurrentSessionEventEnvelope {
    const versionProbe =
        envelopeVersionProbeSchema
            .parse(
                value,
            );

    switch (
        versionProbe.schemaVersion
        ) {
        case 1: {
            const persisted =
                sessionEventEnvelopeV1Schema
                    .parse(
                        value,
                    );

            return migrateV1ToCurrent(
                persisted,
            );
        }

        default:
            throw new Error(
                `Unsupported session schema version: ${versionProbe.schemaVersion}`,
            );
    }
}

export function assertSessionEventEnvelopeForWrite(
    input: unknown,
): asserts input is SessionEventEnvelope {
    const parsed =
        sessionEventEnvelopeV1Schema
            .safeParse(
                input,
            );

    if (!parsed.success) {
        throw new SessionError(
            "invalid_event",
            "Session event is not persistable",
            {
                cause:
                parsed.error,
            },
        );
    }
}
export function parseSessionEventEnvelope(
    input: unknown,
): SessionEventEnvelope {
    if (
        typeof input === "object" &&
        input !== null &&
        "schemaVersion" in input &&
        typeof input.schemaVersion ===
        "number" &&
        input.schemaVersion !==
        SESSION_SCHEMA_VERSION
    ) {
        throw new SessionError(
            "unsupported_version",
            `Unsupported session schema version: ${input.schemaVersion}`,
        );
    }

    const parsed =
        sessionEventEnvelopeV1Schema
            .safeParse(
                input,
            );

    if (!parsed.success) {
        throw new SessionError(
            "corrupt",
            "Session event failed runtime validation",
            {
                cause:
                parsed.error,
            },
        );
    }

    return parsed.data;
}