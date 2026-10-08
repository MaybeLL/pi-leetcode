import TurndownService from "turndown";

import { PlatformError, DIRECT_BACKEND_ID, type Problem, type Credentials, type Account, type ProblemSummary, type FailureKind, type JudgeResult, type LeetCodeBackend } from "./backend.js";
// Keep previous imports compatible while callers move to the backend contract.
export { PlatformError } from "./backend.js";
export type { Problem, Credentials, Account, ProblemSummary, FailureKind, JudgeResult } from "./backend.js";
type JsonObject = Record<string, unknown>;
function object(value: unknown): JsonObject {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new PlatformError("protocol", "平台返回格式变化，请稍后重试或反馈问题。");
    return value as JsonObject;
}
function string(value: unknown): string {
    if (typeof value !== "string") throw new PlatformError("protocol", "平台缺少必要字段。");
    return cleanText(value);
}
export function cleanText(value: string): string {
    // Remote content must never inject terminal escape/control sequences.
    return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
        .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}
export function statementMarkdown(html: string): string {
    const converter = new TurndownService({ codeBlockStyle: "fenced", headingStyle: "atx" });
    converter.remove(["script", "style", "iframe"]);
    converter.addRule("superscript", { filter: "sup", replacement: content => `^(${content})` });
    converter.addRule("sample-blocks", {
        filter: "pre",
        replacement(_content, node) {
            const text = cleanText(node.textContent || "").trim();
            const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map(match => match[0].length + 1)));
            return `\n\n${fence}text\n${text}\n${fence}\n\n`;
        },
    });
    converter.addRule("tables", {
        filter: "table",
        replacement(_content, node) {
            const rows = Array.from((node as HTMLElement).querySelectorAll("tr")).map(row =>
                Array.from(row.querySelectorAll("th,td")).map(cell => (cell.textContent || "").trim().replace(/\|/g, "\\|").replace(/\n/g, " ")));
            const columns = Math.max(0, ...rows.map(row => row.length));
            if (!columns) return "";
            const lines = rows.map(row => `| ${Array.from({ length: columns }, (_, index) => row[index] || "").join(" | ")} |`);
            lines.splice(1, 0, `| ${Array(columns).fill("---").join(" | ")} |`);
            return `\n\n${lines.join("\n")}\n\n`;
        },
    });
    converter.addRule("safe-links", {
        filter: ["a", "img"],
        replacement(content, node) {
            const element = node as unknown as { getAttribute(name: string): string | null; nodeName: string };
            const target = element.getAttribute(element.nodeName === "IMG" ? "src" : "href") || "";
            const label = element.nodeName === "IMG" ? `图片：${element.getAttribute("alt") || "查看原图"}` : content;
            try {
                const url = new URL(target, "https://leetcode.cn");
                return /^https?:$/.test(url.protocol) ? `[${label}](<${url.href}>)` : label;
            } catch { return label; }
        },
    });
    return cleanText(converter.turndown(html));
}

export function parseCredentials(input: string): Credentials {
    const fields = new Map(input.trim().split(";").map(part => {
        const index = part.indexOf("=");
        return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
    }));
    const session = fields.get("LEETCODE_SESSION");
    const csrf = fields.get("csrftoken");
    if (!session || !csrf || !/^[\x21-\x7e]+$/.test(session + csrf) || /[;,]/.test(session + csrf))
        throw new Error("需要 LEETCODE_SESSION 和 csrftoken 两项 Cookie；输入未保存。");
    return { session, csrf };
}

export function decodeJudge(payload: unknown, kind: "run" | "submit"): JudgeResult | undefined {
    const value = object(payload);
    if (value.state === "PENDING" || value.state === "STARTED") return undefined;
    if (!["SUCCESS", "FAILURE"].includes(String(value.state)) || typeof value.status_code !== "number" ||
        (value.state === "FAILURE" && value.status_code === 10))
        throw new PlatformError("protocol", "平台返回了未识别的判题状态；没有认定代码通过。");
    const statuses: Record<number, string> = {
        10: kind === "submit" ? "Accepted" : "运行完成",
        11: "Wrong Answer", 12: "Memory Limit Exceeded", 13: "Output Limit Exceeded",
        14: "Time Limit Exceeded", 15: "Runtime Error", 16: "Internal Error", 20: "Compile Error",
    };
    let verdict = statuses[value.status_code];
    if (!verdict) throw new PlatformError("protocol", "平台返回未知判定；请在网页查看结果。");
    if (value.status_code !== 10 && typeof value.status_msg === "string") verdict = cleanText(value.status_msg).slice(0, 100);
    if (kind === "run" && value.status_code === 10 && typeof value.correct_answer === "boolean")
        verdict = value.correct_answer ? "样例通过" : "样例未通过";
    const text = (field: unknown) => typeof field === "string" ? cleanText(field).slice(0, 24000) :
        Array.isArray(field) ? field.map(item => cleanText(String(item))).join("\n").slice(0, 24000) : undefined;
    return {
        verdict, passed: typeof value.total_correct === "number" ? value.total_correct : undefined,
        total: typeof value.total_testcases === "number" ? value.total_testcases : undefined,
        output: text(value.code_answer ?? value.code_output ?? value.last_testcase_output),
        expected: text(value.expected_code_answer ?? value.expected_output),
        diagnostic: text(value.full_compile_error ?? value.compile_error ?? value.full_runtime_error ?? value.runtime_error),
        runtime: text(value.status_runtime), memory: text(value.status_memory),
        stdout: text(value.std_output_list ?? value.std_output), failingInput: text(value.last_testcase),
    };
}

export class LeetCodeCN implements LeetCodeBackend {
    readonly id = DIRECT_BACKEND_ID;
    constructor(private credentials?: Credentials, private transport: typeof fetch = fetch) {}
    private async request(path: string, body?: unknown, mutation = false, signal?: AbortSignal): Promise<JsonObject> {
        const headers: Record<string, string> = {
            "Content-Type": "application/json", Origin: "https://leetcode.cn", Referer: "https://leetcode.cn/",
        };
        if (this.credentials) {
            headers.Cookie = `LEETCODE_SESSION=${this.credentials.session}; csrftoken=${this.credentials.csrf}`;
            headers["x-csrftoken"] = this.credentials.csrf;
        }
        let response: Response;
        try {
            response = await this.transport(`https://leetcode.cn${path}`, {
                method: body === undefined ? "GET" : "POST", headers,
                body: body === undefined ? undefined : JSON.stringify(body), redirect: "error",
                signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
            });
        } catch {
            throw new PlatformError("network", mutation ? "请求可能已发送，结果未知；不会自动重新发送。" : "连接未完成，请检查网络后重试。", mutation);
        }
        if (!response.ok) {
            const [kind, message]: [FailureKind, string] = response.status === 401 ? ["auth", "登录已失效，请用 /leet login 重新连接。"] :
                response.status === 403 ? ["forbidden", "平台拒绝访问，可能需要在浏览器验证或稍后再试。"] :
                response.status === 429 ? ["throttled", "平台请求过于频繁，请稍后重试。"] : ["platform", `平台请求失败（HTTP ${response.status}）。`];
            throw new PlatformError(kind, message, mutation && response.status >= 500);
        }
        try {
            const raw = await response.text();
            if (raw.length > 2_000_000) throw new Error();
            return object(JSON.parse(raw));
        } catch {
            throw new PlatformError("protocol", "平台响应无法解析，请在网页检查操作状态。", mutation);
        }
    }
    private async graphql(query: string, variables: JsonObject = {}): Promise<JsonObject> {
        const value = await this.request("/graphql/", { query, variables });
        if (value.errors) throw new PlatformError("protocol", "题库接口返回错误，请稍后重试或反馈问题。");
        return object(value.data);
    }
    async account(): Promise<Account> {
        const data = await this.graphql("query { userStatus { isSignedIn username userSlug } }");
        const user = object(data.userStatus);
        if (user.isSignedIn !== true) throw new PlatformError("auth", "尚未登录或会话已失效，请用 /leet login 连接中国站。");
        return { username: string(user.username), slug: string(user.userSlug) };
    }
    async search(keyword = "", difficulty = "", skip = 0): Promise<{ items: ProblemSummary[]; total: number }> {
        const data = await this.graphql(`query($limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
            problemsetQuestionList(categorySlug: "all-code-essentials", limit: $limit, skip: $skip, filters: $filters) {
                total questions { frontendQuestionId title titleSlug titleCn difficulty paidOnly }
            }
        }`, { limit: 20, skip, filters: { searchKeywords: keyword, ...(difficulty ? { difficulty } : {}) } });
        const list = object(data.problemsetQuestionList);
        if (!Array.isArray(list.questions) || typeof list.total !== "number")
            throw new PlatformError("protocol", "题库列表格式变化。");
        return { total: list.total, items: list.questions.map(item => {
            const q = object(item);
            return { id: string(q.frontendQuestionId), slug: string(q.titleSlug), title: string(q.titleCn || q.title), difficulty: string(q.difficulty), paid: q.paidOnly === true };
        }) };
    }
    async problem(reference: string): Promise<Problem> {
        let slug = reference.trim();
        if (/^https?:\/\//.test(slug)) {
            const url = new URL(slug);
            if (url.hostname !== "leetcode.cn") throw new Error("当前仅支持 leetcode.cn 题目链接。");
            slug = url.pathname.match(/^\/problems\/([^/]+)/)?.[1] || "";
        }
        if (/^\d+$/.test(slug)) {
            const { items } = await this.search(slug);
            const match = items.find(item => item.id === slug);
            if (!match) throw new Error("未找到该题号，请使用题目链接或英文 slug。");
            slug = match.slug;
        }
        if (!/^[a-zA-Z0-9-]+$/.test(slug)) throw new Error("请输入题号、英文 slug 或中国站题目链接。");
        const data = await this.graphql(`query($titleSlug: String!) { question(titleSlug: $titleSlug) {
            questionId questionFrontendId title titleSlug translatedTitle content translatedContent difficulty isPaidOnly
            codeSnippets { langSlug code } exampleTestcaseList metaData
        } }`, { titleSlug: slug });
        if (!data.question) throw new Error("题目不存在或当前账户无权查看。");
        const q = object(data.question);
        if (!q.content && !q.translatedContent) throw new Error("题面不可用，可能需要会员权限。");
        if (!Array.isArray(q.codeSnippets)) throw new Error("当前账户无法读取题目模板。");
        const snippet = q.codeSnippets.map(object).find(item => item.langSlug === "golang");
        if (!snippet) throw new Error("此题没有 Go 模板，暂不支持。");
        if (!Array.isArray(q.exampleTestcaseList) || q.exampleTestcaseList.some(item => typeof item !== "string"))
            throw new PlatformError("protocol", "题目缺少有效的示例输入。");
        const title = string(q.translatedTitle || q.title);
        return {
            source: "leetcode", id: string(q.questionFrontendId), questionId: string(q.questionId), slug: string(q.titleSlug),
            title, language: "Go", difficulty: string(q.difficulty),
            statement: `# ${string(q.questionFrontendId)} · ${title}\n\n${statementMarkdown(string(q.translatedContent || q.content))}\n\n[在 LeetCode 查看原题](https://leetcode.cn/problems/${slug}/)`,
            template: string(snippet.code) + "\n", inputs: q.exampleTestcaseList as string[], metadata: string(q.metaData),
        };
    }
    async start(kind: "run" | "submit", problem: Problem, code: string, input: string, signal?: AbortSignal): Promise<string> {
        if (!this.credentials) throw new PlatformError("auth", "请先用 /leet login 连接中国站。");
        if (problem.source !== "leetcode" || !problem.questionId || !/^[a-zA-Z0-9-]+$/.test(problem.slug))
            throw new Error("只能运行或提交真实平台题目。");
        const response = await this.request(`/problems/${problem.slug}/${kind === "run" ? "interpret_solution" : "submit"}/`, {
            lang: "golang", question_id: problem.questionId, typed_code: code, ...(kind === "run" ? { data_input: input } : {}),
        }, true, signal);
        const id = response[kind === "run" ? "interpret_id" : "submission_id"];
        if ((typeof id !== "string" && typeof id !== "number") || !/^[a-zA-Z0-9_-]+$/.test(String(id)))
            throw new PlatformError("protocol", "未收到任务编号，发送状态未知；请查看平台记录。", true);
        return String(id);
    }
    async check(id: string, kind: "run" | "submit", signal?: AbortSignal): Promise<JudgeResult | undefined> {
        if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("无效任务编号。");
        return decodeJudge(await this.request(`/submissions/detail/${id}/check/`, undefined, false, signal), kind);
    }
}
