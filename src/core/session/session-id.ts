import {
    SessionError,
} from "./session-error.js";

export const SESSION_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function normalizeSessionId(
    value: string,
): string {
    const normalized =
        value
            .trim()
            .toLowerCase();

    if (
        !SESSION_ID_PATTERN.test(
            normalized,
        )
    ) {
        throw new SessionError(
            "invalid_id",
            "Session id must be a UUIDv4",
        );
    }

    return normalized;
}