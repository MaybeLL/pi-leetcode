import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Workspace } from "./workspace.js";

/** Local practice progress for one problem. This is never account history or mastery. */
export type LocalStatus = "none" | "started" | "accepted";
export const localStatusLabels: Record<LocalStatus, string> = {
    none: "未练习",
    started: "已开始",
    accepted: "曾通过",
};
export const localStatusHint = "状态按本机练习记录判断，不代表 LeetCode 账号全部历史或已经掌握。";
const rank: Record<LocalStatus, number> = { none: 0, started: 1, accepted: 2 };

export interface LocalStatusIndex {
    get(slug: string): LocalStatus;
}

export const emptyLocalStatus: LocalStatusIndex = { get: () => "none" };

async function readJson(path: string): Promise<unknown> {
    try {
        return JSON.parse(await readFile(path, "utf8")) as unknown;
    }
    catch {
        return undefined;
    }
}

/** Only a formal, completed submit with an Accepted verdict proves "passed once". */
export function isAcceptedSubmission(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    const record = value as { kind?: unknown; state?: unknown; result?: { verdict?: unknown } };
    return record.kind === "submit" && record.state === "complete" && record.result?.verdict === "Accepted";
}

/**
 * Read the on-disk practice library. The recent-50 index is intentionally ignored:
 * problems whose files still exist must keep their status after leaving that index.
 */
export async function localStatusIndex(home: string): Promise<LocalStatusIndex> {
    const statuses = new Map<string, LocalStatus>();
    const bump = (slug: string, status: LocalStatus): void => {
        if (!slug || rank[status] <= rank[statuses.get(slug) ?? "none"]) return;
        statuses.set(slug, status);
    };
    const workspace = await new Workspace(home).settings().then(value => value?.workspace).catch(() => undefined);
    if (workspace) {
        const base = join(workspace, "problems", "cn");
        for (const entry of await readdir(base, { withFileTypes: true }).catch(() => [])) {
            if (!entry.isDirectory()) continue;
            const directory = join(base, entry.name);
            bump(entry.name, "started");
            if (isAcceptedSubmission(await readJson(join(directory, "execution.json")))) bump(entry.name, "accepted");
            for (const attempt of await readdir(join(directory, "attempts"), { withFileTypes: true }).catch(() => [])) {
                if (!attempt.isDirectory()) continue;
                bump(entry.name, "started");
                if (isAcceptedSubmission(await readJson(join(directory, "attempts", attempt.name, "execution.json")))) bump(entry.name, "accepted");
            }
        }
        const records = join(workspace, "records", "executions");
        for (const name of await readdir(records).catch(() => [])) {
            if (!name.endsWith(".json")) continue;
            const record = await readJson(join(records, name));
            if (!record || typeof record !== "object") continue;
            const slug = (record as { slug?: unknown }).slug;
            if (typeof slug !== "string") continue;
            bump(slug, "started");
            if (isAcceptedSubmission(record)) bump(slug, "accepted");
        }
    }
    return { get: slug => statuses.get(slug) ?? "none" };
}
