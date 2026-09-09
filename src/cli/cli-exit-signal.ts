import type {
    ExitCode,
} from "./exit-code.js";

export class CliExitSignal
    extends Error
{
    public override readonly name =
        "CliExitSignal";

    public constructor(
        public readonly exitCode:
        ExitCode,
    ) {
        super(
            `CLI exit: ${exitCode}`,
        );
    }
}