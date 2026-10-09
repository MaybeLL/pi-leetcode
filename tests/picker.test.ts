import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { ProblemPicker } from "../src/picker-ui.js";
import { ProblemCatalog } from "../src/picker.js";
import { emptyLocalStatus, type LocalStatusIndex } from "../src/local-status.js";
import type { LeetCodeBackend, ProblemSummary } from "../src/backend.js";
initTheme("dark", false);

const theme = { fg: (_color: string, text: string) => text } as Theme;

function summary(id: number | string, title: string, difficulty = "Easy", paid = false, slug?: string): ProblemSummary {
    const value = String(id);
    return { id: value, slug: slug ?? `problem-${value}`, title, difficulty, paid };
}

interface Call { keyword: string; difficulty: string; skip: number }
function catalogSearch(items: ProblemSummary[], calls: Call[] = [], delay = 0): LeetCodeBackend["search"] {
    return async (keyword = "", difficulty = "", skip = 0) => {
        calls.push({ keyword, difficulty, skip });
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        const matched = items.filter(item => {
            if (difficulty && item.difficulty.toLowerCase() !== difficulty.toLowerCase()) return false;
            if (!keyword) return true;
            return item.id === keyword || item.title.includes(keyword) || item.slug.includes(keyword);
        });
        return { items: matched.slice(skip, skip + 20), total: matched.length };
    };
}

function createPicker(search: LeetCodeBackend["search"], options: { status?: LocalStatusIndex; debounceMs?: number; width?: number; height?: number } = {}) {
    const opened: ProblemSummary[] = [];
    const tui = { terminal: { rows: options.height ?? 24, columns: options.width ?? 80 }, requestRender() { } } as unknown as TUI;
    const screen = new ProblemPicker(tui, theme, { search, status: options.status ?? emptyLocalStatus, debounceMs: options.debounceMs ?? 0 }, value => { if (value) opened.push(value); });
    screen.focused = true;
    return { screen, opened, tui };
}

async function eventually(predicate: () => boolean | Promise<boolean>, label = "state"): Promise<void> {
    for (let i = 0; i < 200; i++) {
        if (await predicate()) return;
        await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail(`did not reach ${label}`);
}

function columnOf(line: string, text: string): number {
    const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
    const index = plain.indexOf(text);
    return index < 0 ? -1 : visibleWidth(plain.slice(0, index));
}

test("catalog pages sequentially without duplicates and reports page boundaries", async () => {
    const items = Array.from({ length: 45 }, (_, i) => summary(i + 1, `题 ${i + 1}`));
    const catalog = new ProblemCatalog(catalogSearch(items), "", "", "all");
    const first = await catalog.page(1);
    assert.equal(first.items.length, 20);
    assert.equal(first.hasPrevious, false);
    assert.equal(first.hasNext, true);
    assert.equal(first.total, 45);
    const second = await catalog.page(2);
    assert.equal(second.items.length, 20);
    assert.equal(second.items[0]!.id, "21");
    const third = await catalog.page(3);
    assert.equal(third.items.length, 5);
    assert.equal(third.hasNext, false);
    const ids = [...first.items, ...second.items, ...third.items].map(item => item.id);
    assert.equal(new Set(ids).size, 45, "sequential pages never repeat or skip a problem");
});

test("free-only filtering looks past a page of paid problems instead of reporting empty", async () => {
    const items = [
        ...Array.from({ length: 20 }, (_, i) => summary(i + 1, `付费 ${i + 1}`, "Easy", true)),
        ...Array.from({ length: 5 }, (_, i) => summary(100 + i, `免费 ${i + 1}`, "Easy", false)),
    ];
    const catalog = new ProblemCatalog(catalogSearch(items), "", "", "free");
    const page = await catalog.page(1);
    assert.equal(page.items.length, 5);
    assert.ok(page.items.every(item => !item.paid));
    assert.equal(page.hasNext, false);
    assert.equal(page.visible, 5);
});

test("the first screen lists every required field and never opens a problem by itself", async () => {
    const items = [summary(1, "两数之和", "Easy", false), summary(2, "两数相加", "Hard", true)];
    const { screen, opened } = createPicker(catalogSearch(items));
    await eventually(() => screen.entries.length === 2, "initial list");
    const rendered = screen.render(80).join("\n");
    assert.match(rendered, /1 · 两数之和/);
    assert.match(rendered, /2 · 两数相加/);
    assert.match(rendered, /简单/);
    assert.match(rendered, /困难/);
    assert.match(rendered, /会员/);
    assert.match(rendered, /未练习/);
    assert.match(rendered, /第 1 页/);
    assert.match(rendered, /本机练习记录/, "status source is explained");
    assert.equal(opened.length, 0, "loading and rendering never auto-open");
});

test("typing is debounced, coalesces, and can be cleared back to browsing", async () => {
    const calls: Call[] = [];
    const items = [summary(1, "two-sum", "Easy"), summary(42, "接雨水", "Hard")];
    const { screen } = createPicker(catalogSearch(items, calls), { debounceMs: 20 });
    await eventually(() => screen.entries.length === 2, "initial browse");
    const before = calls.length;
    screen.handleInput("接");
    screen.handleInput("雨");
    screen.handleInput("水");
    await eventually(() => calls.length > before, "debounced search");
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(calls.length - before, 1, "consecutive typing coalesces into one request");
    assert.equal(calls.at(-1)!.keyword, "接雨水", "accepted Chinese title text is searchable");
    await eventually(() => !screen.isLoading && screen.entries.length === 1 && screen.entries[0]!.summary.id === "42", "filtered result");
    for (let i = 0; i < 3; i++) screen.handleInput("\x7f");
    await eventually(() => calls.at(-1)!.keyword === "", "cleared keyword requests browse again");
    await eventually(() => screen.entries.length === 2, "clearing restores the default list");
});

test("a pure question number pins the exact row first without duplicates", async () => {
    const others = Array.from({ length: 25 }, (_, i) => summary(20 + i, `题目 ${20 + i}`));
    const exact = summary(2, "两数之和", "Easy", false, "two-sum");
    const { screen } = createPicker(catalogSearch([...others, exact]));
    await eventually(() => screen.entries.length > 0, "initial list");
    screen.handleInput("2");
    await eventually(() => screen.entries.some(entry => entry.exact), "exact match pinned");
    assert.equal(screen.entries[0]!.summary.id, "2");
    assert.equal(screen.entries.filter(entry => entry.summary.id === "2").length, 1, "no duplicate row");
    assert.ok(screen.entries.length > 1, "other matches remain browsable");
});

test("a late response from a replaced query never overwrites the current results", async () => {
    const stale = summary(900, "旧查询结果");
    const current = summary(901, "新查询结果");
    const browse = summary(902, "默认浏览");
    const log: string[] = [];
    const search: LeetCodeBackend["search"] = async (keyword = "") => {
        log.push(keyword);
        if (keyword.endsWith("a")) {
            await new Promise(resolve => setTimeout(resolve, 80));
            return { items: [stale], total: 1 };
        }
        if (keyword.endsWith("b")) {
            await new Promise(resolve => setTimeout(resolve, 5));
            return { items: [current], total: 1 };
        }
        return { items: [browse], total: 1 };
    };
    const { screen } = createPicker(search, { debounceMs: 0 });
    await eventually(() => screen.entries[0]?.summary.id === "902", "browse results");
    screen.handleInput("a");
    await eventually(() => log.includes("a"), "slow query started");
    screen.handleInput("b");
    await eventually(() => screen.entries[0]?.summary.id === "901", "current results");
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.equal(screen.entries[0]!.summary.id, "901", "the late old response is dropped");
    assert.equal(screen.failure, undefined);
});

test("a failed request shows the reason with a retry entry and keeps the filters", async () => {
    let attempts = 0;
    const search: LeetCodeBackend["search"] = async () => {
        if (attempts++ === 0) throw new Error("网络中断");
        return { items: [summary(1, "两数之和")], total: 1 };
    };
    const { screen } = createPicker(search);
    await eventually(() => screen.failure !== undefined, "failure state");
    const rendered = screen.render(80).join("\n");
    assert.match(rendered, /查询失败/);
    assert.match(rendered, /网络中断/);
    assert.match(rendered, /重试/);
    assert.match(rendered, /难度/, "filters remain visible after failure");
    screen.handleInput("\x12"); // Ctrl+R retry
    await eventually(() => screen.entries.length === 1, "retry succeeds");
    assert.equal(screen.failure, undefined);
});

test("an empty result explains that nothing matched and stays editable", async () => {
    const { screen } = createPicker(catalogSearch([]));
    await eventually(() => screen.isLoading === false && screen.failure === undefined, "empty result");
    const rendered = screen.render(80).join("\n");
    assert.match(rendered, /未找到匹配的题目/);
    assert.match(rendered, /搜索/);
});

test("keyboard can select, page, filter, and open the current row", async () => {
    const calls: Call[] = [];
    const items = [
        ...Array.from({ length: 25 }, (_, i) => summary(i + 1, `简单题 ${i + 1}`, "Easy")),
        summary(200, "困难题", "Hard"),
    ];
    const { screen, opened } = createPicker(catalogSearch(items, calls));
    await eventually(() => screen.entries.length === 20, "page one");
    // Down arrow enters the list; Down moves the selection.
    screen.handleInput("\x1b[B");
    assert.equal(screen.focusedArea, "list");
    screen.handleInput("\x1b[B");
    assert.equal(screen.selectedIndex, 1);
    // Page forward and back through the same query.
    screen.handleInput("\x1b[6~"); // PageDown
    await eventually(() => screen.currentPage === 2, "page two");
    assert.ok(screen.entries.length > 0);
    screen.handleInput("\x1b[5~"); // PageUp
    await eventually(() => screen.currentPage === 1, "page one again");
    // Tab returns to the search box, then into the filters; Right chooses 简单.
    screen.handleInput("\t");
    assert.equal(screen.focusedArea, "search");
    screen.handleInput("\t");
    assert.equal(screen.focusedArea, "filters");
    screen.handleInput("\x1b[C");
    screen.handleInput("\r");
    await eventually(() => calls.some(call => call.keyword === "" && call.difficulty === "EASY"), "difficulty filter");
    await eventually(() => !screen.isLoading && screen.entries.length > 0 && screen.entries.every(entry => entry.summary.difficulty === "Easy"), "filtered rows");
    assert.equal(screen.currentPage, 1, "changing a filter returns to page one");
    screen.handleInput("\t");
    assert.equal(screen.focusedArea, "list");
    screen.handleInput("\r");
    assert.equal(opened.length, 1);
    assert.equal(opened[0]!.difficulty, "Easy");
});

test("mouse can click chips, select a row, and confirm the open button", async () => {
    const calls: Call[] = [];
    const items = Array.from({ length: 6 }, (_, i) => summary(i + 1, `题目 ${i + 1}`, "Easy", i % 2 === 0));
    const { screen, opened } = createPicker(catalogSearch(items, calls));
    await eventually(() => screen.entries.length === 6, "initial list");
    let lines = screen.render(80);
    const chipY = lines.findIndex(line => line.includes("[ 仅免费]"));
    const chipX = columnOf(lines[chipY]!, "[ 仅免费]");
    screen.handleMouse({ type: "click", button: "left", x: chipX + 1, y: chipY, screenX: chipX + 1, screenY: chipY, width: 80, height: 24, shift: false, alt: false, ctrl: false });
    await eventually(() => !screen.isLoading && screen.entries.length > 0 && screen.entries.every(entry => !entry.summary.paid), "free-only rows");
    assert.ok(screen.entries.length > 0);
    assert.equal(screen.focusedArea, "filters", "mouse chips move keyboard focus too");
    assert.match(screen.render(80).join("\n"), /\x1b\[7m▸\[✓仅免费\]/);
    lines = screen.render(80);
    const rowY = lines.findIndex(line => line.includes("题目 2 "));
    assert.ok(rowY >= 0);
    screen.handleMouse({ type: "click", button: "left", x: 2, y: rowY, screenX: 2, screenY: rowY, width: 80, height: 24, shift: false, alt: false, ctrl: false });
    assert.equal(screen.focusedArea, "list");
    assert.equal(screen.entries[screen.selectedIndex]!.summary.id, "2");
    lines = screen.render(80);
    const buttonY = lines.findIndex(line => line.includes("[打开所选]"));
    const buttonX = columnOf(lines[buttonY]!, "[打开所选]");
    screen.handleMouse({ type: "click", button: "left", x: buttonX + 1, y: buttonY, screenX: buttonX + 1, screenY: buttonY, width: 80, height: 24, shift: false, alt: false, ctrl: false });
    assert.equal(opened.length, 1);
    assert.equal(opened[0]!.id, "2");
    // A press alone never activates a control; the synthesized click does.
    screen.handleMouse({ type: "press", button: "left", x: buttonX + 1, y: buttonY, screenX: buttonX + 1, screenY: buttonY, width: 80, height: 24, shift: false, alt: false, ctrl: false });
    assert.equal(opened.length, 1);
});

test("wrapped filter mouse targets follow resize and retain the matching keyboard focus", async () => {
    const { screen, tui } = createPicker(catalogSearch([
        summary(1, "免费题", "Easy"), summary(2, "会员题", "Easy", true),
    ]));
    await eventually(() => !screen.isLoading);
    for (const width of [32, 80, 40]) {
        Object.assign(tui.terminal, { columns: width });
        const lines = screen.render(width);
        const y = lines.findIndex(line => line.includes("仅免费]"));
        const x = columnOf(lines[y]!, "仅免费");
        const event = { type: "click" as const, button: "left" as const, x, y, screenX: x, screenY: y,
            width, height: 24, shift: false, alt: false, ctrl: false };
        assert.equal(screen.handleMouse({ ...event, width: width + 1 }), undefined);
        assert.equal(screen.handleMouse(event)?.handled, true);
        await eventually(() => !screen.isLoading);
        assert.equal(screen.focusedArea, "filters");
        assert.match(screen.render(width).join("\n"), /\x1b\[7m▸\[✓仅免费\]/);
        assert.equal(screen.entries.length, 1);
        screen.handleInput("\x1b[D"); // The next keyboard action starts at the clicked chip.
        screen.handleInput("\r");
        await eventually(() => !screen.isLoading);
        assert.equal(screen.entries.length, 2);
    }
    screen.dispose();
});

test("escape cancels without opening, and narrow terminals stay usable", async () => {
    const items = [summary(1, "两数之和", "Easy", false), summary(2, "两数相加", "Medium", true)];
    const { screen, opened } = createPicker(catalogSearch(items), { width: 32, height: 16 });
    await eventually(() => screen.entries.length === 2, "narrow list");
    const lines = screen.render(32);
    assert.ok(lines.length <= 16);
    assert.ok(lines.every(line => visibleWidth(line) <= 32), "Chinese width never overflows the terminal");
    const rendered = lines.join("\n");
    assert.match(rendered, /两数之和/);
    assert.match(rendered, /简单/);
    assert.match(rendered, /未练习/);
    assert.match(rendered, /取消/);
    screen.handleInput("\x1b");
    assert.equal(opened.length, 0, "cancel opens nothing");
});

test("focus is distinct from applied filters and remembered selection, including narrow layouts", async () => {
    const { screen, tui } = createPicker(catalogSearch([summary(121, "买卖股票的最佳时机")]));
    await eventually(() => !screen.isLoading);
    for (const width of [153, 80, 40, 32]) {
        Object.assign(tui.terminal, { columns: width, rows: 16 });
        let lines = screen.render(width);
        assert.match(lines[0]!, /\x1b\[7m▸ 搜索/);
        assert.match(lines.join("\n"), /● 121/);
        assert.match(lines.join("\n"), /当前：搜索/);
        screen.handleInput("\t");
        for (let index = 0; index < 6; index++) {
            lines = screen.render(width);
            const text = lines.join("\n");
            assert.equal((text.match(/\x1b\[7m/g) ?? []).length, 1, "one filled focus target; no inactive input caret");
            assert.match(text, /\x1b\[7m▸\[/);
            assert.match(text, /当前：筛选/);
            assert.match(text, /Enter\/空格/);
            for (const chip of ["[✓全部]", "[ 简单]", "[ 中等]", "[ 困难]", "[ 仅免费]"])
                assert.ok(text.includes(chip), `${chip} remains reachable at ${width}`);
            assert.ok(lines.length <= 16);
            assert.ok(lines.every(line => visibleWidth(line) <= width));
            assert.match(text, /Esc 取消/);
            screen.handleInput("\x1b[C");
        }
        screen.handleInput("\t");
        lines = screen.render(width);
        assert.equal((lines.join("\n").match(/\x1b\[7m/g) ?? []).length, 1);
        assert.match(lines.join("\n"), /\x1b\[7m▸ 121/);
        const selected = lines.find(line => line.includes("▸ 121"))!;
        assert.doesNotMatch(selected.split("\x1b[27m")[0]!, /\x1b\[0m/, "truncation must not clear the row highlight");
        assert.match(lines.join("\n"), /当前：题目列表/);
        assert.doesNotMatch(lines[0]!, /\x1b\[7m/);
        screen.handleInput("\t"); // Search for the next size.
    }
    screen.dispose();
});

test("moving filter focus does not apply it until Enter, even during a pending load", async () => {
    const calls: Call[] = [];
    const { screen } = createPicker(catalogSearch([summary(121, "股票")], calls, 10));
    await eventually(() => !screen.isLoading);
    screen.handleInput("\t"); screen.handleInput("\x1b[C");
    assert.equal(calls.length, 1);
    assert.match(screen.render(80).join("\n"), /\x1b\[7m▸\[ 简单\]/);
    screen.handleInput("\r");
    assert.equal(screen.isLoading, true);
    screen.handleInput("\x1b[C");
    assert.match(screen.render(80).join("\n"), /\[✓简单\]/);
    assert.match(screen.render(80).join("\n"), /\x1b\[7m▸\[ 中等\]/);
    await eventually(() => !screen.isLoading);
    assert.equal(screen.focusedArea, "filters");
    assert.equal(calls.at(-1)!.difficulty, "EASY");
    screen.dispose();
});

test("local status is attached to each row from the injected index", async () => {
    const status: LocalStatusIndex = { get: slug => slug === "problem-1" ? "accepted" : slug === "problem-2" ? "started" : "none" };
    const items = [summary(1, "两数之和"), summary(2, "两数相加"), summary(3, "无重复字符")];
    const { screen } = createPicker(catalogSearch(items), { status });
    await eventually(() => screen.entries.length === 3, "status list");
    const rendered = screen.render(80).join("\n");
    assert.match(rendered, /曾通过/);
    assert.match(rendered, /已开始/);
    assert.match(rendered, /未练习/);
});

test("an exact question number is pinned once and never repeats on a later page", async () => {
    const others = Array.from({ length: 45 }, (_, i) => summary(200 + i, `题目 2${String(i).padStart(3, "0")}`, "Easy"));
    const exact = summary(2, "两数之和", "Easy", false, "two-sum");
    const { screen } = createPicker(catalogSearch([...others, exact]));
    await eventually(() => screen.entries.length === 20, "page one");
    screen.handleInput("2");
    await eventually(() => !screen.isLoading && screen.entries[0]?.exact === true, "exact pinned");
    assert.equal(screen.entries[0]!.summary.id, "2");
    assert.equal(screen.entries.filter(entry => entry.summary.id === "2").length, 1);
    screen.handleInput("\x1b[B"); // focus list
    screen.handleInput("\x1b[6~"); // PageDown
    await eventually(() => screen.currentPage === 2, "page two");
    assert.ok(!screen.entries.some(entry => entry.summary.id === "2"), "page two must not repeat the exact row");
});

test("free-only finds a free problem far beyond the old raw-page budget", async () => {
    const items = [
        ...Array.from({ length: 500 }, (_, i) => summary(i + 1, `付费 ${i + 1}`, "Easy", true)),
        summary(600, "免费题", "Easy", false),
    ];
    const { screen } = createPicker(catalogSearch(items));
    await eventually(() => screen.entries.length === 20, "page one");
    screen.handleInput("\t"); // filters
    for (let i = 0; i < 5; i++) screen.handleInput("\x1b[C"); // move to 仅免费
    screen.handleInput("\r");
    await eventually(() => !screen.isLoading && screen.entries.length === 1, "free item found");
    assert.equal(screen.entries[0]!.summary.id, "600");
});

test("free-only never claims no results while more raw pages remain", async () => {
    const items = [
        ...Array.from({ length: 1200 }, (_, i) => summary(i + 1, `付费 ${i + 1}`, "Easy", true)),
        summary(2000, "免费题", "Easy", false),
    ];
    const { screen } = createPicker(catalogSearch(items));
    await eventually(() => screen.entries.length === 20, "page one");
    screen.handleInput("\t");
    for (let i = 0; i < 5; i++) screen.handleInput("\x1b[C");
    screen.handleInput("\r");
    await eventually(() => !screen.isLoading && screen.entries.length === 0 && !screen.failure, "bounded scan");
    const rendered = screen.render(80).join("\n");
    assert.doesNotMatch(rendered, /未找到匹配的题目/, "must not report no results while unexhausted");
    assert.match(rendered, /继续加载/);
    assert.match(rendered, /尚未找到/);
});

test("a pending search cannot open the previous confirmed list", async () => {
    const stale = summary(900, "旧查询结果");
    const current = summary(901, "新查询结果");
    const search: LeetCodeBackend["search"] = async (keyword = "") => {
        if (keyword === "z") {
            await new Promise(resolve => setTimeout(resolve, 60));
            return { items: [current], total: 1 };
        }
        return { items: [stale], total: 1 };
    };
    const { screen, opened } = createPicker(search, { debounceMs: 0 });
    await eventually(() => !screen.isLoading && screen.entries[0]?.summary.id === "900", "initial list");
    screen.handleInput("z");
    assert.equal(screen.isLoading, true, "the new search is pending");
    screen.handleInput("\x1b[B"); // focus list
    screen.handleInput("\r"); // attempt to open while pending
    assert.equal(opened.length, 0, "a pending search must not open the previous list");
    await eventually(() => !screen.isLoading && screen.entries[0]?.summary.id === "901", "current list");
    screen.handleInput("\r");
    assert.equal(opened.length, 1);
    assert.equal(opened[0]!.id, "901");
});

test("a failed new search keeps the old list readable but not openable", async () => {
    const stale = summary(900, "旧查询结果");
    const search: LeetCodeBackend["search"] = async (keyword = "") => {
        if (keyword === "z") throw new Error("网络中断");
        return { items: [stale], total: 1 };
    };
    const { screen, opened } = createPicker(search, { debounceMs: 0 });
    await eventually(() => !screen.isLoading && screen.entries[0]?.summary.id === "900", "initial list");
    screen.handleInput("z");
    await eventually(() => !screen.isLoading && screen.failure !== undefined, "failed search");
    screen.handleInput("\x1b[B"); // focus list
    screen.handleInput("\r"); // attempt to open the old row
    assert.equal(opened.length, 0, "a failed search must not reopen the previous list");
    assert.match(screen.render(80).join("\n"), /显示上一次结果/);
    // Clearing the keyword restores browsing, and opening works again.
    screen.handleInput("\t"); // list -> search
    screen.handleInput("\x7f"); // clear "z"
    await eventually(() => !screen.isLoading && screen.failure === undefined && screen.entries[0]?.summary.id === "900", "restored browse");
    screen.handleInput("\r");
    assert.equal(opened.length, 1);
    assert.equal(opened[0]!.id, "900");
});
