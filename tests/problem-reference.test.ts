import assert from "node:assert/strict";
import test from "node:test";
import { slugForNumber } from "../src/problem-reference.js";

const unrelated = { id: "142", slug: "other", title: "Other", difficulty: "Easy", paid: false };
test("number lookup never accepts fuzzy matches, stops at exhausted or empty pages", async () => {
    for (const total of [1, 100]) {
        let calls = 0;
        await assert.rejects(slugForNumber("42", async () => {
            calls++;
            return { total, items: calls === 1 ? [unrelated] : [] };
        }), /未找到该题号/);
        assert.equal(calls, total === 1 ? 1 : 2);
    }
});
test("number lookup bounds repeating pages and reports incomplete search", async () => {
    let calls = 0;
    await assert.rejects(slugForNumber("42", async () => {
        calls++; return { total: 999999, items: [unrelated] };
    }), /尚未找到精确匹配/);
    assert.equal(calls, 50);
});
test("number lookup preserves transport failure instead of reporting nonexistent ID", async () => {
    const failure = new Error("connection unavailable");
    await assert.rejects(slugForNumber("42", async () => { throw failure; }), error => error === failure);
});
