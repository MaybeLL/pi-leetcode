import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LearningStore } from "../src/learning.js";
import { helpContext } from "../src/coaching.js";
import { defaultViewState } from "../src/problem.js";

test("learning records deduplicate delivered events, retry failures and keep user-labelled help separate", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "leet-learning-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new LearningStore(root);
    const first = (await store.begin("带练", "请思考输入输出", "opening"))!;
    assert.equal(await new LearningStore(root).begin("带练", "不要重复", "opening"), undefined);
    await store.finish(first, "", false);
    const retry = (await store.begin("带练", "重试开场", "opening"))!;
    assert.ok(retry);
    await store.finish(retry, "你能给出一个具体例子吗？", false);
    assert.equal(await store.begin("带练", "不要重复", "opening"), undefined);
    const full = (await store.begin("完整讲解", "讲解思路"))!;
    await store.finish(full, "先澄清题意", false);
    assert.equal((await store.read()).exchanges.at(-1)?.received, "未标注");
    await store.annotate(full, "仅澄清题意");
    await store.reflect("我需要复习边界情况", "");
    await assert.rejects(store.reflect("覆盖旧记录", ""), /未覆盖/);
    const restored = await new LearningStore(root).read();
    assert.equal(restored.reflection, "我需要复习边界情况");
    assert.equal(restored.exchanges.at(-1)?.received, "仅澄清题意");
});
test("problem-only help excludes solution, verdict snapshot and notes", () => {
    const context = helpContext(
        { code: "SOLUTION_SECRET", notes: "NOTES_SECRET", view: defaultViewState() },
        "/practice",
        { source: "leetcode", id: "1", slug: "two-sum", title: "两数之和", language: "Go", statement: "statement", template: "" },
        "理解题意",
    );
    assert.match(context, /statement/);
    assert.doesNotMatch(context, /SOLUTION_SECRET|NOTES_SECRET/);
});

test("the previous answer remains in context while a new follow-up is pending", async t => {
    const root = await mkdtemp(join(tmpdir(), "leet-continuity-")); t.after(() => rm(root, { recursive: true, force: true }));
    const store = new LearningStore(root); const id = (await store.begin("带练", "first"))!;
    await store.finish(id, "请估算这个循环的复杂度", false);
    await store.begin("自由提问", "我觉得是平方复杂度");
    const { learningSummary } = await import("../src/learning.js");
    assert.match(learningSummary(await store.read()), /请估算这个循环的复杂度/);
});
