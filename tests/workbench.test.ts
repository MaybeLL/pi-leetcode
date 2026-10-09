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
    screen.handleInput("\x1bOQ");
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
    screen.handleInput("\x1bOQ"); // F2
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
    screen.handleInput("\x1b");
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
    assert.doesNotMatch(screen.render(120).slice(3).join("\n"), /\x1b\[7m/);
    screen.handleInput("\x1bOQ");
    assert.match(screen.render(120).slice(3).join("\n"), /\x1b\[7m/);
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
    screen.handleInput("\x1bOS"); screen.render(80);
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
            assert.match(lines[2]!, /\x1b\[7m/);
            for (const key of ["F1", "F2", "F3", "F4"]) assert.ok(lines[2]!.includes(key));
            assert.ok(lines[2]!.includes(`▸ F${["problem", "code", "results", "notes"].indexOf(view) + 1}`));
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
