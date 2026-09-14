import {
    minimatch,
} from "minimatch";

/**
 * Match normalized workspace-relative POSIX paths.
 *
 * Repository discovery intentionally includes hidden project paths
 * such as .github/, so glob matching must use dot=true as well.
 */
export function matchesWorkspaceGlob(
    candidate: string,
    pattern: string,
): boolean {
    return minimatch(
        candidate,
        pattern,
        {
            dot: true,

            /*
             * candidate/pattern 在进入这里之前
             * 都已经归一化为 "/"。
             *
             * 即使程序运行在 Windows，
             * glob protocol 仍保持 POSIX 风格。
             */
            platform: "linux",

            /*
             * 我们自己的 normalizeGlobPattern()
             * 已经禁止 ! 开头。
             * 这里再明确关闭 glob negation，
             * 避免 matcher 层出现第二套语义。
             */
            nonegate: true,

            /*
             * "#foo" 对 Agent 来说应该是文件 pattern，
             * 而不是 glob comment。
             */
            nocomment: true,
        },
    );
}