import assert from "node:assert/strict";
import test from "node:test";
import { LeetCodeCN, PlatformError, decodeJudge, parseCredentials, statementMarkdown } from "../src/platform.js";

const question = {
    questionId: "101", questionFrontendId: "42", title: "Test", translatedTitle: "测试题", titleSlug: "test-problem",
    translatedContent: "<p>约束 10<sup>4</sup></p>", difficulty: "Hard",
    codeSnippets: [{ langSlug: "golang", code: "func solve() int { return 0 }" }],
    exampleTestcaseList: ["[1,2]\n3"], metaData: "{}",
};
const respond = (value: unknown) => new Response(JSON.stringify(value));
test("question and number lookup preserve platform IDs, Go template and sample framing", async () => {
    const requests: any[] = [];
    const api = new LeetCodeCN(undefined, (async (_url, init) => {
        const body = JSON.parse(init!.body as string); requests.push(body);
        return requests.length === 1 ? respond({ data: { problemsetQuestionList: { total: 1, questions: [{ frontendQuestionId: "42", title: "Test", titleCn: "测试题", titleSlug: "test-problem", difficulty: "HARD", paidOnly: false }] } } }) : respond({ data: { question } });
    }) as typeof fetch);
    const problem = await api.problem("42");
    assert.equal(problem.id, "42"); assert.equal(problem.questionId, "101");
    assert.equal(problem.template, question.codeSnippets[0]!.code + "\n");
    assert.deepEqual(problem.inputs, ["[1,2]\n3"]);
    assert.equal(requests[1].variables.titleSlug, "test-problem");
    assert.match(problem.statement, /10\^\(4\)/);
});
test("bad GraphQL and absent templates never become usable empty results", async () => {
    const broken = new LeetCodeCN(undefined, (async () => respond({ errors: [{ message: "do not expose raw upstream response" }] })) as typeof fetch);
    await assert.rejects(broken.search(), /接口返回错误/);
    const noGo = new LeetCodeCN(undefined, (async () => respond({ data: { question: { ...question, codeSnippets: [] } } })) as typeof fetch);
    await assert.rejects(noGo.problem("test-problem"), /没有 Go/);
    await assert.rejects(noGo.problem("https://leetcode.com/problems/two-sum"), /仅支持/);
});
test("request failure is sanitized, mutation is not retried, and ambiguous send is marked unknown", async () => {
    let calls = 0;
    const api = new LeetCodeCN({ session: "SECRET", csrf: "CSRF" }, (async () => { calls++; throw new Error("SECRET reflected network failure"); }) as typeof fetch);
    const problem = { source: "leetcode" as const, id: "1", questionId: "1", slug: "two-sum", title: "test", language: "Go", statement: "", template: "" };
    await assert.rejects(api.start("submit", problem, "code", ""), (error: unknown) => {
        assert.ok(error instanceof PlatformError); assert.equal(error.outcomeUnknown, true); assert.doesNotMatch(error.message, /SECRET/); return true;
    });
    assert.equal(calls, 1);
});
test("forbidden and throttled responses remain distinct from expired authentication", async () => {
    for (const [status, kind] of [[401, "auth"], [403, "forbidden"], [429, "throttled"]] as const) {
        const api = new LeetCodeCN(undefined, (async () => new Response("sensitive body", { status })) as typeof fetch);
        await assert.rejects(api.search(), (error: unknown) => error instanceof PlatformError && error.kind === kind && !error.message.includes("sensitive"));
    }
});
test("only formal judging may yield Accepted; missing reference output stays absent", () => {
    assert.equal(decodeJudge({ state: "STARTED" }, "run"), undefined);
    assert.equal(decodeJudge({ state: "SUCCESS", status_code: 10 }, "run")?.verdict, "运行完成");
    assert.equal(decodeJudge({ state: "SUCCESS", status_code: 10, correct_answer: true }, "run")?.verdict, "样例通过");
    assert.equal(decodeJudge({ state: "SUCCESS", status_code: 10 }, "submit")?.verdict, "Accepted");
    assert.equal(decodeJudge({ state: "SUCCESS", status_code: 10 }, "run")?.expected, undefined);
    const wa = decodeJudge({ state: "SUCCESS", status_code: 11, code_output: "[0,0]", std_output: "debug", last_testcase: "[3,3]\n6", expected_output: "[0,1]" }, "submit")!;
    assert.equal(wa.output, "[0,0]"); assert.equal(wa.stdout, "debug"); assert.equal(wa.failingInput, "[3,3]\n6");
    assert.throws(() => decodeJudge({ state: "SUCCESS", status_code: 999 }, "submit"), /未知/);
});
test("HTML rendering preserves important math and strips executable links and controls", () => {
    const value = statementMarkdown('<script>BAD</script><p>10<sup>4</sup> &lt; n</p><a href="javascript:alert(1)">link</a><img src="/image.png" alt="示例图"><pre>x\ny</pre>\x1b[31m');
    assert.match(value, /10\^\(4\)/); assert.match(value, /示例图/); assert.match(value, /https:\/\/leetcode.cn\/image.png/);
    assert.doesNotMatch(value, /BAD|javascript:|\x1b/);
    assert.match(statementMarkdown("<pre><strong>输入：</strong>[0,1,2]\n输出：3</pre>"), /```text\n输入：\[0,1,2\]/);
    assert.match(statementMarkdown("<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>"), /\| 1 \| 2 \|/);
});
test("credential parsing rejects header injection and never reflects secrets in errors", () => {
    assert.deepEqual(parseCredentials("other=x; LEETCODE_SESSION=abc.def; csrftoken=123"), { session: "abc.def", csrf: "123" });
    assert.throws(() => parseCredentials("LEETCODE_SESSION=SECRET\r\nCookie: bad; csrftoken=a"), error => !String(error).includes("SECRET"));
    assert.throws(() => parseCredentials("LEETCODE_SESSION=abc"), /两项/);
});
test("direct adapter preserves dotted run IDs but rejects traversal segments", async () => {
    const id = "runcode_1700000000.123456_demo";
    const requests: string[] = [];
    const api = new LeetCodeCN({ session: "fixture", csrf: "fixture" }, (async (url, init) => {
        requests.push(String(url));
        return respond(init?.method === "POST" ? { interpret_id: id } : { state: "SUCCESS", status_code: 10, correct_answer: true });
    }) as typeof fetch);
    const problem = { source: "leetcode" as const, id: "1", questionId: "1", slug: "two-sum", title: "test", language: "Go", statement: "", template: "" };
    assert.equal(await api.start("run", problem, "code", "[3,3]\n6"), id);
    assert.equal((await api.check(id, "run"))?.verdict, "样例通过");
    assert.equal(requests[1], `https://leetcode.cn/submissions/detail/${id}/check/`);
    for (const invalid of ["..", ".", "a/../b", "a..b", "a?x=1", "a#b"])
        await assert.rejects(api.check(invalid, "run"), /无效任务编号/);
    assert.equal(requests.length, 2);
});
