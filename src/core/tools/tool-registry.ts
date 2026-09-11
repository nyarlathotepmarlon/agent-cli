import type { ModelToolDefinition } from "../model/model-tool-definition.js";
import type { Tool } from "./tool.js";
// 集中注册、校验、存储工具，并向模型提供工具定义
export class ToolRegistry {
    // 实际的工具注册表<工具名，工具对象>
    private readonly tools = new Map<string, Tool>();

    /**
     * 接受只读的工具数组，逐个校验并注册
     * @param tools
     */
    public constructor(tools: readonly Tool[] = []) {

        for (const tool of tools) {
            // 项目约定：小写字母开头，使用 snake_case，最长 64 个字符。
            if (!/^[a-z][a-z0-9_]{0,63}$/.test(tool.name)) {
                throw new Error(`Invalid tool name: ${tool.name}`);
            }
            // 工具没有描述也报错
            if (tool.description.trim().length === 0) {
                throw new Error(`Missing tool description: ${tool.name}`);
            }
            // 工具重复也报错
            if (this.tools.has(tool.name)) {
                throw new Error(`Duplicate tool name: ${tool.name}`);
            }
            // 注册工具
            this.tools.set(tool.name, tool);
        }
    }
    // 按名称查找Tool
    public get(name: string): Tool | undefined {
        return this.tools.get(name);
    }
    // 生产模型工具定义
    public get definitions(): readonly ModelToolDefinition[] {
        return Array.from(this.tools.values(), (tool) => ({
            name: tool.name,
            description: tool.description,
            // 对外提供副本，防止调用方改变内部的参数说明。
            inputSchema: structuredClone(tool.inputSchema),
        }));
    }
}