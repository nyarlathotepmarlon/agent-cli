export type WorkspaceErrorCode =
    | "invalid_path"
    | "outside_workspace"
    | "invalid_range"
    | "text_too_large"
    | "not_found"
    | "not_file"
    | "not_directory"
    | "permission_denied"
    | "file_too_large"
    | "invalid_encoding"
    | "binary_file"
    | "io_error";

export class WorkspaceError extends Error {
    public constructor(
        public readonly code: WorkspaceErrorCode,
        message: string,
    ) {
        super(message);
        this.name = "WorkspaceError";
    }
}