import {
    describe,
    expect,
    it,
} from "vitest";

import type {
    Model,
} from "../../../src/core/model/model.js";

import type {
    ModelProvider,
} from "../../../src/infrastructure/model/model-provider.js";

import {
    ModelRegistry,
    ModelResolutionError,
} from "../../../src/infrastructure/model/model-registry.js";

function createProvider(
    id: string,
): ModelProvider {
    return {
        id,

        createModel(
            modelId: string,
        ): Model {
            return {
                provider: id,

                id: modelId,

                async generate() {
                    throw new Error(
                        "not implemented",
                    );
                },
            };
        },
    };
}

describe(
    "ModelRegistry",
    () => {
        it(
            "resolves a model from a provider",
            () => {
                const registry =
                    new ModelRegistry([
                        createProvider(
                            "openai",
                        ),
                    ]);

                const model =
                    registry.resolve({
                        provider:
                            "OPENAI",

                        model:
                            "gpt-test",
                    });

                expect(
                    model.provider,
                ).toBe(
                    "openai",
                );

                expect(
                    model.id,
                ).toBe(
                    "gpt-test",
                );
            },
        );

        it(
            "rejects unknown providers",
            () => {
                const registry =
                    new ModelRegistry([]);

                expect(() =>
                    registry.resolve({
                        provider:
                            "unknown",

                        model:
                            "test",
                    }),
                ).toThrow(
                    ModelResolutionError,
                );
            },
        );

        it(
            "rejects duplicate providers",
            () => {
                expect(
                    () =>
                        new ModelRegistry([
                            createProvider(
                                "openai",
                            ),

                            createProvider(
                                "OPENAI",
                            ),
                        ]),
                ).toThrow(
                    "Duplicate model provider",
                );
            },
        );
    },
);