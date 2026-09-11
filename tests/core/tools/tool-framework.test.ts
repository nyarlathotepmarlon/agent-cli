import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { DefaultAgentToolRuntime } from "../../../src/core/tools/default-agent-tool-runtime.js";
import { ToolRegistry } from "../../../src/core/tools/tool-registry.js";
import type { JsonObject } from "../../../src/core/shared/json.js";
import type { Tool } from "../../../src/core/tools/tool.js";
import type { ToolResult } from "../../../src/core/tools/tool-result.js";
import { addIntegersTool } from "../../../src/infrastructure/tools/add-integers-tool.js";
import { defineTool } from "../../../src/infrastructure/tools/define-tool.js";

function createRuntime(tools: readonly Tool[] = [addIntegersTool]) {
    return new DefaultAgentToolRuntime(new ToolRegistry(tools));
}

function context() {
    return { signal: new AbortController().signal };
}

describe("Tool framework", () => {
    it("publishes definitions without executable functions", () => {
        const [definition] = new ToolRegistry([addIntegersTool]).definitions;

        expect(definition).toMatchObject({
            name: "add_integers",
            inputSchema: {
                type: "object",
                required: ["a", "b"],
                additionalProperties: false,
            },
        });
        expect(definition).not.toHaveProperty("execute");
    });

    it("rejects duplicate registrations at startup", () => {
        expect(
            () => new ToolRegistry([addIntegersTool, addIntegersTool]),
        ).toThrow("Duplicate tool name");
    });

    it("rejects invalid names and empty descriptions", () => {
        expect(() => new ToolRegistry([
            { ...addIntegersTool, name: "bad name" },
        ])).toThrow("Invalid tool name");

        expect(() => new ToolRegistry([
            { ...addIntegersTool, description: " " },
        ])).toThrow("Missing tool description");
    });

    it("executes a registered tool", async () => {
        const result = await createRuntime().execute({
            id: "call_1",
            name: "add_integers",
            input: { a: 2, b: 3 },
        }, context());

        expect(result).toEqual({ ok: true, output: { sum: 5 } });
    });

    it("returns an observation for an unknown tool", async () => {
        const result = await createRuntime().execute({
            id: "call_1",
            name: "missing_tool",
            input: {},
        }, context());

        expect(result).toMatchObject({
            ok: false,
            error: { code: "unavailable", retryable: false },
        });
    });

    it("rejects invalid input before invoking the handler", async () => {
        const execute = vi.fn(
            async (): Promise<ToolResult> => ({ ok: true, output: "ok" }),
        );

        const tool = defineTool({
            name: "checked_tool",
            description: "Accept a number.",
            schema: z.strictObject({ value: z.number() }),
            execute,
        });

        const result = await createRuntime([tool]).execute({
            id: "call_1",
            name: "checked_tool",
            input: { value: "2" },
        }, context());

        expect(result).toMatchObject({
            ok: false,
            error: {
                code: "invalid_input",
                details: {
                    issues: [
                        expect.objectContaining({ path: "value" }),
                    ],
                },
            },
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it("rejects missing, extra, fractional and out-of-range arguments", async () => {
        const inputs: readonly JsonObject[] = [
            { a: 2 },
            { a: 2, b: 3, extra: true },
            { a: 1.5, b: 3 },
            { a: 1_000_001, b: 3 },
        ];

        for (const input of inputs) {
            const result = await createRuntime().execute({
                id: "call_1",
                name: "add_integers",
                input,
            }, context());

            expect(result).toMatchObject({
                ok: false,
                error: { code: "invalid_input" },
            });
        }
    });

    it("requires a strict object schema when defining a tool", () => {
        expect(() => defineTool({
            name: "bad_schema",
            description: "An invalid tool definition.",
            schema: z.string(),
            async execute(): Promise<ToolResult> {
                return { ok: true, output: "unused" };
            },
        })).toThrow("strict object input schema");
    });

    it("passes expected tool failures through as observations", async () => {
        const failure: ToolResult = {
            ok: false,
            error: {
                code: "not_found",
                message: "Requested item does not exist",
                retryable: false,
            },
        };
        const tool = defineTool({
            name: "find_item",
            description: "Find an item.",
            schema: z.strictObject({}),
            async execute() {
                return failure;
            },
        });

        const result = await createRuntime([tool]).execute({
            id: "call_1",
            name: "find_item",
            input: {},
        }, context());

        expect(result).toEqual(failure);
    });

    it("does not hide unexpected programming errors", async () => {
        const bug = new Error("Unexpected bug");
        const tool = defineTool({
            name: "broken_tool",
            description: "A deliberately broken tool.",
            schema: z.strictObject({}),
            async execute(): Promise<ToolResult> {
                throw bug;
            },
        });

        await expect(createRuntime([tool]).execute({
            id: "call_1",
            name: "broken_tool",
            input: {},
        }, context())).rejects.toBe(bug);
    });

    it("does not invoke a tool after cancellation", async () => {
        const execute = vi.fn(
            async (): Promise<ToolResult> => ({ ok: true, output: "ok" }),
        );
        const tool = defineTool({
            name: "cancel_test",
            description: "Test cancellation.",
            schema: z.strictObject({}),
            execute,
        });
        const controller = new AbortController();
        const reason = new Error("User cancelled");
        controller.abort(reason);

        await expect(createRuntime([tool]).execute({
            id: "call_1",
            name: "cancel_test",
            input: {},
        }, { signal: controller.signal })).rejects.toBe(reason);

        expect(execute).not.toHaveBeenCalled();
    });

    it("checks cancellation again after a tool returns", async () => {
        const controller = new AbortController();
        const reason = new Error("User cancelled");
        const tool = defineTool({
            name: "cancel_during_execution",
            description: "Test cancellation during execution.",
            schema: z.strictObject({}),
            async execute(): Promise<ToolResult> {
                controller.abort(reason);
                return { ok: true, output: "late result" };
            },
        });

        await expect(createRuntime([tool]).execute({
            id: "call_1",
            name: "cancel_during_execution",
            input: {},
        }, { signal: controller.signal })).rejects.toBe(reason);
    });
});