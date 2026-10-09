import type { LeetCodeBackend, ProblemSummary } from "./backend.js";

export type DifficultyFilter = "" | "EASY" | "MEDIUM" | "HARD";
export type ScopeFilter = "all" | "free";
/** Matches the backend's fixed page size; paging must stay aligned with raw offsets. */
export const PAGE_SIZE = 20;
export const difficultyFilters: DifficultyFilter[] = ["", "EASY", "MEDIUM", "HARD"];
export const difficultyNames: Record<DifficultyFilter, string> = { "": "全部", EASY: "简单", MEDIUM: "中等", HARD: "困难" };

export function difficultyLabel(value: string | undefined): string {
    switch ((value ?? "").trim().toLowerCase()) {
        case "easy":
        case "简单":
            return "简单";
        case "medium":
        case "中等":
            return "中等";
        case "hard":
        case "困难":
            return "困难";
        default:
            return (value ?? "").trim() || "未知";
    }
}

export interface CatalogItems {
    /** Every filtered item scanned so far, in source order. */
    items: ProblemSummary[];
    /** True when every raw page up to `total` has been scanned. */
    exhausted: boolean;
    /** Raw result count reported by the platform, when known. */
    total?: number;
}
export interface CatalogPage {
    items: ProblemSummary[];
    hasPrevious: boolean;
    hasNext: boolean;
    /** Raw result count reported by the platform, when known. */
    total?: number;
    /** How many items passed the current filters inside the scanned window. */
    visible: number;
    /** True when every raw page up to `total` has been scanned. */
    exhausted: boolean;
}

/**
 * Sequential reader over one query/filter combination. Raw pages are cached, so
 * paging never duplicates or skips items, and the free-only filter can look past
 * a page of paid problems without reporting an empty result.
 */
export class ProblemCatalog {
    private readonly pages = new Map<number, ProblemSummary[]>();
    private scanned = 0;
    private exhausted = false;
    private rawTotal?: number;
    constructor(private search: LeetCodeBackend["search"], readonly keyword: string, readonly difficulty: DifficultyFilter, readonly scope: ScopeFilter) {}

    private visible(): ProblemSummary[] {
        const items: ProblemSummary[] = [];
        for (let skip = 0; skip < this.scanned * PAGE_SIZE; skip += PAGE_SIZE) {
            const page = this.pages.get(skip);
            if (!page) break;
            for (const item of page) if (this.scope === "all" || !item.paid) items.push(item);
        }
        return items;
    }

    private async fetchNext(): Promise<void> {
        const skip = this.scanned * PAGE_SIZE;
        const response = await this.search(this.keyword, this.difficulty, skip);
        this.pages.set(skip, response.items);
        this.rawTotal = response.total;
        this.scanned += 1;
        if (!response.items.length || skip + response.items.length >= response.total) this.exhausted = true;
    }

    /**
     * Filtered items scanned so far, extended until at least `limit` are available
     * or the source ends. `budget` caps extra raw pages fetched per call, so a
     * free-only scan can continue across calls instead of reporting an empty page.
     */
    async items(limit: number, budget = 50): Promise<CatalogItems> {
        for (let used = 0; used < budget; used++) {
            if (this.visible().length >= limit || this.exhausted) break;
            await this.fetchNext();
        }
        return { items: this.visible(), exhausted: this.exhausted, total: this.rawTotal };
    }

    /** Filtered page `index` (1-based), computed from the scanned window. */
    async page(index: number, budget = 50): Promise<CatalogPage> {
        const found = await this.items(index * PAGE_SIZE + 1, budget);
        const start = (index - 1) * PAGE_SIZE;
        return {
            items: found.items.slice(start, start + PAGE_SIZE),
            hasPrevious: index > 1,
            hasNext: found.items.length > start + PAGE_SIZE || !found.exhausted,
            total: found.total,
            visible: found.items.length,
            exhausted: found.exhausted,
        };
    }
}

/**
 * Finds the exact question number behind a pure-numeric keyword. The CN catalog
 * ranks number searches fuzzily, so an exact row is not guaranteed on page 1.
 * Lookups are bounded and cached per keyword/difficulty.
 */
export class ExactNumberLookup {
    private readonly cache = new Map<string, Promise<ProblemSummary | undefined>>();
    constructor(private search: LeetCodeBackend["search"], private limit = 10) {}

    find(number: string, difficulty: DifficultyFilter): Promise<ProblemSummary | undefined> {
        const key = `${number}\u0000${difficulty}`;
        let pending = this.cache.get(key);
        if (!pending) {
            pending = this.lookup(number, difficulty);
            this.cache.set(key, pending);
        }
        return pending;
    }

    private async lookup(number: string, difficulty: DifficultyFilter): Promise<ProblemSummary | undefined> {
        let skip = 0;
        for (let page = 0; page < this.limit; page++) {
            const response = await this.search(number, difficulty, skip);
            const match = response.items.find(item => item.id === number);
            if (match) return match;
            skip += response.items.length;
            if (!response.items.length || skip >= response.total) return undefined;
        }
        return undefined;
    }
}
