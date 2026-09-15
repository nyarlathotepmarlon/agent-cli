// 失败原因建模
export type ExactTextEditFailureReason =
    | "not_found" // oldText根本不存在
    | "ambiguous";// oldText存在，但是不能确定是哪一个
// 结果建模
export type ExactTextEditResult =
    | {
    readonly ok: true;

    readonly content: string;

    readonly changed: boolean;
}
    | {
    readonly ok: false;

    readonly reason:
        ExactTextEditFailureReason;
};
// 规范化后的文本
interface NormalizedText {
    readonly text: string; // 换标被标准化的字符串

    /**
     * normalized UTF-16 boundary
     * -> original UTF-16 boundary
     * 比如source="A\r\nB",
     * 0   1       3   4
     * | A | \r\n | B |
     * 归一化之后
     * 0   1    2   3
     * | A | \n | B |
     * sourceOffsets=[0,1,3,4],即
     * normalized boundary 0 -> source boundary 0
     * normalized boundary 1 -> source boundary 1
     * normalized boundary 2 -> source boundary 3
     * normalized boundary 3 -> source boundary 4
     * 这样假设搜到\n，它的边界是1和3，source的对应边界是1,3
     */
    readonly sourceOffsets:
        readonly number[];// 保存由\r\n规范到\n后字符串的字符位置映射
}

export function applyExactTextEdit(
    source: string,
    oldText: string,
    newText: string,
): ExactTextEditResult {

    const normalizedSource =
        normalizeWithOffsets(
            source,
        );

    const normalizedOld =
        normalizeNewlines(
            oldText,
        );

    let start:
        number;

    let end:
        number;
    // 空字符独自处理
    if (
        normalizedOld.length === 0
    ) {
        /*
         * 唯一允许 empty oldText 的情况：
         * 编辑一个真正的空文件。
         */
        if (
            normalizedSource
                .text
                .length !== 0
        ) {
            // 文件不为空，却要寻找空字符串替换，认为每个地方都可以替换
            return {
                ok: false,

                reason:
                    "ambiguous",
            };
        }
        // 只有空文件才允许，
        start = 0;
        end = 0;
    } else {
        // 用规范化后的source去匹配规范化后的oldText，得到字符串匹配的起点
        const first =
            normalizedSource
                .text
                .indexOf(
                    normalizedOld,
                );
        // 如果匹配的起点不存在，说明没有匹配到
        if (first < 0) {
            return {
                ok: false,

                reason:
                    "not_found",
            };
        }

        /*
         * +1 而不是 +length，
         * 这样 overlapping match 也会被发现。
         */
        const second =
            normalizedSource
                .text
                .indexOf(
                    normalizedOld,
                    first + 1,
                );
        // 如果有第二个匹配，返回
        if (second >= 0) {
            return {
                ok: false,

                reason:
                    "ambiguous",
            };
        }
        // 确定oldText在normalizedText的左边界
        start = first;
        // 确定oldText在normalizedText的右边界
        end =
            first +
            normalizedOld.length;
    }
    // 映射到源文本的左边界
    const sourceStart =
        normalizedSource
            .sourceOffsets[start];
    // 映射到源文本的右边界
    const sourceEnd =
        normalizedSource
            .sourceOffsets[end];

    if (
        sourceStart === undefined ||
        sourceEnd === undefined
    ) {
        throw new Error(
            "Invalid normalized text boundary",
        );
    }
    // 检测源文件的换行风格
    const lineEnding =
        detectPreferredLineEnding(
            source,
        );
    // 对newLine做换行风格替换
    const replacement =
        convertLineEndings(
            newText,
            lineEnding,
        );

    const content =
        source.slice(
            0,
            sourceStart,
        ) +
        replacement +
        source.slice(
            sourceEnd,
        );

    return {
        ok: true,

        content,// 返回更新后的行

        changed:
            content !== source,
    };
}

function normalizeWithOffsets(
    source: string,
): NormalizedText {
    let text = "";

    const sourceOffsets:
        number[] = [0];

    let sourceIndex = 0;

    while (
        sourceIndex <
        source.length
        ) {
        // 获取当前要处理的字符
        const current =
            source[
                sourceIndex
                ];
        // 特殊处理CRLF
        if (
            current === "\r"
        ) {
            if (
                source[
                sourceIndex + 1
                    ] === "\n"
            ) {
                sourceIndex += 2;
            } else {
                sourceIndex += 1;
            }

            text += "\n";

            sourceOffsets.push(
                sourceIndex,
            );

            continue;
        }
        // 把这个字符加入规范化的text
        text += current;
        // 计算右边界
        sourceIndex += 1;
        // 保存右边界
        sourceOffsets.push(
            sourceIndex,
        );
    }

    return {
        text,

        sourceOffsets,
    };
}

/**
 * 规范化新行，不用保存offsets，
 * @param value
 */
function normalizeNewlines(
    value: string,
): string {
    return value.replace(
        /\r\n|\r/gu,
        "\n",
    );
}

/**
 * 先规范同一格式再转化
 * @param value
 * @param lineEnding
 */
function convertLineEndings(
    value: string,
    lineEnding:
        "\n" | "\r\n" | "\r",
): string {
    return normalizeNewlines(
        value,
    ).replace(
        /\n/gu,
        lineEnding,
    );
}

/**
 * 检测换行风格
 * @param source
 */
function detectPreferredLineEnding(
    source: string,
): "\n" | "\r\n" | "\r" {
    let crlf = 0;
    let lf = 0;
    let cr = 0;

    for (
        let index = 0;
        index < source.length;
        index += 1
    ) {
        const current =
            source[index];

        if (
            current === "\r"
        ) {
            if (
                source[
                index + 1
                    ] === "\n"
            ) {
                crlf += 1;
                index += 1;
            } else {
                cr += 1;
            }

            continue;
        }

        if (
            current === "\n"
        ) {
            lf += 1;
        }
    }

    if (
        crlf >= lf &&
        crlf >= cr &&
        crlf > 0
    ) {
        return "\r\n";
    }

    if (
        cr > lf &&
        cr > 0
    ) {
        return "\r";
    }

    return "\n";
}