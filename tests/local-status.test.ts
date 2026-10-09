import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { localStatusIndex, isAcceptedSubmission, localStatusLabels } from "../src/local-status.js";
import { Workspace } from "../src/workspace.js";

const problem = {
    source: "leetcode" as const,
    id: "1",
    questionId: "1",
    slug: "two-sum",
    title: "两数之和",
    language: "Go",
    statement: "题意",
    template: "func twoSum() {}\n",
    inputs: ["[3,3]\n6"],
};

async function home(t: { after: (callback: () => Promise<void>) => void }): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "leet-status-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    await new Workspace(root).initialize();
    return root;
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, JSON.stringify(value), { mode: 0o600 });
}

test("status labels stay tied to local records only", () => {
    assert.deepEqual(localStatusLabels, { none: "未练习", started: "已开始", accepted: "曾通过" });
    assert.equal(isAcceptedSubmission({ kind: "submit", state: "complete", result: { verdict: "Accepted" } }), true);
    assert.equal(isAcceptedSubmission({ kind: "run", state: "complete", result: { verdict: "Accepted" } }), false, "sample runs never count");
    assert.equal(isAcceptedSubmission({ kind: "submit", state: "failed", result: { verdict: "Accepted" } }), false);
    assert.equal(isAcceptedSubmission(undefined), false);
});

test("opening a problem marks it started, and a formal Accepted marks it passed", async (t) => {
    const root = await home(t);
    const target = new Workspace(root, problem);
    assert.equal((await localStatusIndex(root)).get("two-sum"), "none");
    await target.open();
    assert.equal((await localStatusIndex(root)).get("two-sum"), "started", "opening alone is only 已开始");
    const directory = await target.problemDirectory();
    await writeJson(join(directory, "execution.json"), { kind: "run", state: "complete", result: { verdict: "样例通过" } });
    assert.equal((await localStatusIndex(root)).get("two-sum"), "started", "sample success is not a pass");
    await writeJson(join(directory, "execution.json"), { kind: "submit", state: "complete", result: { verdict: "Accepted" } });
    assert.equal((await localStatusIndex(root)).get("two-sum"), "accepted");
});

test("a later re-practice does not erase a previous pass, and global records are honoured", async (t) => {
    const root = await home(t);
    const target = new Workspace(root, problem);
    await target.open();
    const settings = (await target.settings())!;
    await mkdir(join(settings.workspace, "records", "executions"), { recursive: true });
    await writeJson(join(settings.workspace, "records", "executions", "00000000-0000-0000-0000-000000000001.json"),
        { slug: "two-sum", kind: "submit", state: "complete", result: { verdict: "Accepted" } });
    const attempt = await target.restart();
    assert.equal((await localStatusIndex(root)).get("two-sum"), "accepted", "a fresh blank attempt keeps 曾通过");
    await writeJson(join(await attempt.problemDirectory(), "execution.json"), { kind: "submit", state: "complete", result: { verdict: "Wrong Answer" } });
    assert.equal((await localStatusIndex(root)).get("two-sum"), "accepted");
});

test("a problem evicted from the recent-50 index still reports its real status", async (t) => {
    const root = await home(t);
    const target = new Workspace(root, problem);
    await target.open();
    const attempt = await target.restart();
    await writeJson(join(await attempt.problemDirectory(), "execution.json"), { kind: "submit", state: "complete", result: { verdict: "Accepted" } });
    // Simulate an index that no longer mentions this problem while files remain.
    await writeJson(join(root, "recent.json"), []);
    assert.equal((await localStatusIndex(root)).get("two-sum"), "accepted");
    assert.equal(await attempt.latestPractice(), attempt.attempt, "newest attempt is still discoverable without the index");
});
