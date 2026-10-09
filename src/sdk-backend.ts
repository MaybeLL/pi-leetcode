import { LeetCodeClient, ClientError, clientError } from "../vendor/leetcode-client/client.js";
import { PlatformError, SDK_BACKEND_ID, type Account, type Credentials, type LeetCodeBackend, type Problem, type ProblemSummary, type JudgeResult } from "./backend.js";
import { cleanText, decodeJudge, statementMarkdown } from "./platform.js";
import { slugForNumber } from "./problem-reference.js";

type Client = Pick<LeetCodeClient, "setCredentials" | "checkAuth" | "getProblems" | "getProblem" | "startRun" | "startSubmit" | "checkJob">;

function failure(error: unknown): PlatformError {
    const safe = error instanceof ClientError ? error : clientError(error);
    const kind = safe.kind === "cancelled" ? "network" : safe.kind;
    const messages = {
        auth: "登录已失效，请用 /leet login 重新连接中国站。",
        forbidden: "平台拒绝访问，可能需要在浏览器验证或稍后再试。",
        throttled: "平台请求过于频繁，请稍后重试。",
        network: "连接未完成或等待已取消，可稍后重试查询。",
        protocol: "平台返回格式变化；没有认定代码通过，请在网页检查状态。",
        platform: "平台请求失败，请稍后重试查询。",
    };
    return new PlatformError(kind, safe.outcomeUnknown ? "发送结果未知；不会自动重新发送，请先检查平台记录。" : messages[kind], safe.outcomeUnknown);
}
async function safely<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) { throw failure(error); }
}
function required(value: unknown): string {
    if (typeof value !== "string" || !value.trim()) throw new PlatformError("protocol", "题库缺少必要字段。");
    return cleanText(value);
}

export class SdkBackend implements LeetCodeBackend {
    readonly id = SDK_BACKEND_ID;
    constructor(private credentials?: Credentials, private sdk: Client = new LeetCodeClient("leetcode.cn")) {
        if (credentials) sdk.setCredentials({ session: credentials.session, csrfToken: credentials.csrf });
    }
    async account(): Promise<Account> {
        const account = await safely(() => this.sdk.checkAuth());
        if (!account.isSignedIn) throw new PlatformError("auth", "请先用 /leet login 连接中国站。");
        return { username: required(account.username), slug: required(account.userSlug) };
    }
    async search(keyword = "", difficulty = "", skip = 0): Promise<{ items: ProblemSummary[]; total: number }> {
        if (difficulty && difficulty !== "EASY" && difficulty !== "MEDIUM" && difficulty !== "HARD") throw new Error("无效难度。");
        const level = difficulty === "EASY" ? "EASY" : difficulty === "MEDIUM" ? "MEDIUM" : difficulty === "HARD" ? "HARD" : undefined;
        const page = await safely(() => this.sdk.getProblems({ searchKeywords: keyword, difficulty: level, limit: 20, skip }));
        return { total: page.total, items: page.problems.map(q => ({
            id: required(q.questionFrontendId), slug: required(q.titleSlug), title: required(q.title), difficulty: required(q.difficulty), paid: q.isPaidOnly,
        })) };
    }
    async problem(reference: string): Promise<Problem> {
        let slug = reference.trim();
        if (/^https?:\/\//.test(slug)) {
            const url = new URL(slug);
            if (url.hostname !== "leetcode.cn") throw new Error("当前仅支持 leetcode.cn 题目链接。");
            slug = url.pathname.match(/^\/problems\/([^/]+)/)?.[1] || "";
        }
        if (/^\d+$/.test(slug)) {
            slug = await slugForNumber(slug, this.search.bind(this));
        }
        if (!/^[a-zA-Z0-9-]+$/.test(slug)) throw new Error("请输入题号、英文 slug 或中国站题目链接。");
        const q = await safely(() => this.sdk.getProblem(slug));
        const template = q.codeSnippets?.find(item => item.langSlug === "golang");
        if (!template) throw new Error("此题没有可读取的 Go 模板，暂不支持。");
        if (!Array.isArray(q.exampleTestcaseList) || !q.exampleTestcaseList.length || q.exampleTestcaseList.some(item => typeof item !== "string"))
            throw new PlatformError("protocol", "题目缺少有效的示例输入，未创建练习。");
        const title = required(q.title), id = required(q.questionFrontendId);
        return {
            source: "leetcode", id, questionId: required(q.questionId), slug: required(q.titleSlug), title,
            language: "Go", difficulty: required(q.difficulty),
            statement: `# ${id} · ${title}\n\n${statementMarkdown(required(q.content))}\n\n[在 LeetCode 查看原题](https://leetcode.cn/problems/${slug}/)`,
            template: required(template.code) + "\n", inputs: q.exampleTestcaseList.map(cleanText), metadata: required(q.metaData),
        };
    }
    async start(kind: "run" | "submit", problem: Problem, code: string, input: string, signal?: AbortSignal): Promise<string> {
        if (!this.credentials) throw new PlatformError("auth", "请先用 /leet login 连接中国站。");
        if (problem.source !== "leetcode" || !problem.questionId) throw new Error("只能运行或提交真实平台题目。");
        const request = { titleSlug: problem.slug, questionId: problem.questionId, lang: "golang", code };
        const job = await safely(() => kind === "run" ? this.sdk.startRun({ ...request, testcases: input }, { signal }) : this.sdk.startSubmit(request, { signal }));
        return job.id;
    }
    async check(id: string, kind: "run" | "submit", signal?: AbortSignal): Promise<JudgeResult | undefined> {
        const status = await safely(() => this.sdk.checkJob({ id, kind }, { signal }));
        return status.state === "pending" ? undefined : decodeJudge(status.result, kind);
    }
}
