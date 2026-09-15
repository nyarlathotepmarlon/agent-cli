// 描述 替换文本 请求
export type WorkspaceReplaceTextRequest ={
    readonly path: string;// 目标文本路径

    readonly expectedRevision: string;// 调用者认为当前问及那应该处于哪个版本

    readonly oldText: string;// 文件中准备被替换掉的原始文本

    readonly newText: string;// 文件中的新文本
}
// 替换文本后返回的结果
export type WorkspaceReplaceTextResult= {
    readonly path: string;// 修改的文件路径

    readonly previousRevision: string;// 修改前的版本

    readonly revision: string;// 修改后的版本

    readonly byteLength: number;// 修改后文件的字节数

    readonly changed: boolean;//文件是否真的发生了变化
}
// 创建文件请求
export type WorkspaceCreateTextFileRequest ={
    readonly path: string;// 创建文件的路径

    readonly content: string;// 文件的内容
}
// 文件创建的结果
export type WorkspaceCreateTextFileResult= {
    readonly path: string;// 创建文件的路径

    readonly revision: string;// 创建的文件的revision

    readonly byteLength: number;// 创建文件的字节长度
}

export interface EditableWorkspace {
    replaceText(
        request: WorkspaceReplaceTextRequest,
        signal: AbortSignal,
    ): Promise<WorkspaceReplaceTextResult>;

    createTextFile(
        request: WorkspaceCreateTextFileRequest,
        signal: AbortSignal,
    ): Promise<WorkspaceCreateTextFileResult>;
}