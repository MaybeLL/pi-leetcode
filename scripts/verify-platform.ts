/** Public probe by default. Authenticated execution is opt-in and never prints credentials. */
import { homedir } from "node:os";
import { join } from "node:path";
import { createBackend } from "../src/backend-factory.js";
import { AuthStore } from "../src/auth.js";
import { Executions } from "../src/execution.js";

const flags = new Set(process.argv.slice(2));
if ([...flags].some(flag => !["--authenticated", "--submit"].includes(flag))) throw new Error("Supported options: --authenticated [--submit]");
if (flags.has("--submit") && !flags.has("--authenticated")) throw new Error("--submit requires --authenticated");
const home = process.env.PI_LEETCODE_HOME || join(homedir(), ".pi", "leetcode");
try {
    const api = createBackend(flags.has("--authenticated") ? await new AuthStore(home).read() : undefined);
    console.log(JSON.stringify({ check: "backend", id: api.id }));
    const refs = ["two-sum", "reverse-linked-list", "maximum-depth-of-binary-tree", "min-stack"];
    for (const reference of refs) {
        const problem = await api.problem(reference);
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
        for (const kind of flags.has("--submit") ? ["run", "submit"] as const : ["run"] as const) {
            const record = await executions.start(kind, problem, code, kind === "run" ? problem.inputs!.join("\n") : "");
            const result = await executions.poll(record);
            console.log(JSON.stringify({ check: kind, recordId: result.id, state: result.state, verdict: result.result?.verdict, message: result.message }));
            if (result.state !== "complete" || result.result?.verdict !== (kind === "run" ? "样例通过" : "Accepted")) {
                process.exitCode = 1; break;
            }
        }
    }
} catch (error) {
    console.error((error as Error).message);
    process.exitCode = 1;
}
