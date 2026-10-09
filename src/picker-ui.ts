import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import type { LeetCodeBackend, ProblemSummary } from "./backend.js";
import { difficultyFilters, difficultyLabel, difficultyNames, ExactNumberLookup, PAGE_SIZE, ProblemCatalog, type CatalogItems, type DifficultyFilter, type ScopeFilter } from "./picker.js";
import { emptyLocalStatus, localStatusHint, localStatusLabels, type LocalStatus, type LocalStatusIndex } from "./local-status.js";

export interface PickerOptions {
    search: LeetCodeBackend["search"];
    status?: LocalStatusIndex;
    /** Typing debounce in milliseconds. The contract asks for about 300ms. */
    debounceMs?: number;
}
type Focus = "search" | "filters" | "list";
type RegionKind = "search" | "row" | "chip" | "open" | "load" | "prev" | "next" | "cancel" | "retry";
interface Region {
    y: number;
    start: number;
    end: number;
    kind: RegionKind;
    value?: string | number;
}
interface RelativeRegion {
    line: number;
    start: number;
    end: number;
    kind: RegionKind;
    value?: string | number;
}
interface PickerItem {
    summary: ProblemSummary;
    status: LocalStatus;
    exact: boolean;
}
interface Chip {
    key: string;
    kind: "difficulty" | "scope";
    value: string;
    label: string;
    active: boolean;
}

function padded(text: string, width: number): string {
    const clipped = truncateToWidth(text, Math.max(0, width), "");
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

/**
 * Full-screen problem browser. It debounces typing, keeps the previous confirmed
 * list visible while a new query runs, drops stale responses, and never opens a
 * problem without an explicit confirm.
 */
export class ProblemPicker implements Component, Focusable {
    focused = false;
    private readonly searchInput: Input;
    private readonly status: LocalStatusIndex;
    private readonly debounceMs: number;
    private readonly search: LeetCodeBackend["search"];
    private readonly exact: ExactNumberLookup;
    private query = "";
    private difficulty: DifficultyFilter = "";
    private scope: ScopeFilter = "all";
    private focus: Focus = "search";
    private chip = 0;
    private selected = 0;
    private pageIndex = 1;
    private catalog?: ProblemCatalog;
    private catalogKey = "";
    private items: PickerItem[] = [];
    private shownPage = 1;
    private shownKey?: string;
    private hasPrevious = false;
    private hasNext = false;
    private total?: number;
    private visibleCount = 0;
    private exhausted = false;
    private loading = true;
    private error?: string;
    private notice?: string;
    private seq = 0;
    private timer?: ReturnType<typeof setTimeout>;
    private listOffset = 0;
    private renderedWidth = 0;
    private regions: Region[] = [];
    private disposed = false;

    constructor(private tui: TUI, private theme: Theme, options: PickerOptions, private done: (result?: ProblemSummary) => void) {
        this.status = options.status ?? emptyLocalStatus;
        this.debounceMs = options.debounceMs ?? 300;
        this.search = options.search;
        this.exact = new ExactNumberLookup(options.search);
        this.searchInput = new Input({ prompt: "搜索 │ ", placeholder: "题号 / 中文标题 / 英文关键词（留空浏览）" });
        this.searchInput.onSubmit = () => this.open();
        this.searchInput.focused = true;
        void this.load();
    }

    // Read-only state for tests and callers.
    get entries(): readonly PickerItem[] { return this.items; }
    get isLoading(): boolean { return this.loading; }
    get failure(): string | undefined { return this.error; }
    get currentPage(): number { return this.shownPage; }
    get focusedArea(): Focus { return this.focus; }
    get selectedIndex(): number { return this.selected; }
    get keyword(): string { return this.query; }

    private chips(): Chip[] {
        return [
            ...difficultyFilters.map(value => ({ key: `difficulty:${value}`, kind: "difficulty" as const, value, label: difficultyNames[value], active: this.difficulty === value })),
            { key: "scope:all", kind: "scope" as const, value: "all", label: "全部", active: this.scope === "all" },
            { key: "scope:free", kind: "scope" as const, value: "free", label: "仅免费", active: this.scope === "free" },
        ];
    }

    private queryKey(): string {
        return `${this.query.trim()}\u0000${this.difficulty}\u0000${this.scope}`;
    }

    private catalogFor(): ProblemCatalog {
        const key = this.queryKey();
        if (key !== this.catalogKey || !this.catalog) {
            this.catalog = new ProblemCatalog(this.search, this.query.trim(), this.difficulty, this.scope);
            this.catalogKey = key;
        }
        return this.catalog;
    }

    /**
     * True only while the displayed list belongs to the current keyword and filters.
     * A failed load leaves the previous list on screen but not confirmed, so it stays
     * readable and retryable but cannot be opened.
     */
    private confirmed(): boolean {
        return this.shownKey !== undefined && this.shownKey === this.queryKey();
    }

    private async load(): Promise<void> {
        const key = this.queryKey();
        const seq = ++this.seq;
        this.loading = true;
        this.error = undefined;
        this.notice = undefined;
        this.tui.requestRender();
        try {
            const catalog = this.catalogFor();
            const keyword = this.query.trim();
            // Resolve once per keyword/difficulty; later pages reuse the cache, so the
            // pinned row can be excluded from every page without extra requests.
            const lookup = /^\d+$/.test(keyword) ? this.exact.find(keyword, this.difficulty).catch(() => undefined) : Promise.resolve(undefined);
            const [exact, found] = await Promise.all([lookup, catalog.items(this.pageIndex * PAGE_SIZE + 1)]);
            if (seq !== this.seq) return;
            this.apply(found, exact);
            this.shownKey = key;
        }
        catch (error) {
            if (seq !== this.seq) return;
            this.error = (error as Error).message || "查询失败";
        }
        finally {
            if (seq === this.seq) {
                this.loading = false;
                this.tui.requestRender();
            }
        }
    }

    /**
     * Builds the logical list: the exact-number row (when it passes the filters) is
     * pinned once at the front and removed from every page, so paging never repeats
     * or skips it.
     */
    private apply(found: CatalogItems, exact: ProblemSummary | undefined): void {
        const pinned = exact && (this.scope === "all" || !exact.paid) ? exact : undefined;
        const logical = pinned
            ? [pinned, ...found.items.filter(item => item.slug !== pinned.slug && item.id !== pinned.id)]
            : found.items;
        const start = (this.pageIndex - 1) * PAGE_SIZE;
        this.items = logical.slice(start, start + PAGE_SIZE).map(summary => ({
            summary,
            status: this.status.get(summary.slug),
            exact: summary === pinned,
        }));
        this.hasPrevious = this.pageIndex > 1;
        this.hasNext = logical.length > start + PAGE_SIZE || !found.exhausted;
        this.total = found.total;
        this.visibleCount = logical.length;
        this.exhausted = found.exhausted;
        this.shownPage = this.pageIndex;
        this.selected = Math.min(this.selected, Math.max(0, this.items.length - 1));
    }

    private scheduleSearch(): void {
        this.pageIndex = 1;
        this.selected = 0;
        this.listOffset = 0;
        this.loading = true;
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.timer = undefined;
            void this.load();
        }, this.debounceMs);
        this.tui.requestRender();
    }

    private reload(): void {
        clearTimeout(this.timer);
        this.timer = undefined;
        void this.load();
    }

    private goToPage(index: number): void {
        if (index < 1 || this.loading) return;
        this.pageIndex = index;
        this.selected = 0;
        this.listOffset = 0;
        this.reload();
    }

    private setDifficulty(value: DifficultyFilter): void {
        if (this.difficulty === value) return;
        this.difficulty = value;
        this.catalog = undefined;
        this.pageIndex = 1;
        this.selected = 0;
        this.listOffset = 0;
        this.reload();
    }

    private setScope(value: ScopeFilter): void {
        if (this.scope === value) return;
        this.scope = value;
        this.catalog = undefined;
        this.pageIndex = 1;
        this.selected = 0;
        this.listOffset = 0;
        this.reload();
    }

    private open(): void {
        if (this.loading || !this.confirmed()) {
            this.notice = this.loading ? "正在搜索，结果确认后再打开。" : "当前显示的不是该条件的结果，请重试或修改条件后再打开。";
            this.tui.requestRender();
            return;
        }
        const item = this.items[this.selected];
        if (!item) return;
        this.done(item.summary);
    }

    private moveChip(delta: number): void {
        const total = this.chips().length;
        this.chip = (this.chip + delta + total) % total;
    }

    private applyChip(): void {
        const target = this.chips()[this.chip];
        if (!target) return;
        if (target.kind === "difficulty") this.setDifficulty(target.value as DifficultyFilter);
        else this.setScope(target.value as ScopeFilter);
    }

    handleInput(data: string): void {
        if (this.disposed) return;
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
            this.done(undefined);
            return;
        }
        if (this.error && matchesKey(data, "ctrl+r")) {
            this.reload();
            return;
        }
        if (this.focus === "search") {
            if (matchesKey(data, "down")) {
                this.focus = "list";
                this.searchInput.focused = false;
                this.tui.requestRender();
                return;
            }
            if (matchesKey(data, "tab")) {
                this.focus = "filters";
                this.searchInput.focused = false;
                this.tui.requestRender();
                return;
            }
            const before = this.searchInput.getValue();
            this.searchInput.handleInput(data);
            if (this.searchInput.getValue() !== before) {
                this.query = this.searchInput.getValue();
                this.scheduleSearch();
            }
            else this.tui.requestRender();
            return;
        }
        if (this.focus === "filters") {
            if (matchesKey(data, "left")) this.moveChip(-1);
            else if (matchesKey(data, "right")) this.moveChip(1);
            else if (matchesKey(data, "enter") || matchesKey(data, "space")) this.applyChip();
            else if (matchesKey(data, "tab")) this.focus = "list";
            else if (matchesKey(data, "up")) this.focus = "search";
            this.tui.requestRender();
            return;
        }
        if (matchesKey(data, "up")) this.selected = Math.max(0, this.selected - 1);
        else if (matchesKey(data, "down")) this.selected = Math.min(Math.max(0, this.items.length - 1), this.selected + 1);
        else if (matchesKey(data, "enter")) {
            if (!this.items.length && !this.exhausted && !this.loading) this.reload();
            else this.open();
            return;
        }
        else if (matchesKey(data, "tab")) this.focus = "search";
        else if (matchesKey(data, "pageDown") || matchesKey(data, "right")) this.goToPage(this.shownPage + 1);
        else if (matchesKey(data, "pageUp") || matchesKey(data, "left")) this.goToPage(this.shownPage - 1);
        this.tui.requestRender();
    }

    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        if (this.disposed || event.width !== this.renderedWidth) return;
        if (event.button !== "left" || !["press", "click"].includes(event.type)) return;
        const region = this.regions.find(item => event.y === item.y && event.x >= item.start && event.x < item.end);
        if (!region) return;
        if (event.type === "press") return { handled: true, capture: true };
        if ((event.clickCount ?? 1) !== 1) return { handled: true };
        switch (region.kind) {
            case "search":
                this.focus = "search";
                this.searchInput.focused = true;
                break;
            case "chip": {
                const [kind, value] = String(region.value).split(":");
                const index = this.chips().findIndex(item => item.key === `${kind}:${value}`);
                if (index < 0) break;
                this.chip = index;
                if (kind === "difficulty") this.setDifficulty(value as DifficultyFilter);
                else this.setScope(value as ScopeFilter);
                break;
            }
            case "row": {
                const index = Number(region.value);
                if (index === this.selected && (event.clickCount ?? 1) === 2) {
                    this.selected = index;
                    this.open();
                    return { handled: true };
                }
                this.focus = "list";
                this.selected = index;
                break;
            }
            case "open":
                this.open();
                break;
            case "load":
                this.reload();
                break;
            case "prev":
                this.goToPage(this.shownPage - 1);
                break;
            case "next":
                this.goToPage(this.shownPage + 1);
                break;
            case "cancel":
                this.done(undefined);
                break;
            case "retry":
                this.reload();
                break;
        }
        this.tui.requestRender();
        return { handled: true };
    }

    private filterSection(width: number): { lines: string[]; regions: RelativeRegion[] } {
        const theme = this.theme;
        const chips = this.chips();
        const build = (prefix: string, indices: number[]): { text: string; regions: RelativeRegion[]; width: number } => {
            let text = `${prefix} `;
            const regions: RelativeRegion[] = [];
            for (const index of indices) {
                const chip = chips[index];
                if (!chip) continue;
                if (regions.length) text += " ";
                const label = `[${chip.label}]`;
                const styled = chip.active ? theme.fg("accent", label) : theme.fg("muted", label);
                const cursor = this.focus === "filters" && this.chip === index ? `\x1b[1m${styled}\x1b[22m` : styled;
                const start = visibleWidth(text);
                text += cursor;
                regions.push({ line: 0, start, end: start + visibleWidth(label), kind: "chip", value: chip.key });
            }
            return { text, regions, width: visibleWidth(text) };
        };
        const first = build("难度", [0, 1, 2, 3]);
        const second = build("权限", [4, 5]);
        if (first.width + 2 + second.width <= width) {
            const offset = first.width + 2;
            return {
                lines: [truncateToWidth(first.text + "  " + second.text, width)],
                regions: [...first.regions, ...second.regions.map(region => ({ ...region, start: region.start + offset, end: region.end + offset }))],
            };
        }
        return {
            lines: [truncateToWidth(first.text, width), truncateToWidth(second.text, width)],
            regions: [...first.regions, ...second.regions.map(region => ({ ...region, line: 1 }))],
        };
    }

    private listRow(item: PickerItem, index: number, width: number): string {
        const marker = index === this.selected ? "▸ " : "  ";
        const title = `${item.exact ? "★ " : ""}${item.summary.id} · ${item.summary.title}`;
        const right = [difficultyLabel(item.summary.difficulty), ...(item.summary.paid ? ["会员"] : []), localStatusLabels[item.status]].join(" · ");
        const rightWidth = visibleWidth(right);
        const room = Math.max(4, width - rightWidth - 3);
        const body = padded(truncateToWidth(marker + title, room, "…"), Math.max(0, width - rightWidth - 2));
        const line = body + "  " + right;
        return index === this.selected ? this.theme.fg("accent", line) : line;
    }

    render(width: number): string[] {
        this.renderedWidth = width;
        this.regions = [];
        const height = this.tui.terminal.rows;
        const theme = this.theme;
        if (width < 32 || height < 16) {
            return ["终端过小，请扩大至至少 32×16。", "Esc 取消选题"].map(line => truncateToWidth(line, width));
        }
        const head: string[] = [];
        const headRegions: RelativeRegion[] = [];
        this.searchInput.focused = this.focused && this.focus === "search";
        head.push(this.searchInput.render(width)[0] ?? "");
        headRegions.push({ line: 0, start: 0, end: width, kind: "search" });
        const filters = this.filterSection(width);
        const filterBase = head.length;
        head.push(...filters.lines);
        headRegions.push(...filters.regions.map(region => ({ ...region, line: region.line + filterBase })));

        const parts = [`第 ${this.shownPage} 页`];
        if (this.scope === "free") parts.push(`免费 ${this.visibleCount} 条${this.hasNext && !this.exhausted ? "+" : ""}`);
        else if (this.total !== undefined) parts.push(`共 ${this.total} 条`);
        if (this.loading) parts.push("搜索中…");
        else if (this.error) parts.push("上次查询失败");
        else if (this.notice) parts.push(this.notice);

        if (this.shownKey !== undefined && !this.confirmed()) parts.push("显示上一次结果");
        head.push(truncateToWidth(theme.fg("muted", parts.join(" · ")), width));
        head.push(truncateToWidth(theme.fg("dim", width >= 64 ? localStatusHint : "状态来自本机记录"), width));

        const tail: string[] = [];
        const tailRegions: RelativeRegion[] = [];
        const awaitingMore = !this.items.length && !this.exhausted && !this.loading && !this.error;
        const buttons: { label: string; kind: RegionKind; enabled: boolean }[] = [
            { label: "打开所选", kind: "open", enabled: this.items.length > 0 && !this.loading && this.confirmed() },
            ...(awaitingMore ? [{ label: "继续加载", kind: "load" as const, enabled: true }] : []),
            { label: "← 上一页", kind: "prev", enabled: this.hasPrevious },
            { label: "下一页 →", kind: "next", enabled: this.hasNext },
            { label: "取消", kind: "cancel", enabled: true },
        ];
        let row = "";
        for (const button of buttons) {
            const label = `[${button.label}]`;
            if (row && visibleWidth(row) + 2 + visibleWidth(label) > width) {
                tail.push(truncateToWidth(row, width));
                row = "";
            }
            const start = row ? visibleWidth(row) + 2 : 0;
            if (button.enabled) tailRegions.push({ line: tail.length, start, end: start + visibleWidth(label), kind: button.kind });
            row += (row ? "  " : "") + (button.enabled ? theme.fg("accent", label) : theme.fg("dim", label));
        }
        if (row) tail.push(truncateToWidth(row, width));
        tail.push(truncateToWidth(theme.fg("muted", "↑↓ 选择 · Enter 打开 · ←→ 翻页 · Tab 切换筛选/搜索 · Esc 取消"), width));

        const errorLine = this.error ? truncateToWidth(theme.fg("error", `查询失败：${this.error}  [重试]`), width) : undefined;
        const errorRegions: RelativeRegion[] = [];
        if (errorLine) {
            const prefix = `查询失败：${this.error}  `;
            errorRegions.push({ line: 0, start: visibleWidth(prefix), end: visibleWidth(prefix) + visibleWidth("[重试]"), kind: "retry" });
        }

        const reserved = head.length + tail.length + (errorLine ? 1 : 0);
        const listHeight = Math.max(1, height - reserved);
        const listLines: string[] = [];
        const listRegions: RelativeRegion[] = [];
        if (!this.items.length) {
            const message = this.loading ? "正在读取题库…" : this.error ? "" :
                this.exhausted ? "未找到匹配的题目，可直接修改关键词或筛选。" :
                    "当前范围内尚未找到匹配题目，仍有更多结果可继续加载。";
            if (message) listLines.push(truncateToWidth(theme.fg("muted", "  " + message), width));
        }
        else {
            if (this.selected < this.listOffset) this.listOffset = this.selected;
            if (this.selected >= this.listOffset + listHeight) this.listOffset = this.selected - listHeight + 1;
            this.listOffset = Math.max(0, Math.min(this.listOffset, Math.max(0, this.items.length - listHeight)));
            for (let i = this.listOffset; i < Math.min(this.items.length, this.listOffset + listHeight); i++) {
                const item = this.items[i];
                if (!item) continue;
                listLines.push(this.listRow(item, i, width));
                listRegions.push({ line: listLines.length - 1, start: 0, end: width, kind: "row", value: i });
            }
        }

        const lines = [...head, ...(errorLine ? [errorLine] : []), ...listLines, ...tail];
        const errorOffset = head.length;
        const listOffset = errorOffset + (errorLine ? 1 : 0);
        const tailOffset = listOffset + listLines.length;
        this.regions = [
            ...headRegions,
            ...errorRegions.map(region => ({ ...region, line: region.line + errorOffset })),
            ...listRegions.map(region => ({ ...region, line: region.line + listOffset })),
            ...tailRegions.map(region => ({ ...region, line: region.line + tailOffset })),
        ].map(region => ({ y: region.line, start: region.start, end: region.end, kind: region.kind, value: region.value }));
        return lines.slice(0, Math.max(1, height)).map(line => truncateToWidth(line, width));
    }

    invalidate(): void {
        this.searchInput.invalidate();
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.timer);
    }
}

/** Open the shared picker used by both `/leet pick` and the workbench F8 action. */
export async function openProblemPicker(ctx: ExtensionCommandContext, options: PickerOptions): Promise<ProblemSummary | undefined> {
    return ctx.ui.custom<ProblemSummary | undefined>((tui, theme, _keybindings, done) => new ProblemPicker(tui, theme, options, done), {
        overlay: true,
        overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 },
    });
}

export type { PickerItem };
