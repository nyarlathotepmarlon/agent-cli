import type { CliIo } from "./cli-io.js";

export function createNodeCliIo(): CliIo {
    return {
        inputIsTTY:
            process.stdin.isTTY === true,

        outputIsTTY:
            process.stdout.isTTY === true,

        writeOut(text: string): void {
            process.stdout.write(text);
        },

        writeErr(text: string): void {
            process.stderr.write(text);
        },
    };
}