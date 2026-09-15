import {
    describe,
    expect,
    it,
} from "vitest";

import {
    applyExactTextEdit,
} from "../../../src/core/edit/exact-text-edit.js";


describe(
    "applyExactTextEdit",
    () => {
        it(
            "replaces one unique exact match",
            () => {
                const result =
                    applyExactTextEdit(
                        "foo\nbar\nbaz\n",
                        "bar",
                        "qux",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,
                    content:
                        "foo\nqux\nbaz\n",
                    changed:
                        true,
                });
            },
        );


        it(
            "returns not_found when oldText does not exist",
            () => {
                const result =
                    applyExactTextEdit(
                        "foo\nbar\n",
                        "missing",
                        "replacement",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: false,
                    reason:
                        "not_found",
                });
            },
        );


        it(
            "returns ambiguous when oldText appears multiple times",
            () => {
                const result =
                    applyExactTextEdit(
                        [
                            "foo();",
                            "bar();",
                            "foo();",
                            "",
                        ].join("\n"),

                        "foo();",

                        "baz();",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: false,
                    reason:
                        "ambiguous",
                });
            },
        );


        it(
            "detects overlapping matches as ambiguous",
            () => {
                /*
                 * source:
                 *
                 * aaa
                 *
                 * oldText:
                 *
                 * aa
                 *
                 * 有两个 overlapping match：
                 *
                 * [aa]a
                 * a[aa]
                 *
                 * 所以不能默认选择第一个。
                 */
                const result =
                    applyExactTextEdit(
                        "aaa",
                        "aa",
                        "b",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: false,
                    reason:
                        "ambiguous",
                });
            },
        );


        it(
            "preserves LF line endings",
            () => {
                const result =
                    applyExactTextEdit(
                        "first\nold one\nold two\nlast\n",

                        "old one\nold two",

                        "new one\nnew two",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "first\nnew one\nnew two\nlast\n",

                    changed:
                        true,
                });
            },
        );


        it(
            "matches logical LF text against a CRLF source and preserves CRLF",
            () => {
                /*
                 * 这是非常重要的一条。
                 *
                 * read_file 给模型看的文本可能使用 \n，
                 * 但磁盘文件实际使用 \r\n。
                 */
                const result =
                    applyExactTextEdit(
                        "first\r\nold one\r\nold two\r\nlast\r\n",

                        "old one\nold two",

                        "new one\nnew two",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "first\r\nnew one\r\nnew two\r\nlast\r\n",

                    changed:
                        true,
                });
            },
        );


        it(
            "normalizes replacement CRLF to source LF style",
            () => {
                const result =
                    applyExactTextEdit(
                        "first\nold\nlast\n",

                        "old",

                        "new one\r\nnew two",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "first\nnew one\nnew two\nlast\n",

                    changed:
                        true,
                });
            },
        );


        it(
            "normalizes replacement LF to source CRLF style",
            () => {
                const result =
                    applyExactTextEdit(
                        "first\r\nold\r\nlast\r\n",

                        "old",

                        "new one\nnew two",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "first\r\nnew one\r\nnew two\r\nlast\r\n",

                    changed:
                        true,
                });
            },
        );


        it(
            "matches logical LF text against a CR source and preserves CR",
            () => {
                const result =
                    applyExactTextEdit(
                        "first\rold one\rold two\rlast\r",

                        "old one\nold two",

                        "new one\nnew two",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "first\rnew one\rnew two\rlast\r",

                    changed:
                        true,
                });
            },
        );


        it(
            "normalizes replacement newlines to CR when the source uses CR",
            () => {
                const result =
                    applyExactTextEdit(
                        "first\rold\rlast\r",

                        "old",

                        "new one\r\nnew two",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "first\rnew one\rnew two\rlast\r",

                    changed:
                        true,
                });
            },
        );


        it(
            "can replace the complete contents of an empty file",
            () => {
                /*
                 * empty source + empty oldText
                 *
                 * 只有一个可能的 insertion point，
                 * 所以允许。
                 */
                const result =
                    applyExactTextEdit(
                        "",
                        "",
                        "export const value = 1;\n",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "export const value = 1;\n",

                    changed:
                        true,
                });
            },
        );


        it(
            "rejects empty oldText for a non-empty file as ambiguous",
            () => {
                /*
                 * 非空文件中：
                 *
                 * oldText = ""
                 *
                 * 理论上每个字符 boundary 都可以匹配。
                 *
                 * 因此不能猜应该插在哪里。
                 */
                const result =
                    applyExactTextEdit(
                        "hello",
                        "",
                        "world",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: false,

                    reason:
                        "ambiguous",
                });
            },
        );


        it(
            "returns changed false when oldText and newText are identical",
            () => {
                const result =
                    applyExactTextEdit(
                        "foo\nbar\nbaz\n",

                        "bar",

                        "bar",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "foo\nbar\nbaz\n",

                    changed:
                        false,
                });
            },
        );


        it(
            "supports deleting a unique text region",
            () => {
                const result =
                    applyExactTextEdit(
                        [
                            "before",
                            "delete me",
                            "after",
                            "",
                        ].join("\n"),

                        "delete me\n",

                        "",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "before\nafter\n",

                    changed:
                        true,
                });
            },
        );


        it(
            "only changes the requested region",
            () => {
                const source =
                    [
                        "const untouched = 1;",
                        "",
                        "function target() {",
                        "  return false;",
                        "}",
                        "",
                        "const alsoUntouched = 2;",
                        "",
                    ].join("\n");

                const result =
                    applyExactTextEdit(
                        source,

                        [
                            "function target() {",
                            "  return false;",
                            "}",
                        ].join("\n"),

                        [
                            "function target() {",
                            "  return true;",
                            "}",
                        ].join("\n"),
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        [
                            "const untouched = 1;",
                            "",
                            "function target() {",
                            "  return true;",
                            "}",
                            "",
                            "const alsoUntouched = 2;",
                            "",
                        ].join("\n"),

                    changed:
                        true,
                });
            },
        );


        it(
            "does not treat similar text as an exact match",
            () => {
                const result =
                    applyExactTextEdit(
                        [
                            "function loginUser() {",
                            "  return false;",
                            "}",
                            "",
                        ].join("\n"),

                        [
                            "function login() {",
                            "  return false;",
                            "}",
                        ].join("\n"),

                        [
                            "function login() {",
                            "  return true;",
                            "}",
                        ].join("\n"),
                    );

                expect(
                    result,
                ).toEqual({
                    ok: false,

                    reason:
                        "not_found",
                });
            },
        );


        it(
            "matches oldText containing CRLF against an LF source",
            () => {
                /*
                 * newline normalization 应该是双向的。
                 *
                 * 不只是：
                 *
                 * oldText LF -> source CRLF
                 *
                 * 也应该支持：
                 *
                 * oldText CRLF -> source LF
                 */
                const result =
                    applyExactTextEdit(
                        "first\nold one\nold two\nlast\n",

                        "old one\r\nold two",

                        "new",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "first\nnew\nlast\n",

                    changed:
                        true,
                });
            },
        );


        it(
            "preserves text before and after a multiline replacement",
            () => {
                const result =
                    applyExactTextEdit(
                        "AAA\nBBB\nCCC\nDDD\nEEE\n",

                        "BBB\nCCC\nDDD",

                        "X\nY",
                    );

                expect(
                    result,
                ).toEqual({
                    ok: true,

                    content:
                        "AAA\nX\nY\nEEE\n",

                    changed:
                        true,
                });
            },
        );
    },
);