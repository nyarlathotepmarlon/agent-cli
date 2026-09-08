import type {
    Model,
} from "../../core/model/model.js";

import type {
    ModelResolver,
    ModelSelection,
} from "../../application/model-resolver.js";

import type {
    ModelProvider,
} from "./model-provider.js";

export class ModelResolutionError
    extends Error
{
    public override readonly name =
        "ModelResolutionError";
}

export class ModelRegistry
    implements ModelResolver
{
    //注册表实际信息存储的地方
    private readonly providers =
        new Map<
            string,
            ModelProvider
        >();

    public constructor(
        providers:
        readonly ModelProvider[],// 所有供应商
    ) {
        //将所有供应商注册到注册表
        for (
            const provider
            of providers
            ) {
            // 规范化模型的名称
            const id =
                normalizeProviderId(
                    provider.id,
                );
            // 防止重复注册
            if (
                this.providers.has(id)
            ) {
                throw new Error(
                    `Duplicate model provider: ${id}`,
                );
            }
            // 将供应商存储到Map中
            this.providers.set(
                id,
                provider,
            );
        }
    }

    /**
     *
     * @param selection
     */
    public resolve(
        selection: ModelSelection,
    ): Model {
        // 规范化 供应商 名称
        const providerId =
            normalizeProviderId(
                selection.provider,
            );
        // 规范化模型名称
        const modelId =
            selection.model.trim();

        if (modelId.length === 0) {
            throw new ModelResolutionError(
                "Model id must not be empty",
            );
        }
        // 根据供应商的名称取出供应商对象
        const provider =
            this.providers.get(
                providerId,
            );

        if (provider === undefined) {
            throw new ModelResolutionError(
                `Unknown model provider: ${providerId}`,
            );
        }
        // 调用供应商创建对应的模型
        return provider.createModel(
            modelId,
        );
    }
}

/**
 * 将模型的名称规范化：去除空格并变成小写
 * @param value
 */
function normalizeProviderId(
    value: string,
): string {
    const normalized =
        value
            .trim()
            .toLowerCase();

    if (normalized.length === 0) {
        throw new ModelResolutionError(
            "Model provider must not be empty",
        );
    }

    return normalized;
}