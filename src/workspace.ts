import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { demoProblem, type Guidance, type ViewState, defaultViewState } from "./problem.js";
import type { Problem } from "./backend.js";
import type { Execution } from "./execution.js";
export interface Settings {
    version: 1;
    workspace: string;
    guidance: Guidance;
}
export interface DemoResult {
    source: "fixture";
    createdAt: string;
    codeHash: string;
    message: string;
    input: string;
    expected: string;
    actual: string;
}
export interface Practice {
    code: string;
    notes: string;
    view: ViewState;
    result?: DemoResult | Execution;
}
export function codeHash(code: string): string {
    return createHash("sha256").update(code).digest("hex");
}
async function readOptional(path: string): Promise<string | undefined> {
    try {
        return await readFile(path, "utf8");
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            return undefined;
        throw error;
    }
}
async function atomicWrite(path: string, content: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
        await rename(temporary, path);
    }
    finally {
        await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT")
                throw error;
        });
    }
}
// Construction and extension loading perform no writes. Initialize on /leet only.
export class Workspace {
    readonly home: string;
    private queue: Promise<unknown> = Promise.resolve();
    constructor(home = process.env.PI_LEETCODE_HOME || join(homedir(), ".pi", "leetcode"), readonly problem: Problem = demoProblem, readonly attempt = "current") {
        this.home = resolve(home);
        if (!/^[a-zA-Z0-9-]+$/.test(problem.slug)) throw new Error("无效题目标识。");
        if (attempt !== "current" && !/^[a-f0-9-]{36}$/.test(attempt)) throw new Error("无效练习编号。");
    }
    async settings(): Promise<Settings | undefined> {
        const raw = await readOptional(join(this.home, "settings.json"));
        if (raw === undefined)
            return undefined;
        const value = JSON.parse(raw) as Partial<Settings>;
        if (value.version !== 1 || typeof value.workspace !== "string" || !isAbsolute(value.workspace) ||
            !["independent", "light", "coached"].includes(value.guidance || "")) {
            throw new Error("练习设置格式无效，请检查 settings.json；现有数据未被重置。");
        }
        return value as Settings;
    }
    private serialize<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.queue.then(operation);
        this.queue = next.catch(() => undefined);
        return next;
    }
    async initialize(guidance: Guidance = "light", directory?: string): Promise<Settings> {
        return this.serialize(async () => {
            const existing = await this.settings();
            if (existing)
                return existing;
            const settings: Settings = {
                version: 1,
                workspace: resolve(directory || join(this.home, "workspace")),
                guidance,
            };
            await mkdir(join(settings.workspace, "problems"), { recursive: true });
            await mkdir(join(settings.workspace, "records"), { recursive: true });
            await mkdir(join(this.home, "cache"), { recursive: true });
            // Exclusive creation keeps another Pi process's settings intact.
            try {
                await writeFile(join(this.home, "settings.json"), JSON.stringify(settings, null, 2) + "\n", { flag: "wx", mode: 0o600 });
            }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                    throw error;
                return (await this.settings())!;
            }
            return settings;
        });
    }
    async setGuidance(guidance: Guidance): Promise<void> {
        return this.serialize(async () => {
            const settings = await this.requireSettings();
            await atomicWrite(join(this.home, "settings.json"), JSON.stringify({ ...settings, guidance }, null, 2) + "\n");
        });
    }
    private async requireSettings(): Promise<Settings> {
        const settings = await this.settings();
        if (!settings)
            throw new Error("请先执行 /leet 完成首次设置。");
        return settings;
    }
    async problemDirectory(): Promise<string> {
        const settings = await this.requireSettings();
        const directory = this.problem.source === "demo" ? join(settings.workspace, "problems", "0001-two-sum") :
            join(settings.workspace, "problems", "cn", this.problem.slug);
        return this.attempt === "current" ? directory : join(directory, "attempts", this.attempt);
    }
    async open(): Promise<Practice> {
        return this.serialize(async () => {
            const directory = await this.problemDirectory();
            await mkdir(directory, { recursive: true });
            const defaults: Record<string, string> = {
                "problem.md": this.problem.statement,
                "problem.json": JSON.stringify(this.problem, null, 2) + "\n",
                "solution.go": this.problem.template,
                "cases.json": JSON.stringify(this.problem.source === "demo" ? demoProblem.cases : this.problem.inputs, null, 2) + "\n",
                "notes.md": "# 练习笔记\n\n",
            };
            for (const [name, content] of Object.entries(defaults)) {
                try {
                    await writeFile(join(directory, name), content, { flag: "wx", mode: 0o600 });
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
                        throw error;
                }
            }
            return this.read();
        });
    }
    async read(): Promise<Practice> {
        const directory = await this.problemDirectory();
        const [code, notes, state] = await Promise.all([
            readFile(join(directory, "solution.go"), "utf8"),
            readFile(join(directory, "notes.md"), "utf8"),
            readOptional(join(directory, "practice.json")),
        ]);
        const saved = state ? JSON.parse(state) as Pick<Practice, "view" | "result"> : undefined;
        return { code, notes, view: saved?.view || defaultViewState(), result: saved?.result };
    }
    // Compare with the version the caller loaded, preserving concurrent editor changes.
    async save(practice: Practice, expected: {
        code: string;
        notes: string;
    }): Promise<void> {
        return this.serialize(async () => {
            const directory = await this.problemDirectory();
            const lock = join(directory, ".write-lock");
            try { await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 }); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("其他编辑器或 Pi 正在保存，当前草稿已保留。请稍后重试；异常退出后的 .write-lock 需要手动检查。");
                throw error;
            }
            try {
            const disk = await this.read();
            if (disk.code !== expected.code || disk.notes !== expected.notes) {
                throw new Error("文件已被其他编辑器修改，未覆盖磁盘内容。请先复制当前草稿，再关闭并重新打开 /leet。");
            }
            if (practice.code !== disk.code)
                await atomicWrite(join(directory, "solution.go"), practice.code);
            if (practice.notes !== disk.notes)
                await atomicWrite(join(directory, "notes.md"), practice.notes);
            await atomicWrite(join(directory, "practice.json"), JSON.stringify({ view: practice.view, result: practice.result }, null, 2) + "\n");
            } finally { await unlink(lock); }
        });
    }
    async previewResult(practice: Practice): Promise<DemoResult> {
        if (this.problem.source !== "demo") throw new Error("真实题目不能使用演示判题。");
        const settings = await this.requireSettings();
        const result: DemoResult = {
            source: "fixture",
            createdAt: new Date().toISOString(),
            codeHash: codeHash(practice.code),
            message: "固定失败结果预览：没有执行当前代码，也没有连接 LeetCode。",
            input: "nums = [3, 3], target = 6",
            expected: "[0, 1]",
            actual: "[0, 0]（固定演示输出）",
        };
        await this.serialize(() => atomicWrite(join(settings.workspace, "records", `${randomUUID()}.json`), JSON.stringify({ problemId: demoProblem.id, code: practice.code, result }, null, 2) + "\n"));
        return result;
    }
    async inputs(): Promise<string[]> {
        const value: unknown = JSON.parse(await readFile(join(await this.problemDirectory(), "cases.json"), "utf8"));
        if (!Array.isArray(value) || !value.length || value.some(input => typeof input !== "string" || !input.trim()))
            throw new Error("用例必须是非空字符串数组，每个字符串使用换行分隔参数。");
        return value as string[];
    }
    async saveInputs(inputs: string[]): Promise<void> {
        if (!inputs.length || inputs.some(input => !input.trim())) throw new Error("至少需要一个非空用例。");
        await atomicWrite(join(await this.problemDirectory(), "cases.json"), JSON.stringify(inputs, null, 2) + "\n");
    }
    async remember(): Promise<void> {
        const entry = { problem: this.problem, attempt: this.attempt, updatedAt: new Date().toISOString() };
        const recent = await this.recent();
        const previous = recent.filter(item => !(item.problem.source === this.problem.source && item.problem.slug === this.problem.slug && item.attempt === this.attempt));
        await atomicWrite(join(this.home, "recent.json"), JSON.stringify([entry, ...previous].slice(0, 50)));
        await atomicWrite(join(this.home, "last-problem.json"), JSON.stringify(entry));
    }
    async recent(): Promise<{ problem: Problem; attempt: string; updatedAt: string }[]> {
        const raw = await readOptional(join(this.home, "recent.json"));
        return raw ? JSON.parse(raw) : [];
    }
    async resume(): Promise<Workspace> {
        const raw = await readOptional(join(this.home, "last-problem.json"));
        if (!raw) return this;
        const data = JSON.parse(raw);
        const problem = (data.problem || data) as Problem;
        if (!["demo", "leetcode"].includes(problem.source) || typeof problem.statement !== "string" || typeof problem.template !== "string")
            throw new Error("最近练习记录格式无效，未重置数据。");
        return new Workspace(this.home, problem, data.attempt || "current");
    }
    async restart(): Promise<Workspace> {
        await this.remember();
        const next = new Workspace(this.home, this.problem, randomUUID());
        await next.open();
        await next.remember();
        return next;
    }
}
