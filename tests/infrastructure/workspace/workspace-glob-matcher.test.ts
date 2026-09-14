import {
    describe,
    expect,
    it,
} from "vitest";

import {
    matchesWorkspaceGlob,
} from "../../../src/infrastructure/workspace/workspace-glob-matcher.js";

describe(
    "matchesWorkspaceGlob",
    () => {
        it(
            "matches ordinary files",
            () => {
                expect(
                    matchesWorkspaceGlob(
                        "src/auth.ts",
                        "**/*.ts",
                    ),
                ).toBe(true);
            },
        );

        it(
            "matches files inside hidden directories",
            () => {
                expect(
                    matchesWorkspaceGlob(
                        ".github/workflow.ts",
                        "**/*.ts",
                    ),
                ).toBe(true);

                expect(
                    matchesWorkspaceGlob(
                        "src/.generated/types.ts",
                        "**/*.ts",
                    ),
                ).toBe(true);
            },
        );

        it(
            "matches hidden files",
            () => {
                expect(
                    matchesWorkspaceGlob(
                        ".config.ts",
                        "**/*.ts",
                    ),
                ).toBe(true);
            },
        );

        it(
            "does not match another extension",
            () => {
                expect(
                    matchesWorkspaceGlob(
                        ".github/workflow.yml",
                        "**/*.ts",
                    ),
                ).toBe(false);
            },
        );

        it(
            "matches root-level files with globstar",
            () => {
                expect(
                    matchesWorkspaceGlob(
                        "index.ts",
                        "**/*.ts",
                    ),
                ).toBe(true);
            },
        );
    },
);