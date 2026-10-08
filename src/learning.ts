import { randomUUID } from "node:crypto";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
export const helpKinds = ["理解题意", "检查思路", "一点提示", "分析用例", "完整讲解", "自由提问", "带练", "复盘"] as const;
export type HelpKind = (typeof helpKinds)[number];
export const receivedHelp = ["未标注", "仅澄清题意", "观察提示", "关键思路", "完整解法", "Agent 代写"] as const;
export interface HelpExchange {
    id: string;
    requestedAt: string;
    kind: HelpKind;
    request: string;
    state: "requested" | "answered" | "failed";
    response?: string;
    codeChanged?: boolean;
    event?: string;
    received: (typeof receivedHelp)[number]; // A user label, never inferred from the selected guidance.
}
export interface LearningRecord {
    version: 1;
    events: string[];
    exchanges: HelpExchange[];
    reflection: string;
}
export class LearningStore {
    constructor(private directory: string) {}
    async read(): Promise<LearningRecord> {
        try {
            const value = JSON.parse(await readFile(join(this.directory, "learning.json"), "utf8"));
            if (
                value.version !== 1 ||
                !Array.isArray(value.events) ||
                !Array.isArray(value.exchanges) ||
                typeof value.reflection !== "string"
            )
                throw new Error("学习记录格式无效，未覆盖原文件。");
            return value;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, events: [], exchanges: [], reflection: "" };
            throw error;
        }
    }
    private async update<T>(change: (value: LearningRecord) => T): Promise<T> {
        const lock = join(this.directory, ".learning-lock"),
            temp = join(this.directory, `.learning-${randomUUID()}.tmp`);
        try {
            await writeFile(lock, String(process.pid), { flag: "wx", mode: 0o600 });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("学习记录正在更新，请稍后重试。");
            throw error;
        }
        try {
            const value = await this.read();
            const result = change(value);
            await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
            await rename(temp, join(this.directory, "learning.json"));
            return result;
        } finally {
            await unlink(temp).catch(() => undefined);
            await unlink(lock);
        }
    }
    async begin(kind: HelpKind, request: string, event?: string): Promise<string | undefined> {
        return this.update((value) => {
            if (event && value.events.includes(event)) return undefined;
            const id = randomUUID();
            if (event) value.events.push(event);
            value.exchanges.push({
                id,
                kind,
                request: request.slice(0, 6000),
                event,
                requestedAt: new Date().toISOString(),
                state: "requested",
                received: "未标注",
            });
            return id;
        });
    }
    async finish(id: string, response: string, codeChanged: boolean): Promise<void> {
        await this.update((value) => {
            const item = value.exchanges.find((item) => item.id === id);
            if (!item) return;
            item.state = response ? "answered" : "failed";
            item.response = response.length > 8000 ? response.slice(0, 8000) + "\n[学习记录已截断；完整回复请查看 Pi 对话]" : response;
            item.codeChanged = codeChanged;
            if (!response && item.event) value.events = value.events.filter((key) => key !== item.event);
        });
    }
    async annotate(id: string, received: HelpExchange["received"]): Promise<void> {
        if (!receivedHelp.includes(received)) throw new Error("无效帮助标注。");
        await this.update((value) => {
            const item = value.exchanges.find((item) => item.id === id);
            if (item) item.received = received;
        });
    }
    async reflect(text: string, expected: string): Promise<void> {
        await this.update((value) => {
            if (value.reflection !== expected) throw new Error("复盘已被修改，请重新读取，未覆盖原记录。");
            value.reflection = text;
        });
    }
}
export function learningSummary(record: LearningRecord): string {
    const latest = [...record.exchanges].reverse().find((item) => item.state === "answered") ?? record.exchanges.at(-1);
    return (
        `帮助记录：${record.exchanges.length} 次请求（请求深度不代表实际获得的帮助）。\n` +
        (latest
            ? `最近请求：${latest.kind} · ${latest.state}\n${latest.request}\n最近回复：${latest.response ?? "尚无回复"}\n实际帮助：${latest.received}（用户标注）\n`
            : "") +
        `用户复盘：${record.reflection || "尚未填写"}`
    );
}
