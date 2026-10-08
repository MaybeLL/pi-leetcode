import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Executions } from "../src/execution.js";
import { LeetCodeCN } from "../src/platform.js";
import { DIRECT_BACKEND_ID, type JudgeBackend } from "../src/backend.js";
const problem = { source: "leetcode" as const, id: "42", questionId: "101", slug: "test", title: "Test", language: "Go", statement: "", template: "" };
async function setup(t: any, transport: typeof fetch) {
    const root = await mkdtemp(join(tmpdir(), "leet-judge-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    return { root, store: new Executions(root, new LeetCodeCN({ session: "test", csrf: "test" }, transport), "account-a") };
}
test("job ID and exact snapshot persist before polling and can resume in a new service", async t => {
    const requests: any[] = [];
    const transport = (async (url: any, init: any) => {
        requests.push({ url, body: init.body && JSON.parse(init.body) });
        return new Response(JSON.stringify(init.method === "POST" ? { submission_id: 123 } : { state: "SUCCESS", status_code: 11, code_output: "wrong" }));
    }) as typeof fetch;
    const { root, store } = await setup(t, transport);
    const original = await store.start("submit", problem, "exact source\n", "");
    assert.equal(original.state, "pending"); assert.equal(original.jobId, "123");
    const resumed = new Executions(root, new LeetCodeCN({ session: "test", csrf: "test" }, transport), "account-a");
    const result = await resumed.poll(await resumed.load(original.id), undefined, 100, 1);
    assert.equal(result.result?.verdict, "Wrong Answer");
    assert.equal(requests.filter(item => item.body).length, 1);
    assert.equal(requests[0].body.typed_code, "exact source\n");
    assert.equal(requests[0].body.question_id, "101");
    await assert.rejects(new Executions(root, new LeetCodeCN(), "account-b").load(original.id), /其他账户/);
});
test("ambiguous POST remains unknown and never retries even when polled", async t => {
    let sends = 0;
    const { store } = await setup(t, (async () => { sends++; throw new Error("network"); }) as typeof fetch);
    const record = await store.start("submit", problem, "source", "");
    assert.equal(record.state, "unknown");
    assert.equal((await store.poll(record)).state, "unknown");
    assert.equal(sends, 1);
});
test("deadline and cancelled polling preserve pending job; neither is a TLE verdict", async t => {
    const { store } = await setup(t, (async (_url: any, init: any) => new Response(JSON.stringify(init.method === "POST" ? { interpret_id: "runcode_1" } : { state: "PENDING" }))) as typeof fetch);
    const record = await store.start("run", problem, "source", "[1]\n2");
    const result = await store.poll(record, undefined, 5, 1);
    assert.equal(result.state, "pending"); assert.equal(result.result, undefined); assert.equal(result.jobId, "runcode_1");
    const abort = new AbortController(); abort.abort();
    assert.equal((await store.poll(record, abort.signal)).state, "pending");
});
test("concurrent sends are excluded across service instances", async t => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const { root, store } = await setup(t, (async () => { entered(); await gate; return new Response('{"submission_id":1}'); }) as typeof fetch);
    const first = store.start("submit", problem, "source", "");
    await started;
    await assert.rejects(new Executions(root, new LeetCodeCN(), "account-a").start("submit", problem, "source", ""), /另一个/);
    release(); await first;
    assert.equal((await readdir(root)).includes("judge.lock"), false);
});
test("a replaceable backend resumes persisted jobs without resending and rejects cross-backend lookup", async t => {
    const root = await mkdtemp(join(tmpdir(), "leet-backend-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    let sends = 0, checks = 0;
    const backend: JudgeBackend = {
        id: "fixture-backend-v1",
        async start(kind, actualProblem, code, input) {
            sends++;
            assert.equal(kind, "run"); assert.equal(actualProblem.questionId, "101");
            assert.equal(code, "source"); assert.equal(input, "[3,3]\n6");
            return "opaque-job-id";
        },
        async check(id, kind) {
            checks++;
            assert.equal(id, "opaque-job-id"); assert.equal(kind, "run");
            return { verdict: "Completed", output: "[0,1]" };
        },
    };
    const store = new Executions(root, backend, "account-a");
    const record = await store.start("run", problem, "source", "[3,3]\n6");
    assert.equal(checks, 0);
    const saved = JSON.parse(await readFile(join(root, "executions", `${record.id}.json`), "utf8"));
    assert.equal(saved.backend, backend.id); assert.equal(saved.jobId, "opaque-job-id");
    const other = new Executions(root, { ...backend, id: "another-backend" }, "account-a");
    await assert.rejects(other.load(record.id), /其他平台后端/);
    await assert.rejects(other.poll(record), /其他平台后端/);
    assert.equal(checks, 0);
    const resumed = new Executions(root, backend, "account-a");
    assert.equal((await resumed.poll(await resumed.load(record.id))).result?.output, "[0,1]");
    assert.equal(sends, 1); assert.equal(checks, 1);
});
test("legacy records without a backend ID remain owned by the direct adapter", async t => {
    const { root, store } = await setup(t, (async () => new Response('{"submission_id":123}')) as typeof fetch);
    const record = await store.start("submit", problem, "source", "");
    assert.equal(record.backend, DIRECT_BACKEND_ID);
    delete record.backend;
    await writeFile(join(root, "executions", `${record.id}.json`), JSON.stringify(record));
    assert.equal(await Executions.backendId(root, record.id), DIRECT_BACKEND_ID);
    assert.equal((await store.load(record.id)).jobId, "123");
    const other: JudgeBackend = { id: "another-backend", async start() { throw new Error("must not send"); }, async check() { throw new Error("must not query"); } };
    await assert.rejects(new Executions(root, other, "account-a").load(record.id), /其他平台后端/);
});
test("poll deadline cancels an in-flight check and retains the original job", async t => {
    const root = await mkdtemp(join(tmpdir(), "leet-deadline-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    let sends = 0;
    const backend: JudgeBackend = {
        id: "deadline-fixture",
        async start() { sends++; return "original-job"; },
        async check(_id, _kind, signal) {
            return new Promise((_resolve, reject) => {
                const fallback = setTimeout(() => reject(new Error("deadline not propagated")), 1000);
                signal!.addEventListener("abort", () => { clearTimeout(fallback); reject(new Error("cancelled")); }, { once: true });
            });
        },
    };
    const store = new Executions(root, backend, "account");
    const result = await store.poll(await store.start("run", problem, "source", "input"), undefined, 10);
    assert.match(result.message, /停止等待/);
    assert.equal(result.state, "pending"); assert.equal(result.jobId, "original-job");
    assert.equal(sends, 1);
});
