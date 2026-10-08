import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { DIRECT_BACKEND_ID, PlatformError, type JudgeBackend, type JudgeResult, type Problem } from "./backend.js";
import { codeHash } from "./workspace.js";

export interface Execution {
    source: "leetcode";
    backend?: string; // Records from the original direct adapter omit this field.
    id: string;
    kind: "run" | "submit";
    createdAt: string;
    account: string;
    slug: string;
    code: string;
    codeHash: string;
    input: string;
    jobId?: string;
    state: "sending" | "pending" | "complete" | "unknown" | "failed";
    message: string;
    result?: JudgeResult;
}
export class Executions {
    constructor(private home: string, private client: JudgeBackend, private account: string) {}
    static async backendId(home: string, id: string): Promise<string> {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("无效执行记录编号。");
        const record = JSON.parse(await readFile(join(home, "executions", `${id}.json`), "utf8")) as Execution;
        return record.backend ?? DIRECT_BACKEND_ID;
    }
    private assertOwner(record: Execution): void {
        if (record.account !== this.account) throw new Error("此结果属于其他账户，请切回原账户查询。");
        if ((record.backend ?? DIRECT_BACKEND_ID) !== this.client.id)
            throw new Error("此任务由其他平台后端创建，请切回原后端查询；不会重新发送代码。");
    }
    private async persist(record: Execution): Promise<void> {
        const directory = join(this.home, "executions");
        await mkdir(directory, { recursive: true });
        const temporary = join(directory, `${record.id}.${randomUUID()}.tmp`);
        try {
            await writeFile(temporary, JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 });
            await rename(temporary, join(directory, `${record.id}.json`));
        } finally { await unlink(temporary).catch(() => undefined); }
    }
    async load(id: string): Promise<Execution> {
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("无效执行记录编号。");
        const record = JSON.parse(await readFile(join(this.home, "executions", `${id}.json`), "utf8")) as Execution;
        this.assertOwner(record);
        if (record.state === "sending" && !record.jobId) {
            record.state = "unknown";
            record.message = "上次发送被中断且没有任务编号；请检查平台记录，不能自动重新发送。";
            await this.persist(record);
        }
        return record;
    }
    async start(kind: "run" | "submit", problem: Problem, code: string, input: string, signal?: AbortSignal): Promise<Execution> {
        await mkdir(this.home, { recursive: true });
        const lockPath = join(this.home, "judge.lock");
        try { await writeFile(lockPath, String(process.pid), { flag: "wx", mode: 0o600 }); }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST")
                throw new Error("另一个发送操作尚未结束；若 Pi 曾异常退出，请先检查平台提交记录，再移除数据目录中的 judge.lock。");
            throw error;
        }
        const record: Execution = {
            source: "leetcode", backend: this.client.id, id: randomUUID(), kind, createdAt: new Date().toISOString(), account: this.account,
            slug: problem.slug, code, codeHash: codeHash(code), input, state: "sending", message: "正在发送",
        };
        try {
            if (signal?.aborted) throw new Error("操作已取消，尚未发送。");
            await this.persist(record);
            try {
                record.jobId = await this.client.start(kind, problem, code, input, signal);
                record.state = "pending"; record.message = "平台已接收，等待结果";
            } catch (error) {
                record.state = error instanceof PlatformError && !error.outcomeUnknown ? "failed" : "unknown";
                record.message = (error as Error).message;
            }
            await this.persist(record);
            return record;
        } finally { await unlink(lockPath); }
    }
    async poll(record: Execution, signal?: AbortSignal, deadlineMs = 60000, intervalMs = 1500): Promise<Execution> {
        this.assertOwner(record);
        if (!record.jobId || record.state === "complete") return record;
        const deadline = Date.now() + deadlineMs;
        const timeout = AbortSignal.timeout(Math.max(1, deadlineMs));
        const waitSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
        try {
            while (Date.now() < deadline && !signal?.aborted) {
                const result = await this.client.check(record.jobId, record.kind, waitSignal);
                if (result) {
                    record.result = result; record.state = "complete"; record.message = result.verdict;
                    await this.persist(record); return record;
                }
                await delay(Math.min(intervalMs, Math.max(1, deadline - Date.now())), undefined, { signal: waitSignal });
            }
            record.message = "已停止等待，平台任务可能仍在运行；使用 /leet status 恢复查询。";
        } catch (error) {
            record.message = waitSignal.aborted ? "已停止等待；平台任务没有被撤销，可用 /leet status 恢复查询。" : (error as Error).message;
        }
        record.state = "pending";
        await this.persist(record);
        return record;
    }
}

export function executionMarkdown(record: Execution): string {
    const result = record.result;
    return `# ${record.kind === "submit" ? "正式提交" : "在线运行"} · ${record.message}\n\n` +
        `状态：${record.state} · ${record.createdAt}\n\n记录：${record.id}\n\n` +
        (record.jobId ? `平台任务：${record.jobId}\n\n` : "") +
        (record.kind === "run" ? "此操作仅运行指定输入，不代表整题 Accepted。\n\n" : "") +
        (record.state === "unknown" ? "发送结果未知，不会自动重新提交。[查看平台提交记录](https://leetcode.cn/submissions/)\n\n" : "") +
        (record.input ? `输入：\n\n\`\`\`text\n${record.input}\n\`\`\`\n\n` : "") +
        (result ? `实际输出：\n\n\`\`\`text\n${result.output ?? "平台未提供"}\n\`\`\`\n\n预期输出：\n\n\`\`\`text\n${result.expected ?? "平台未提供，未推断是否通过"}\n\`\`\`\n\n` +
            (result.diagnostic ? `错误信息：\n\n\`\`\`text\n${result.diagnostic}\n\`\`\`\n\n` : "") +
            (result.failingInput ? `失败输入：\n\n\`\`\`text\n${result.failingInput}\n\`\`\`\n\n` : "") +
            (result.stdout ? `标准输出：\n\n\`\`\`text\n${result.stdout}\n\`\`\`\n\n` : "") +
            `耗时：${result.runtime ?? "未提供"} · 内存：${result.memory ?? "未提供"}` : "");
}
