import assert from "node:assert/strict";
import test from "node:test";
import { LeetCodeClient, ClientError } from "../vendor/leetcode-client/client.js";
import { SdkBackend } from "../src/sdk-backend.js";
import { createBackend } from "../src/backend-factory.js";
import { DIRECT_BACKEND_ID, SDK_BACKEND_ID } from "../src/backend.js";

const detail = {
    questionId: "101", questionFrontendId: "42", title: "题面\x1b[31m", titleSlug: "fixture", difficulty: "Hard" as const,
    isPaidOnly: false, acRate: 50, topicTags: [], status: null,
    content: "<p>题意</p><script>hidden</script>",
    codeSnippets: [{ lang: "Go", langSlug: "golang", code: "// 用户模板" }],
    sampleTestCase: "[3,3]\n6", exampleTestcases: "[3,3]\n6",
    exampleTestcaseList: ["[3,3]\n6", '["MinStack","push"]\n[[],[1]]'],
    metaData: "{}", hints: [], companyTags: null, stats: "{}",
};
const credentials = { session: "fixture-session", csrf: "fixture-csrf" };
const problem = { source: "leetcode" as const, id: "42", questionId: "101", slug: "fixture", title: "题目", language: "Go", statement: "", template: "" };

test("SDK adapter preserves problem identity, inputs and account slug, while excluding hints and tags", async t => {
    const sdk = new LeetCodeClient("leetcode.cn");
    t.mock.method(sdk, "checkAuth", async () => ({ isSignedIn: true, username: "display-name", userSlug: "stable-account" }));
    t.mock.method(sdk, "getProblems", async (filters: any) => {
        assert.equal(filters.searchKeywords, "42"); assert.equal(filters.limit, 20);
        return { total: 1, problems: [{ ...detail, hints: ["solution spoiler"] }] };
    });
    t.mock.method(sdk, "getProblem", async (slug: string) => { assert.equal(slug, "fixture"); return detail; });
    const backend = new SdkBackend(credentials, sdk);
    assert.deepEqual(await backend.account(), { username: "display-name", slug: "stable-account" });
    const result = await backend.problem("42");
    assert.equal(result.questionId, "101"); assert.deepEqual(result.inputs, detail.exampleTestcaseList);
    assert.equal(result.template, "// 用户模板\n"); assert.equal(result.metadata, "{}");
    assert.doesNotMatch(result.statement, /hidden|\x1b|solution spoiler/);
    const page = await backend.search("42");
    assert.deepEqual(Object.keys(page.items[0]!).sort(), ["difficulty", "id", "paid", "slug", "title"]);
});
test("SDK adapter sends exact code, input and signal then separately decodes results", async t => {
    const sdk = new LeetCodeClient("leetcode.cn");
    const signal = new AbortController().signal;
    t.mock.method(sdk, "startRun", async (request: any, options: any) => {
        assert.deepEqual(request, { titleSlug: "fixture", questionId: "101", lang: "golang", code: "exact\n", testcases: "[3,3]\n6" });
        assert.equal(options.signal, signal);
        return { id: "run_1", kind: "run" };
    });
    t.mock.method(sdk, "checkJob", async (job: any) => {
        assert.deepEqual(job, { id: "run_1", kind: "run" });
        return { state: "complete", result: { state: "FAILURE", status_code: 20, compile_error: "compile failed" } };
    });
    const backend = new SdkBackend(credentials, sdk);
    assert.equal(await backend.start("run", problem, "exact\n", "[3,3]\n6", signal), "run_1");
    const result = await backend.check("run_1", "run");
    assert.equal(result?.verdict, "Compile Error"); assert.equal(result?.diagnostic, "compile failed");
    assert.equal(result?.runtime, undefined);
});
test("adapter preserves ambiguous sends and never leaks raw SDK errors", async t => {
    const sdk = new LeetCodeClient("leetcode.cn");
    const send = t.mock.method(sdk, "startSubmit", async () => { throw new ClientError("network", "secret fixture-session", true); });
    const backend = new SdkBackend(credentials, sdk);
    await assert.rejects(backend.start("submit", problem, "source", ""), (error: any) => {
        assert.equal(error.outcomeUnknown, true); assert.doesNotMatch(error.message, /fixture-session|secret/); return true;
    });
    assert.equal(send.mock.callCount(), 1);
    t.mock.method(sdk, "checkAuth", async () => { throw new Error("secret fixture-session"); });
    await assert.rejects(backend.account(), (error: Error) => { assert.doesNotMatch(error.message, /fixture-session|secret/); return true; });
    await assert.rejects(new SdkBackend(undefined, sdk).start("submit", problem, "source", ""), /login/);
    assert.equal(send.mock.callCount(), 1);
});
test("SDK adapter refuses unavailable templates, examples and foreign links", async t => {
    const sdk = new LeetCodeClient("leetcode.cn");
    const backend = new SdkBackend(undefined, sdk);
    await assert.rejects(backend.problem("https://example.org/problems/fixture"), /leetcode.cn/);
    t.mock.method(sdk, "getProblem", async () => ({ ...detail, exampleTestcaseList: undefined }));
    await assert.rejects(backend.problem("fixture"), /示例输入/);
    t.mock.method(sdk, "getProblem", async () => ({ ...detail, codeSnippets: [] }));
    await assert.rejects(backend.problem("fixture"), /Go 模板/);
});
test("stored backend identity overrides environment default and unknown backends fail closed", t => {
    const previous = process.env.PI_LEETCODE_BACKEND;
    t.after(() => { if (previous === undefined) delete process.env.PI_LEETCODE_BACKEND; else process.env.PI_LEETCODE_BACKEND = previous; });
    delete process.env.PI_LEETCODE_BACKEND;
    assert.equal(createBackend().id, SDK_BACKEND_ID);
    assert.equal(createBackend(undefined, DIRECT_BACKEND_ID).id, DIRECT_BACKEND_ID);
    process.env.PI_LEETCODE_BACKEND = "sdk";
    assert.equal(createBackend().id, SDK_BACKEND_ID);
    assert.equal(createBackend(undefined, DIRECT_BACKEND_ID).id, DIRECT_BACKEND_ID);
    process.env.PI_LEETCODE_BACKEND = "direct";
    assert.equal(createBackend(undefined, SDK_BACKEND_ID).id, SDK_BACKEND_ID);
    assert.throws(() => createBackend(undefined, "unsupported"), /未知/);
});

test("number lookup finds exact IDs beyond the first fuzzy-search page in both backends", async t => {
    const { LeetCodeCN } = await import("../src/platform.js");
    const sdk = new LeetCodeClient("leetcode.cn");
    t.mock.method(sdk, "getProblem", async () => detail);
    const direct = new LeetCodeCN(undefined, (async () => new Response(JSON.stringify({ data: { question: detail } }))) as typeof fetch);
    for (const backend of [new SdkBackend(undefined, sdk), direct]) {
        const offsets: number[] = [];
        t.mock.method(backend, "search", async (keyword: string, difficulty = "", skip = 0) => {
            assert.equal(keyword, "42"); assert.equal(difficulty, "");
            offsets.push(skip);
            const item = { id: "142", slug: "wrong", title: "other", difficulty: "Easy", paid: false };
            return { total: 4456, items: skip === 40 ? [{ ...item, id: "42", slug: "fixture" }] : Array(20).fill(item) };
        });
        assert.equal((await backend.problem("42")).slug, "fixture");
        assert.deepEqual(offsets, [0, 20, 40]);
    }
});
