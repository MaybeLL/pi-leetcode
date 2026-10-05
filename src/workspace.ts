import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { demoProblem, type Guidance, type ViewState, defaultViewState } from "./problem.js";
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
    result?: DemoResult;
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
    constructor(home = process.env.PI_LEETCODE_HOME || join(homedir(), ".pi", "leetcode")) {
        this.home = resolve(home);
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
        return join(settings.workspace, "problems", "0001-two-sum");
    }
    async open(): Promise<Practice> {
        return this.serialize(async () => {
            const directory = await this.problemDirectory();
            await mkdir(directory, { recursive: true });
            const defaults: Record<string, string> = {
                "problem.md": demoProblem.statement,
                "solution.go": demoProblem.template,
                "cases.json": JSON.stringify(demoProblem.cases, null, 2) + "\n",
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
            const disk = await this.read();
            if (disk.code !== expected.code || disk.notes !== expected.notes) {
                throw new Error("文件已被其他编辑器修改，未覆盖磁盘内容。请先复制当前草稿，再关闭并重新打开 /leet。");
            }
            if (practice.code !== disk.code)
                await atomicWrite(join(directory, "solution.go"), practice.code);
            if (practice.notes !== disk.notes)
                await atomicWrite(join(directory, "notes.md"), practice.notes);
            await atomicWrite(join(directory, "practice.json"), JSON.stringify({ view: practice.view, result: practice.result }, null, 2) + "\n");
        });
    }
    async previewResult(practice: Practice): Promise<DemoResult> {
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
}
