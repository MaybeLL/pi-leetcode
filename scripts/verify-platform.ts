/** Public probe by default. Authenticated execution is opt-in and never prints credentials. */
import { homedir } from "node:os";
import { join } from "node:path";
import { createBackend } from "../src/backend-factory.js";
import { AuthStore } from "../src/auth.js";
import { Executions } from "../src/execution.js";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";

const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !["--authenticated", "--submit", "--matrix"].includes(flag))) throw new Error("Supported options: --authenticated [--submit] [--matrix]");
if (flags.has("--submit") && !flags.has("--authenticated")) throw new Error("--submit requires --authenticated");
if (flags.has("--matrix") && !flags.has("--authenticated")) throw new Error("--matrix requires --authenticated");
const home = process.env.PI_LEETCODE_HOME || join(homedir(), ".pi", "leetcode");
try {
    const api = createBackend(flags.has("--authenticated") ? await new AuthStore(home).read() : undefined);
    console.log(JSON.stringify({ check: "backend", id: api.id }));
    const refs = ["1", "reverse-linked-list", "maximum-depth-of-binary-tree", "min-stack"];
    for (const reference of refs) {
        const problem = await api.problem(reference);
        if (reference === "1") assert.equal(problem.slug, "two-sum");
        assert.ok(problem.inputs?.length && problem.template && problem.statement);
        console.log(JSON.stringify({ check: "public-problem", id: problem.id, slug: problem.slug, examples: problem.inputs?.length, goTemplate: Boolean(problem.template), statement: Boolean(problem.statement) }));
    }
    const page = await api.search("42");
    if (!page.items.some(item => item.id === "42")) throw new Error("题号搜索未返回 42。");
    console.log(JSON.stringify({ check: "public-search", matched42: true }));
    if (flags.has("--authenticated")) {
        const account = await api.account();
        console.log(JSON.stringify({ check: "authentication", connected: true }));
        const executions = new Executions(join(home, "verification"), api, account.slug);
        const problem = await api.problem("two-sum");
        const code = `func twoSum(nums []int, target int) []int {
    seen := make(map[int]int)
    for i, n := range nums {
        if j, ok := seen[target-n]; ok { return []int{j, i} }
        seen[n] = i
    }
    return nil
}\n`;
        const probes: { name: string; kind: "run" | "submit"; code: string; verdict: string }[] = [
            { name: "samples", kind: "run", code, verdict: "样例通过" },
            ...(flags.has("--matrix") ? [
                { name: "wrong-answer", kind: "run" as const, code: "func twoSum(nums []int, target int) []int { return []int{0,0} }", verdict: "样例未通过" },
                { name: "compile-error", kind: "run" as const, code: "func twoSum(nums []int, target int) []int { return undefinedVariable }", verdict: "Compile Error" },
                { name: "runtime-error", kind: "run" as const, code: 'func twoSum(nums []int, target int) []int { panic("verification panic") }', verdict: "Runtime Error" },
            ] : []),
            ...(flags.has("--submit") ? [{ name: "accepted", kind: "submit" as const, code, verdict: "Accepted" }] : []),
        ];
        for (const [index, probe] of probes.entries()) {
            // Live CN judging throttles rapid consecutive sends. Never retry a rejected/unknown send here.
            if (index) await delay(20000);
            const record = await executions.start(probe.kind, problem, probe.code, probe.kind === "run" ? problem.inputs!.join("\n") : "");
            console.log(JSON.stringify({ check: probe.name, phase: "sent", recordId: record.id, state: record.state, jobId: record.jobId }));
            // Exercise a new service loading the persisted job, never sending it again.
            const restored = new Executions(join(home, "verification"), api, account.slug);
            const result = await restored.poll(await restored.load(record.id));
            console.log(JSON.stringify({ check: probe.name, recordId: result.id, state: result.state, verdict: result.result?.verdict, message: result.message,
                output: result.result?.output, expected: result.result?.expected, diagnostic: result.result?.diagnostic }));
            assert.equal(result.state, "complete");
            assert.equal(result.result?.verdict, probe.verdict);
            if (probe.name.endsWith("error")) assert.ok(result.result?.diagnostic);
            if (probe.name === "samples" || probe.name === "wrong-answer") {
                assert.ok(result.result?.output); assert.ok(result.result?.expected);
            }
        }
    }
} catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
