import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Workspace, codeHash } from "../src/workspace.js";
async function fixture(t: {
    after: (callback: () => Promise<void>) => void;
}) {
    const root = await mkdtemp(join(tmpdir(), "pi-leetcode-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new Workspace(join(root, "app"));
    return { root, store };
}
test("loading is read-only; first use creates default data and respects existing settings", async (t) => {
    const { root, store } = await fixture(t);
    assert.equal(await store.settings(), undefined);
    await assert.rejects(stat(store.home), { code: "ENOENT" });
    const settings = await store.initialize("independent");
    assert.equal(settings.workspace, join(root, "app", "workspace"));
    assert.deepEqual(await store.initialize("coached", join(root, "other")), settings);
    assert.equal((await store.settings())?.guidance, "independent");
});
test("custom directory, edited code, notes, reading position and guidance survive reopening", async (t) => {
    const { root, store } = await fixture(t);
    await store.initialize("light", join(root, "custom"));
    const practice = await store.open();
    const baseline = { code: practice.code, notes: practice.notes };
    practice.code += "// 用户的实现\n";
    practice.notes += "不能重复使用同一个位置。\n";
    practice.view = { view: "code", problemOffset: 5, resultOffset: 0, cursor: { line: 2, col: 4 } };
    await store.save(practice, baseline);
    await store.setGuidance("coached");
    const reopened = new Workspace(store.home);
    assert.deepEqual(await reopened.open(), practice);
    assert.equal((await reopened.settings())?.guidance, "coached");
    assert.equal(await reopened.problemDirectory(), join(root, "custom", "problems", "0001-two-sum"));
});
test("saving a stale buffer preserves changes made in another editor", async (t) => {
    const { store } = await fixture(t);
    await store.initialize();
    const practice = await store.open();
    const baseline = { code: practice.code, notes: practice.notes };
    const path = join(await store.problemDirectory(), "solution.go");
    await writeFile(path, "// external editor\n");
    practice.code = "// stale draft\n";
    await assert.rejects(store.save(practice, baseline), /其他编辑器/);
    assert.equal(await readFile(path, "utf8"), "// external editor\n");
    assert.equal((await store.read()).notes, baseline.notes);
});
test("parallel stale writes serialize and do not silently lose a newer solution", async (t) => {
    const { store } = await fixture(t);
    await store.initialize();
    const original = await store.open();
    const baseline = { code: original.code, notes: original.notes };
    const outcomes = await Promise.allSettled([
        store.save({ ...original, code: "// first\n" }, baseline),
        store.save({ ...original, code: "// second\n" }, baseline),
    ]);
    assert.equal(outcomes[0]?.status, "fulfilled");
    assert.equal(outcomes[1]?.status, "rejected");
    assert.equal((await store.read()).code, "// first\n");
});
test("fixture preview retains a snapshot and clearly carries no real verdict", async (t) => {
    const { store } = await fixture(t);
    const settings = await store.initialize();
    const practice = await store.open();
    const result = await store.previewResult(practice);
    assert.equal(result.source, "fixture");
    assert.match(result.message, /没有执行/);
    assert.equal(result.codeHash, codeHash(practice.code));
    const files = await readdir(join(settings.workspace, "records"));
    assert.equal(files.length, 1);
    const record = JSON.parse(await readFile(join(settings.workspace, "records", files[0]!), "utf8"));
    assert.equal(record.code, practice.code);
    assert.equal(record.result.source, "fixture");
    assert.equal(record.result.verdict, undefined);
});
test("invalid settings fail without resetting existing data", async (t) => {
    const { store } = await fixture(t);
    await store.initialize();
    await store.open();
    const settingsPath = join(store.home, "settings.json");
    const invalid = '{"version":99}';
    await writeFile(settingsPath, invalid);
    await assert.rejects(store.initialize(), /格式无效/);
    assert.equal(await readFile(settingsPath, "utf8"), invalid);
});
test("real problem storage is separate from demo and preserves edits when refreshed", async t => {
    const { store } = await fixture(t);
    await store.initialize();
    const demo = await store.open(); demo.code = "// demo progress";
    await store.save(demo, { code: (await store.read()).code, notes: demo.notes });
    const realProblem = { source: "leetcode" as const, id: "1", questionId: "1", slug: "two-sum", title: "两数之和", language: "Go", statement: "真实题意", template: "func twoSum() {}", inputs: ["[1]\n2"] };
    const real = new Workspace(store.home, realProblem);
    const practice = await real.open();
    assert.equal(practice.code, realProblem.template);
    const baseline = { code: practice.code, notes: practice.notes };
    practice.code = "// real progress";
    await real.save(practice, baseline); await real.remember();
    assert.equal((await (await store.resume()).open()).code, "// real progress");
    assert.equal((await store.open()).code, "// demo progress");
    assert.deepEqual(await real.inputs(), ["[1]\n2"]);
    await assert.rejects(real.previewResult(practice), /真实题目/);
    await assert.rejects(real.saveInputs([]), /非空/);
});
test("starting another practice preserves old code and can restore either attempt", async t => {
    const { store } = await fixture(t);
    await store.initialize();
    const initial = await store.open();
    const baseline = { code: initial.code, notes: initial.notes };
    initial.code = "// previous attempt"; await store.save(initial, baseline);
    const next = await store.restart();
    assert.notEqual(next.attempt, store.attempt);
    assert.notEqual((await next.read()).code, "// previous attempt");
    assert.equal((await store.read()).code, "// previous attempt");
    assert.equal((await store.resume()).attempt, next.attempt);
    assert.equal((await store.recent()).length, 2);
});

test("copying a practice library preserves old files and refuses nonempty or nested destinations", async t => {
    const { store } = await fixture(t); const settings = await store.initialize();
    const p = await store.open(); const baseline = { code: p.code, notes: p.notes };
    p.code = "// my solution"; p.notes = "my notes"; await store.save(p, baseline);
    await assert.rejects(store.copyToDirectory(join(settings.workspace, "nested")), /以外/);
    const destination = join(store.home, "custom-library");
    await store.copyToDirectory(destination);
    assert.equal((await store.settings())?.workspace, destination);
    assert.equal((await store.read()).code, "// my solution");
    assert.equal(await readFile(join(settings.workspace, "problems", "0001-two-sum", "solution.go"), "utf8"), "// my solution");
    await assert.rejects(store.copyToDirectory(settings.workspace), { code: "EEXIST" });
    assert.equal((await store.settings())?.workspace, destination);
});
