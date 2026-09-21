import type {
    ToolResult,
} from "./tool-result.js";

export function renderToolResult(
    result:
    ToolResult,
): string {
    if (!result.ok) {
        return JSON.stringify({
            error:
            result.error,
        });
    }

    if (
        typeof result.output ===
        "string"
    ) {
        return result.output;
    }

    return JSON.stringify(
        result.output,
    );
}