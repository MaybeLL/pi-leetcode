import assert from "node:assert/strict";
import test from "node:test";
import { editCases } from "../src/cases-ui.js";

test("case editor preserves invalid drafts and saves multiline input without JSON escaping", async () => {
    let saved = ["[2,7]\n9"];
    const selections = ["新增用例", "返回工作台"];
    const drafts: string[] = [];
    const errors: string[] = [];
    const edits = ["", "[3,3]\n6"];
    const workspace: any = {
        problem: { source: "leetcode" },
        async inputs() { return saved; },
        async saveInputs(values: string[]) {
            if (values.some(value => !value.trim())) throw new Error("测试输入不能为空");
            saved = values;
        },
    };
    const ctx: any = { ui: {
        async select() { return selections.shift(); },
        async editor(_title: string, draft: string) { drafts.push(draft); return edits.shift(); },
        notify(message: string) { errors.push(message); },
    } };
    await editCases(ctx, workspace);
    assert.deepEqual(saved, ["[2,7]\n9", "[3,3]\n6"]);
    assert.deepEqual(drafts, ["", ""]);
    assert.equal(errors.length, 1);
});
