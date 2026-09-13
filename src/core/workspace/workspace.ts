// 描述一次文本读取的结果
export type WorkspaceTextFile = {
    readonly path: string; // 回显规范化的路径
    readonly content: string; // 真正交给模型看的文本
    readonly byteLength: number; // 磁盘真实字节数
};
// 描述目录中的一个条目
export type WorkspaceEntry = {
    readonly name: string; // 相对于父目录的名称
    readonly kind: "file" | "directory" | "symlink" | "other";// 文件类型
};
// 描述一次目录列举的结果
export type WorkspaceDirectory = {
    readonly path: string;
    readonly entries: readonly WorkspaceEntry[];
    readonly truncated: boolean; // true代表不是完整目录，只是前200项目
};
// 描述一个WorkSpace，对一个WorkSpace只做两件事情
export interface Workspace {
    readonly root: string;
    // 读取一个UTF-8文本文件
    readTextFile(
        path: string,
        signal: AbortSignal,
    ): Promise<WorkspaceTextFile>;
    // 看一层目录
    listDirectory(
        path: string,
        signal: AbortSignal,
    ): Promise<WorkspaceDirectory>;
}