import { z } from "zod";
import { defineTool } from "./define-tool.js";

export const addIntegersTool = defineTool({
    name: "add_integers",
    description:
        "Add two integers between -1000000 and 1000000. " +
        "Returns an object containing their sum.",

    schema: z.strictObject({
        a: z.number().int().min(-1_000_000).max(1_000_000)
            .describe("The first integer."),
        b: z.number().int().min(-1_000_000).max(1_000_000)
            .describe("The second integer."),
    }),

    async execute(input, context) {
        context.signal.throwIfAborted();

        return {
            ok: true,
            output: {
                sum: input.a + input.b,
            },
        };
    },
});