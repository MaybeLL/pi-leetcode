import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { Workspace } from "../src/workspace.js";
import { Workbench, type WorkbenchAction } from "../src/workbench.js";
initTheme("dark", false);
const theme = { fg: (_color: string, text: string) => text } as Theme;
async function fixture(t: {
    after: (callback: () => Promise<void>) => void;
}, width = 120, height = 30) {
    const root = await mkdtemp(join(tmpdir(), "pi-leetcode-ui-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new Workspace(root);
    await store.initialize();
    const practice = await store.open();
    let resolved: WorkbenchAction | undefined;
    const tui = { terminal: { rows: height, columns: width }, requestRender() { } } as unknown as TUI;
    const screen = new Workbench(tui, theme, practice, store, "light", action => { resolved = action; });
    screen.focused = true;
    return { store, practice, screen, tui, resolved: () => resolved };
}
async function eventually(predicate: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 100; i++) {
        if (await predicate())
            return;
        await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("operation did not complete");
}
test("wide and narrow Chinese layouts fit the terminal and retain visible navigation", async (t) => {
    const { screen, tui } = await fixture(t);
    for (const [width, height] of [[153, 51], [120, 30], [80, 24], [40, 16], [32, 16]]) {
        Object.assign(tui.terminal, { rows: height, columns: width });
        const lines = screen.render(width!);
        assert.ok(lines.length <= height!, `${lines.length} exceeds ${height}`);
        assert.ok(lines.every(line => visibleWidth(line) <= width!));
        assert.match(lines.join("\n"), /Esc/);
        assert.match(lines.join("\n"), /F5/);
        assert.match(lines.join("\n"), /F6/);
        assert.equal(lines.length, height, "overlay covers underlying Pi footer");
    }
});
test("typing and Enter edit code, save before help, and restore the cursor on return", async (t) => {
    const { screen, practice, store, tui, resolved } = await fixture(t, 80, 24);
    practice.view.view = "code";
    practice.view.cursor = { line: 2, col: 4 };
    screen.render(80);
    screen.handleInput("界");
    screen.handleInput("\r");
    screen.handleInput("注释");
    screen.handleInput("\x08"); // Ctrl+H: help, not a code character.
    await eventually(() => resolved() === "help");
    const saved = await store.read();
    assert.match(saved.code, /界\n注释/);
    assert.equal(saved.view.view, "code");
    const returned = new Workbench(tui, theme, saved, store, "light", () => { });
    returned.focused = true;
    returned.render(80);
    returned.handleInput("X");
    returned.handleInput("\x13"); // Ctrl+S
    await eventually(async () => (await store.read()).code.includes("注释X"));
});
test("switching views does not insert shortcut characters or submit chat", async (t) => {
    const { screen, practice, store } = await fixture(t);
    screen.render(120);
    screen.handleInput("\x1bOQ"); // Removed F2 is not a separate page.
    assert.equal(practice.view.view, "problem");
    screen.handleInput("\r");
    assert.equal(practice.view.view, "code");
    screen.handleInput("\x1bOR");
    assert.equal(practice.view.view, "results");
    screen.handleInput("\x13");
    await eventually(() => screen.render(120).join("\n").includes("已保存代码"));
    assert.equal((await store.read()).code, practice.code);
});
test("demo preview is explicit and becomes stale when code changes", async (t) => {
    const { screen } = await fixture(t);
    screen.render(120);
    screen.handleInput("\x12");
    await eventually(() => screen.render(120).join("\n").includes("固定失败结果已加载"));
    assert.match(screen.render(120).join("\n"), /没有执行当前代码/);
    screen.handleInput("\x1b[1;2Z"); // No reliance on a particular Shift+Tab encoding.
    screen.handleInput("\x1bOP"); // F1 returns to the shared practice page.
    screen.handleInput("\r");
    screen.render(120);
    screen.handleInput("X");
    screen.handleInput("\x1bOR"); // F3
    assert.match(screen.render(120).join("\n"), /代码已变化/);
});
test("save conflict keeps the draft and stays in the workbench", async (t) => {
    const { screen, practice, store, resolved } = await fixture(t);
    practice.view.view = "code";
    screen.render(120);
    screen.handleInput("草稿");
    await writeFile(join(await store.problemDirectory(), "solution.go"), "// external\n");
    screen.handleInput("\x1b"); screen.handleInput("\x1b");
    await eventually(() => screen.render(120).join("\n").includes("保存失败"));
    assert.equal(resolved(), undefined);
    assert.equal((await store.read()).code, "// external\n");
    assert.equal(screen.dirty, true);
});

test("keyboard help preserves focus and async result errors do not steal editing focus", async t => {
    const { screen, practice } = await fixture(t, 80, 24);
    practice.view.view = "code"; screen.render(80); screen.handleInput("x");
    screen.handleInput("\x1b[15~"); // F5
    assert.match(screen.render(80).join("\n"), /快捷键/);
    screen.handleInput("\x1b");
    assert.equal(practice.view.view, "code");
    screen.reportError("连接失败，可稍后恢复查询", false);
    assert.equal(practice.view.view, "code");
    assert.equal(screen.dirty, true);
    screen.handleInput("\x1bOR");
    assert.match(screen.render(80).join("\n"), /连接失败/);
});


test("inactive code pane has no fake cursor and F6 saves before entering coaching", async t => {
    const { screen, practice, store, resolved } = await fixture(t);
    practice.view.view = "problem";
    assert.doesNotMatch(screen.render(120).slice(4).join("\n"), /\x1b\[7m/);
    screen.handleInput("\r");
    assert.match(screen.render(120).slice(4).join("\n"), /\x1b\[7m/);
    screen.handleInput("// draft");
    screen.handleInput("\x1b[17~");
    await eventually(() => resolved() === "coach");
    assert.match((await store.read()).code, /draft/);
    assert.equal((await store.read()).view.view, "code");
});

test("problem examples render without fence syntax while literal example content survives", async t => {
    const { store, practice, tui } = await fixture(t, 80, 24);
    const problem = { ...store.problem, statement: "# 示例\n\n```text\n输入：[2,7]\n输出：[0,1]\n字面量：**原样 **\n```\n\n**进阶： **继续思考" };
    const workspace = new Workspace(store.home, problem);
    const screen = new Workbench(tui, theme, practice, workspace, "light", () => {});
    const text = screen.render(80).join("\n");
    assert.doesNotMatch(text, /```|\*\*进阶/);
    assert.ok(text.includes("字面量：**原样 **"));
    assert.ok(text.includes("输入：[2,7]"));
    assert.ok(text.includes("输出：[0,1]"));
});

test("Tab indents code, Shift+Tab outdents safely, and F keys retain navigation", async t => {
    const { screen, practice, store } = await fixture(t, 80, 24);
    const original = practice.code;
    practice.view.view = "code";
    practice.view.cursor = { line: 0, col: 0 };
    screen.render(80);
    screen.handleInput("\t"); screen.handleInput("\t");
    assert.equal(practice.view.view, "code");
    screen.handleInput("\x13");
    await eventually(() => !screen.dirty);
    assert.equal((await store.read()).code, "        " + original);
    screen.handleInput("\x1b[Z");
    screen.handleInput("\x13");
    await eventually(() => !screen.dirty);
    assert.equal((await store.read()).code, "    " + original);
    screen.handleInput("\x1b[Z"); screen.handleInput("\x1b[Z");
    screen.handleInput("\x13");
    await eventually(() => !screen.dirty);
    assert.equal((await store.read()).code, original, "outdent never deletes source text");
    screen.handleInput("\x1bOP"); screen.handleInput("\t");
    assert.equal(practice.view.view, "problem", "Tab is not a global page switch");
    screen.handleInput("\x1bOS"); screen.handleInput("\r"); screen.render(80);
    screen.handleInput("\t"); screen.handleInput("note"); screen.handleInput("\x13");
    await eventually(() => !screen.dirty);
    assert.match((await store.read()).notes, /    note/);
    assert.equal(practice.view.view, "notes");
});

test("core actions wrap completely, status stays separate, and selected tabs remain visible", async t => {
    const { screen, practice, tui } = await fixture(t);
    for (const [width, height] of [[153, 51], [80, 24], [32, 16]]) {
        Object.assign(tui.terminal, { rows: height, columns: width });
        for (const view of ["problem", "code", "results", "notes"] as const) {
            practice.view.view = view;
            screen.setOperation("正在判题 · 3 秒");
            const lines = screen.render(width!);
            assert.equal(lines.length, height);
            assert.ok(lines.every(line => visibleWidth(line) <= width!));
            const status = lines.findIndex(line => line.includes("状态 │"));
            assert.match(lines[status]!, /正在判题/);
            assert.doesNotMatch(lines[status]!, /Ctrl|F[1-6]|Esc/);
            const commands = lines.slice(status + 1).join("\n");
            for (const key of ["Ctrl+S", "Ctrl+R", "Ctrl+T", "Ctrl+E", "Ctrl+H", "Ctrl+G", "F6", "F5", "Esc"])
                assert.ok(commands.includes(key), `${key} missing at ${width} in ${view}`);
            assert.doesNotMatch(lines[2]!, /\x1b\[7m|F2/); // Selected page is not keyboard focus.
            for (const key of ["F1", "F3", "F4"]) assert.ok(lines[2]!.includes(key));
            assert.ok(lines[2]!.includes(`● F${view === "results" ? 3 : view === "notes" ? 4 : 1}`));
            assert.equal((lines[3]!.match(/\x1b\[7m/g) ?? []).length, 1, "only the active pane heading is filled");
        }
    }
});


test("long code keeps the active caret visible above the wrapped action area", async t => {
    const { practice, store, tui } = await fixture(t, 32, 16);
    practice.code = Array.from({ length: 30 }, (_, i) => `line${i}`).join("\n");
    practice.view.view = "code";
    practice.view.cursor = { line: 29, col: 0 };
    const screen = new Workbench(tui, theme, practice, store, "light", () => {});
    screen.focused = true;
    const lines = screen.render(32);
    assert.match(lines.slice(3).join("\n"), /\x1b\[7ml\x1b\[0mine29/);
    assert.equal(lines.length, 16);
});

test("practice opens readable, Enter edits directly, Esc restores reading without saving, and the next Esc saves", async t => {
    for (const width of [120, 80, 32]) {
        const { screen, practice, store, resolved } = await fixture(t, width, 24);
        const original = practice.code;
        practice.view.cursor = { line: 0, col: 0 };
        const bar = screen.render(width)[2];
        screen.handleInput("\x1b[B"); // No Enter required to scroll the statement.
        assert.equal(practice.view.problemOffset, 1);
        screen.handleInput("\r"); screen.render(width);
        assert.equal(practice.view.view, "code");
        assert.equal(screen.dirty, false, "entering code must not insert a newline");
        assert.equal(screen.render(width)[2], bar, "reading and editing share one page");
        screen.handleInput("X"); screen.handleInput("\r"); screen.handleInput("Y");
        screen.handleInput("\x1b");
        assert.equal(resolved(), undefined);
        assert.equal(practice.view.view, "problem");
        assert.equal(practice.view.problemOffset, 1);
        assert.equal((await store.read()).code, original, "first Esc does not save or leave");
        assert.match(screen.render(width).join("\n"), /阅读中/);
        assert.doesNotMatch(screen.render(width).slice(4).join("\n"), /\x1b\[7m/);
        screen.handleInput("ignored"); screen.handleInput("\t");
        screen.handleInput("\x1b[C"); screen.handleInput("\x1b[D");
        assert.equal(practice.view.view, "problem", "left reverses the preceding right page switch");
        screen.handleInput("\r"); screen.render(width);
        screen.handleInput("Z");
        screen.handleInput("\x1b"); screen.handleInput("\x1b");
        await eventually(() => resolved() === "close");
        assert.equal((await store.read()).code, "X\nYZ" + original, "editor cursor is retained across reading");
        assert.equal((await store.read()).view.view, "problem");
    }
});

test("F keys and mouse pages need no enter layer; help restores reading or editing", async t => {
    const { screen, practice } = await fixture(t);
    screen.render(120);
    for (const [key, view] of [["\x1bOP", "problem"], ["\x1bOR", "results"], ["\x1bOS", "notes"]] as const) {
        screen.handleInput(key);
        assert.equal(practice.view.view, view);
        screen.handleInput("\x1b[15~");
        assert.doesNotMatch(screen.render(120).join("\n"), /F2 代码|Enter 进入/);
        screen.handleInput("\x1b");
        assert.equal(practice.view.view, view);
        if (view !== "problem") {
            screen.handleInput("\x1b");
            assert.equal(practice.view.view, "problem");
        }
    }
    screen.handleInput("\r"); screen.render(120);
    screen.handleInput("\x1b[15~"); screen.handleInput("\x1b");
    assert.equal(practice.view.view, "code");
    assert.match(screen.render(120).join("\n"), /编辑代码/);
});

test("reading arrows cycle every page both ways without entering an editor", async t => {
    const { screen, practice, tui } = await fixture(t);
    for (const width of [120, 80, 32]) {
        Object.assign(tui.terminal, { columns: width, rows: 24 });
        screen.handleInput("\x1bOP"); screen.render(width);
        for (const view of ["results", "notes", "problem", "results", "notes", "problem"] as const) {
            screen.handleInput("\x1b[C");
            assert.equal(practice.view.view, view);
            const text = screen.render(width).join("\n");
            assert.match(text, /←\/→ 切页/);
            assert.equal(practice.view.notesEditing, false);
            screen.handleInput("not an edit");
            assert.equal(screen.dirty, false);
        }
        for (const view of ["notes", "results", "problem"] as const) {
            screen.handleInput("\x1b[D");
            assert.equal(practice.view.view, view);
        }
    }
});

test("notes have independent reading and editing states with draft, scroll, and cursor preservation", async t => {
    const { practice, store, tui } = await fixture(t, 80, 24);
    practice.notes = Array.from({ length: 30 }, (_, i) => `笔记 ${i}\n`).join("\n");
    await store.save(practice, await store.read());
    const screen = new Workbench(tui, theme, practice, store, "light", () => {});
    screen.focused = true;
    screen.handleInput("\x1bOS");
    assert.match(screen.render(80).join("\n"), /笔记 · 阅读中/);
    screen.handleInput("ignored"); screen.handleInput("\t");
    assert.equal(screen.dirty, false);
    screen.handleInput("\x1b[B");
    assert.equal(practice.view.notesOffset, 1);
    screen.handleInput("\r"); screen.render(80);
    assert.equal(screen.dirty, false, "entering notes does not insert a newline");
    screen.handleInput("AB"); screen.handleInput("\x1b[D"); screen.handleInput("X");
    screen.handleInput("\x1b[C"); screen.handleInput("Y"); screen.handleInput("\r");
    assert.equal(practice.view.view, "notes", "editing arrows must not switch pages");
    screen.handleInput("\x1b");
    assert.equal(practice.view.view, "notes", "Esc returns to this page, not the problem");
    assert.equal(practice.view.notesEditing, false);
    assert.equal(practice.view.notesOffset, 1);
    assert.doesNotMatch(screen.render(80).slice(4).join("\n"), /\x1b\[7m/, "reading has no editor caret");
    practice.view.notesOffset = 10000;
    assert.match(screen.render(80).join("\n"), /AXBY/, "reading displays unsaved notes");
    const offset = practice.view.notesOffset;
    screen.handleInput("\x1b[C"); screen.handleInput("\x1b[D");
    assert.equal(practice.view.notesOffset, offset, "page switching preserves reading position");
    screen.handleInput("\r"); screen.render(80); screen.handleInput("Z");
    screen.handleInput("\x1b[15~"); screen.handleInput("\x1b");
    assert.equal(practice.view.notesEditing, true, "help returns to editing");
    screen.handleInput("\x13");
    await eventually(() => !screen.dirty);
    const saved = await store.read();
    assert.match(saved.notes, /AXBY\nZ/);
    assert.equal(saved.view.notesEditing, true);
    const returned = new Workbench(tui, theme, saved, store, "light", () => {});
    returned.focused = true;
    assert.match(returned.render(80).join("\n"), /笔记 · 编辑中/);
    returned.handleInput("\x1b");
    assert.equal(saved.view.view, "notes");
    returned.handleInput("\x1b");
    assert.equal(saved.view.view, "problem");
});

test("result arrows switch pages while Shift+arrows select bounded test cases", async t => {
    const { screen, practice } = await fixture(t);
    const record = {
        source: "leetcode" as const, id: "fixture", kind: "run" as const, createdAt: "fixture", account: "fixture",
        slug: "two-sum", code: practice.code, codeHash: "fixture", input: "[1]", inputs: ["[1]", "[2]"],
        state: "complete" as const, message: "完成", result: { verdict: "样例通过" },
    };
    screen.setExecution(record);
    screen.handleInput("\x1bOR");
    for (const [key, index] of [["\x1b[1;2C", 1], ["\x1b[1;2C", 1], ["\x1b[1;2D", 0], ["\x1b[1;2D", 0]] as const) {
        screen.handleInput(key);
        assert.equal(practice.view.view, "results");
        assert.equal(practice.view.caseIndex, index);
    }
    screen.handleInput("\r");
    assert.equal(practice.view.view, "results", "Enter on results does not start editing");
    assert.match(screen.render(120).join("\n"), /Shift\+←\/→/);
    screen.handleInput("\x1b[C");
    assert.equal(practice.view.view, "notes");
    assert.equal(practice.view.caseIndex, 0);
    for (const state of ["pending", "unknown", "failed", "complete"] as const) {
        screen.setExecution({ ...record, state });
        assert.equal(practice.view.view, "notes", "background updates do not steal focus");
        screen.handleInput("\x1bOR");
        assert.doesNotMatch(screen.render(120).join("\n"), /F2/);
        screen.handleInput("\x1b[C");
    }
});

test("mouse tabs use rendered cell bounds after resize and ignore non-tab or modal clicks", async t => {
    const { screen, practice, tui } = await fixture(t);
    for (const width of [120, 80, 32]) {
        Object.assign(tui.terminal, { columns: width });
        for (const [key, view] of [["F1", "problem"], ["F3", "results"], ["F4", "notes"]] as const) {
            const bar = screen.render(width)[2]!.replace(/\x1b\[[0-9;]*m/g, "");
            const x = visibleWidth(bar.slice(0, bar.indexOf(key)));
            const event = { type: "press" as const, button: "left" as const, x, y: 2, screenX: x + 40, screenY: 12,
                width, height: tui.terminal.rows, shift: false, alt: false, ctrl: false };
            assert.deepEqual(screen.handleMouse(event), { handled: true, focus: true });
            assert.equal(practice.view.view, view);
            assert.doesNotMatch(screen.render(width).join("\n"), /页签导航中/);
            assert.equal(screen.handleMouse({ ...event, y: 3 }), undefined);
            assert.equal(screen.handleMouse({ ...event, button: "right" }), undefined);
            screen.handleInput("\x1b[15~");
            assert.equal(screen.handleMouse(event), undefined);
            screen.handleInput("\x1b");
        }
    }
});

test("clicking the displayed original problem link opens it instead of doing nothing", async t => {
    const { store, practice, tui } = await fixture(t, 120, 30);
    const statement = "# 题意\n\n说明\n\n[在 LeetCode 查看原题](https://leetcode.cn/problems/two-sum/)";
    const problem = { ...store.problem, source: "leetcode" as const, statement, inputs: ["[2,7]\n9"] };
    const workspace = new Workspace(store.home, problem);
    await workspace.open();
    let action: string | undefined;
    const screen = new Workbench(tui, theme, practice, workspace, "light", value => { action = value; });
    const lines = screen.render(120).map(line => line.replace(/\x1b\[[0-9;]*m/g, ""));
    const y = lines.findIndex(line => line.includes("在 LeetCode"));
    assert.ok(y > 3);
    const x = visibleWidth(lines[y]!.slice(0, lines[y]!.indexOf("在 LeetCode")));
    const result = screen.handleMouse({ type: "click", button: "left", x, y, screenX: x, screenY: y,
        width: 120, height: 30, shift: false, alt: false, ctrl: false });
    assert.equal(result?.handled, true);
    await eventually(() => action === "original");
});


test("original-link hit regions follow scrolling, wrapping and split panes; one gesture opens once", async t => {
    const { store, tui } = await fixture(t);
    const statement = Array.from({ length: 40 }, (_, i) => `段落 ${i}\n`).join("\n") +
        "\n[在 LeetCode 查看原题](https://leetcode.cn/problems/two-sum/)";
    const workspace = new Workspace(store.home, { ...store.problem, source: "leetcode", statement });
    await workspace.open();
    for (const width of [153, 80, 32]) {
        Object.assign(tui.terminal, { columns: width });
        const practice = await workspace.read();
        practice.view.problemOffset = 0;
        practice.view.view = "problem";
        const actions: string[] = [];
        const screen = new Workbench(tui, theme, practice, workspace, "light", value => actions.push(value));
        screen.render(width);
        const event = { type: "click" as const, button: "left" as const, x: 3, y: 8, screenX: 3, screenY: 8,
            width, height: 30, shift: false, alt: false, ctrl: false };
        assert.equal(screen.handleMouse(event), undefined, "body text is not a link");
        practice.view.problemOffset = 10000;
        if (width >= 100) practice.view.view = "code";
        const lines = screen.render(width).map(line => line.replace(/\x1b\[[0-9;]*m/g, ""));
        const y = lines.findIndex(line => line.includes("在 LeetCode"));
        assert.ok(y >= 4);
        assert.equal(screen.handleMouse({ ...event, y, x: width - 1 }), undefined, "pane border is not clickable");
        assert.equal(screen.handleMouse({ ...event, y, button: "right" }), undefined);
        assert.deepEqual(screen.handleMouse({ ...event, y, type: "press" }), { handled: true, capture: true });
        assert.equal(actions.length, 0, "press alone must not launch a browser");
        screen.handleMouse({ ...event, y });
        await eventually(() => actions.length === 1);
        screen.handleMouse({ ...event, y, clickCount: 2 });
        assert.deepEqual(actions, ["original"]);
        const urlRow = lines.findIndex(line => line.includes("https://leetcode"));
        assert.ok(urlRow >= 4);
        screen.handleMouse({ ...event, y: urlRow });
        await eventually(() => actions.length === 2);
        practice.view.view = "results"; screen.render(width);
        assert.equal(screen.handleMouse({ ...event, y }), undefined, "hidden statement has no stale hit region");
        screen.dispose();
    }
});

test("a real problem retains editable content and all actions at the minimum viewport", async t => {
    const { store, practice, tui } = await fixture(t, 32, 16);
    const workspace = new Workspace(store.home, { ...store.problem, source: "leetcode" });
    const screen = new Workbench(tui, theme, practice, workspace, "light", () => {});
    screen.focused = true;
    for (const view of ["problem", "code", "results", "notes"] as const) {
        practice.view.view = view;
        practice.view.notesEditing = view === "notes";
        const lines = screen.render(32);
        assert.equal(lines.length, 16);
        assert.ok(lines.every(line => visibleWidth(line) <= 32));
        const bottom = lines.findIndex(line => line.startsWith("╰"));
        assert.ok(bottom > 4, `at least one content row in ${view}`);
        if (view === "code" || view === "notes")
            assert.match(lines.slice(4, bottom).join("\n"), /\x1b\[7m/, "editing caret is visible");
        for (const label of ["F7 去leetcode查看原题", "F8 选题", "Esc", "Ctrl+S", "Ctrl+R", "Ctrl+T"])
            assert.ok(lines.join("\n").includes(label), `${label} is visible in ${view}`);
    }
});

test("the action bar spells out the original link, offers a clickable F8 选题, and wraps without losing meaning", async (t) => {
    const { store, tui } = await fixture(t);
    const statement = `# 1 · 两数之和\n\n题意\n\n[在 LeetCode 查看原题](https://leetcode.cn/problems/two-sum/)`;
    const workspace = new Workspace(store.home, { ...store.problem, source: "leetcode", statement });
    await workspace.open();
    const practice = await workspace.read();
    const actions: WorkbenchAction[] = [];
    const screen = new Workbench(tui, theme, practice, workspace, "light", action => { actions.push(action); });
    screen.focused = true;
    for (const width of [153, 80, 32]) {
        Object.assign(tui.terminal, { rows: 24, columns: width });
        const lines = screen.render(width).map(line => line.replace(/\x1b\[[0-9;]*m/g, ""));
        const text = lines.join("\n");
        assert.match(text, /F7 去leetcode查看原题/, `full F7 label at ${width}`);
        assert.match(text, /F8 选题/, `F8 action at ${width}`);
        assert.ok(lines.every(line => visibleWidth(line) <= width), `no overflow at ${width}`);
    }
    Object.assign(tui.terminal, { rows: 24, columns: 80 });
    const lines = screen.render(80).map(line => line.replace(/\x1b\[[0-9;]*m/g, ""));
    const y = lines.findIndex(line => line.includes("F8 选题"));
    assert.ok(y >= 0);
    const x = visibleWidth(lines[y]!.slice(0, lines[y]!.indexOf("F8 选题"))) + 1;
    const event = { type: "click" as const, button: "left" as const, x, y, screenX: x, screenY: y, width: 80, height: 30, shift: false, alt: false, ctrl: false };
    assert.deepEqual(screen.handleMouse({ ...event, type: "press" }), { handled: true, capture: true });
    assert.equal(actions.length, 0, "press alone must not switch problems");
    screen.handleMouse(event);
    await eventually(() => actions.includes("pick"));
});
