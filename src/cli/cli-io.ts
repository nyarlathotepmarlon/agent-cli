export interface CliIo {
    readonly inputIsTTY: boolean;

    readonly outputIsTTY: boolean;

    writeOut(text: string): void;

    writeErr(text: string): void;
}

export function isInteractiveTerminal(
    io: CliIo,
): boolean {
    return (
        io.inputIsTTY &&
        io.outputIsTTY
    );
}