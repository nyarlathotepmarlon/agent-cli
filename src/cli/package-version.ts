import { readFile } from "node:fs/promises";

export async function readPackageVersion():
    Promise<string> {
    const packageJsonUrl =
        new URL(
            "../../package.json",
            import.meta.url,
        );

    const content =
        await readFile(
            packageJsonUrl,
            "utf8",
        );

    const parsed: unknown =
        JSON.parse(content);

    if (!hasVersion(parsed)) {
        throw new Error(
            "package.json does not contain a valid version",
        );
    }

    return parsed.version;
}

function hasVersion(
    value: unknown,
): value is {
    readonly version: string;
} {
    if (
        typeof value !== "object" ||
        value === null
    ) {
        return false;
    }

    if (!("version" in value)) {
        return false;
    }

    return (
        typeof value.version === "string" &&
        value.version.length > 0
    );
}