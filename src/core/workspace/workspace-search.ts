// 描述 调用globFiles时，需要传入哪些参数
export interface WorkspaceGlobRequest {
    readonly basePath: string; //搜索的根目录

    readonly pattern: string;//  glob pattern

    readonly maxResults: number;// 最多返回多少个结果
}
// 描述 glob 搜索执行完成之后返回什么
export type WorkspaceGlobResult ={
    readonly basePath: string;// 搜索的根目录

    readonly pattern: string;// glob pattern

    readonly paths: readonly string[];//匹配到的文件路径

    readonly truncated: boolean;// 返回 paths 是否因为数量限制被截断
}
// 文本搜索的模式
export type WorkspaceTextSearchMode =
    | "literal"// 按照普通字符串搜索
    | "regex";// 使用正则表达式搜索
// 描述 文本搜索请求
export interface WorkspaceTextSearchRequest {
    readonly basePath: string;// 根目录

    readonly query: string;// 想要搜索的内容

    readonly mode:
        WorkspaceTextSearchMode;// 搜索的模式

    readonly caseSensitive: boolean;// 控制大小写敏感

    readonly maxResults: number;// 返回的结果的最大数量
}
//描述 文本搜索的 一条具体搜索结果
export type WorkspaceTextMatch ={
    readonly path: string; // 匹配到的文件，是相对于basePath的路径

    readonly line: number;// 这个文件的第几行，行号从1开始

    readonly text: string;// 匹配到的文本内容

    readonly textTruncated: boolean;// 文本是否被截断
}
//描述 文本搜索结果
export type WorkspaceTextSearchResult ={
    readonly basePath: string;// 搜索的根目录

    readonly query: string;// 搜索的内容

    readonly mode:
        WorkspaceTextSearchMode;// 搜索的模式

    readonly caseSensitive: boolean;// 大小写敏感

    readonly matches:
        readonly WorkspaceTextMatch[];// 匹配的结果

    readonly truncated: boolean;// 匹配的结果是否被截断
}
// 核心接口
export interface SearchWorkspace {
    globFiles(
        request: WorkspaceGlobRequest,
        signal: AbortSignal,
    ): Promise<WorkspaceGlobResult>;

    searchText(
        request: WorkspaceTextSearchRequest,
        signal: AbortSignal,
    ): Promise<WorkspaceTextSearchResult>;
}