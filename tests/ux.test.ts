import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/leetcode.js";
import { Workbench } from "../src/workbench.js";
import { ProblemPicker } from "../src/picker-ui.js";
import { SecretInput } from "../src/secret-input.js";
import { Workspace, codeHash } from "../src/workspace.js";
import { PlatformError, type Credentials, type LeetCodeBackend } from "../src/backend.js";
import { Executions, type Execution } from "../src/execution.js";
import { decodeJudge } from "../src/platform.js";
import { resultSummary } from "../src/results.js";
initTheme("dark", false);
const problem = {
    source: "leetcode" as const,
    id: "1",
    questionId: "1",
    slug: "two-sum",
    title: "两数之和",
    language: "Go",
    statement: "题意",
    template: "func twoSum() {}\n",
    inputs: ["[3,3]\n6", "[2,7]\n9"],
};
const theme = { fg: (_name: string, value: string) => value };
const tui = { terminal: { rows: 24, columns: 80 }, requestRender() {} };
async function until(check: () => boolean | Promise<boolean>) {
    for (let n = 0; n < 200; n++) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.fail("expected state was not reached");
}
async function fixture(t: any, factory: (credentials?: Credentials) => LeetCodeBackend) {
    const home = await mkdtemp(join(tmpdir(), "leet-ux-"));
    const old = process.env.PI_LEETCODE_HOME;
    process.env.PI_LEETCODE_HOME = home;
    t.after(async () => {
        if (old === undefined) delete process.env.PI_LEETCODE_HOME;
        else process.env.PI_LEETCODE_HOME = old;
        await rm(home, { recursive: true, force: true });
    });
    const tools = new Map<string, any>(),
        events = new Map<string, any>();
    let command: any;
    const messages: string[] = [];
    const openedUrls: string[] = [];
    extension(
        {
            registerCommand(_name: string, value: any) {
                command = value;
            },
            registerTool(value: any) {
                tools.set(value.name, value);
            },
            on(name: string, fn: any) {
                events.set(name, fn);
            },
            async exec(_command: string, args: string[]) {
                openedUrls.push(args.at(-1)!);
                return { code: openedUrls.length === 1 ? 0 : 1, stdout: "", stderr: "" };
            },
            appendEntry() {},
            sendUserMessage(text: string) {
                messages.push(text);
            },
        } as any,
        factory,
    );
    return { home, tools, events, messages, command, openedUrls };
}
test("anonymous first entry, deferred login and background editing preserve the sent snapshot", async (t) => {
    let authCalls = 0,
        sends = 0,
        sentCode = "",
        checked!: () => void,
        release!: () => void;
    const checking = new Promise<void>((r) => {
            checked = r;
        }),
        gate = new Promise<void>((r) => {
            release = r;
        });
    const f = await fixture(t, (credentials) => ({
        id: "fixture",
        async account() {
            authCalls++;
            if (!credentials) throw new PlatformError("auth", "login");
            return { username: "fixture", slug: "fixture" };
        },
        async problem() {
            return problem;
        },
        async search() {
            return { items: [], total: 0 };
        },
        async start(_kind, _problem, code) {
            sends++;
            sentCode = code;
            return "job";
        },
        async check() {
            checked();
            await gate;
            return { verdict: "样例通过", cases: [{ output: "[0,1]", expected: "[0,1]" }] };
        },
    }));
    let screens = 0,
        connections = 0;
    const ctx: any = {
        mode: "tui",
        cwd: f.home,
        async waitForIdle() {},
        ui: {
            setWidget() {},
            async select() {
                connections++;
                return "粘贴两项 Cookie";
            },
            notify(message: string, kind: string) {
                if (kind === "error") assert.fail(message);
            },
            custom(factory: any) {
                return new Promise((done, reject) => {
                    const screen = factory(tui, theme, undefined, done);
                    if (screen instanceof SecretInput) {
                        screen.handleInput("LEETCODE_SESSION=test; csrftoken=test");
                        screen.handleInput("\r");
                        return;
                    }
                    assert.ok(screen instanceof Workbench);
                    screen.focused = true;
                    screen.render(80);
                    screens++;
                    if (screens === 1) {
                        screen.handleInput("\x1b"); screen.handleInput("\x1b");
                        return;
                    }
                    void (async () => {
                        await checking;
                        screen.handleInput("\x1bOP"); screen.handleInput("\r");
                        screen.render(80);
                        screen.handleInput("// edited while judging\n");
                        screen.handleInput("\x13");
                        const ws = await new Workspace(f.home).resume();
                        await until(async () => (await ws.read()).code.includes("edited while judging"));
                        release();
                        await until(() => screen.practice.result?.source === "leetcode" && screen.practice.result.state === "complete");
                        screen.handleInput("\x1bOR");
                        assert.match(screen.render(80).join("\n"), /代码已变化/);
                        screen.handleInput("\x1b"); screen.handleInput("\x1b");
                    })().catch(reject);
                });
            },
        },
    };
    await f.command.handler("", ctx);
    assert.equal(authCalls, 0);
    assert.equal(connections, 0);
    assert.equal(f.messages.length, 0);
    await f.command.handler("test", ctx);
    assert.equal(connections, 1);
    assert.equal(sends, 1);
    assert.equal(sentCode, problem.template);
    const saved = await (await new Workspace(f.home).resume()).read();
    assert.match(saved.code, /edited while judging/);
    assert.equal(saved.result?.codeHash, codeHash(sentCode));
    assert.deepEqual((saved.result as Execution).inputs, problem.inputs);
    assert.equal((saved.result as Execution).state, "complete");
});
test("cancelling deferred connection preserves practice without sending", async (t) => {
    let sends = 0;
    const f = await fixture(t, () => ({
        id: "fixture",
        async account() {
            throw new Error("unexpected auth");
        },
        async problem() {
            return problem;
        },
        async search() {
            return { items: [], total: 0 };
        },
        async start() {
            sends++;
            return "job";
        },
        async check() {
            return undefined;
        },
    }));
    const ctx: any = {
        mode: "tui",
        cwd: f.home,
        async waitForIdle() {},
        ui: {
            setWidget() {},
            async select() {
                return undefined;
            },
            notify(message: string, kind: string) {
                if (kind === "error") assert.fail(message);
            },
            custom(factory: any) {
                return new Promise((done) => {
                    const screen = factory(tui, theme, undefined, done);
                    screen.render(80);
                    screen.handleInput("\x1b"); screen.handleInput("\x1b");
                });
            },
        },
    };
    await f.command.handler("open 1", ctx);
    await f.command.handler("test", ctx);
    assert.equal(sends, 0);
    assert.equal((await (await new Workspace(f.home).resume()).read()).code, problem.template);
});
test("per-case display retains missing outputs and puts diagnostics before technical details", () => {
    const result = decodeJudge(
        { state: "SUCCESS", status_code: 10, correct_answer: false, code_answer: ["[0,0]"], expected_code_answer: ["[0,1]", "[0,1]"] },
        "run",
    )!;
    const record: Execution = {
        source: "leetcode",
        id: "record-id",
        kind: "run",
        createdAt: "date",
        account: "private-account",
        slug: "two-sum",
        code: "code",
        codeHash: "hash",
        input: problem.inputs.join("\n"),
        inputs: problem.inputs,
        state: "complete",
        message: result.verdict,
        result,
    };
    assert.match(resultSummary(record, 1), /用例 2\/2/);
    assert.match(resultSummary(record, 1), /实际：平台未提供/);
    assert.doesNotMatch(resultSummary(record), /record-id|private-account/);
    assert.match(resultSummary(record, 0, true), /record-id/);
    record.result = { verdict: "Compile Error", diagnostic: "undefined: x" };
    record.message = "Compile Error";
    assert.ok(resultSummary(record).indexOf("undefined: x") < resultSummary(record).indexOf("输入："));
});
test("throttled sends enter a local cooldown and never auto-retry", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "leet-cooldown-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    let sends = 0;
    const store = new Executions(
        root,
        {
            id: "fixture",
            async start() {
                sends++;
                throw new PlatformError("throttled", "限流");
            },
            async check() {
                throw new Error("unexpected query");
            },
        },
        "account",
    );
    const r = await store.start("run", problem, "code", "input");
    assert.equal(r.state, "failed");
    assert.match(r.message, /20 秒/);
    await assert.rejects(store.start("run", problem, "code", "input"), /尚未发送/);
    assert.equal(sends, 1);
    assert.equal(JSON.parse(await readFile(join(root, "cooldown.json"), "utf8")).account, "account");
});

test("coached practice opens UI first and only explicit coaching enters the conversation", async (t) => {
    const f = await fixture(t, () => ({
        id: "fixture",
        async account() {
            return { username: "fixture", slug: "fixture" };
        },
        async problem() {
            return problem;
        },
        async search() {
            return { items: [], total: 0 };
        },
        async start() {
            throw new Error("unexpected send");
        },
        async check() {
            return undefined;
        },
    }));
    await new Workspace(f.home).initialize("coached");
    let screens = 0;
    let action = "\x1b";
    const ctx: any = {
        mode: "tui",
        model: { id: "fixture-model" },
        cwd: f.home,
        async waitForIdle() {},
        ui: {
            setWidget() {},
            async select() { action = "\x1b"; return "逐步带练"; },
            notify(message: string, kind: string) {
                if (kind === "error") assert.fail(message);
            },
            custom(factory: any) {
                screens++;
                return new Promise((done) => {
                    const screen = factory(tui, theme, undefined, done);
                    screen.render(80);
                    screen.handleInput(action);
                    if (action === "\x1b") screen.handleInput(action);
                });
            },
        },
    };
    await f.command.handler("open 1", ctx);
    assert.equal(f.messages.length, 0, "read the problem before any model request");
    assert.equal(screens, 1);
    action = "\x07"; // Changing guidance must also stay in the workbench.
    await f.command.handler("", ctx);
    assert.equal(f.messages.length, 0);
    action = "\x1b[17~"; // F6: explicit coaching
    await f.command.handler("", ctx);
    assert.equal(f.messages.length, 1);
    assert.doesNotMatch(f.messages[0]!, /回答后提醒我/);
    await f.events.get("agent_end")(
        { messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "请你用自己的话说说输入与输出。" }] }] }, ctx,
    );
    action = "\x1b";
    await f.command.handler("", ctx);
    await f.command.handler("open 1", ctx);
    assert.equal(f.messages.length, 1, "reopening never starts a new coaching request");
    const context = await f.tools.get("leet_context").execute("id", {});
    assert.match(context.content[0].text, /请你用自己的话/);
    action = "\x1b[17~";
    await f.command.handler("", ctx);
    assert.equal(f.messages.length, 2, "manual continue can resume the discussion");
    action = "\x1b";
    await f.command.handler("restart", ctx);
    assert.equal(f.messages.length, 2, "fresh attempt opens a workbench first too");
});
test("repeated queries of the same completed result do not repeat proactive coaching", async (t) => {
    const f = await fixture(t, () => ({
        id: "fixture",
        async account() {
            return { username: "fixture", slug: "fixture" };
        },
        async problem() {
            return problem;
        },
        async search() {
            return { items: [], total: 0 };
        },
        async start() {
            return "job";
        },
        async check() {
            return { verdict: "样例通过" };
        },
    }));
    const { AuthStore } = await import("../src/auth.js");
    await new AuthStore(f.home).save({ session: "fixture", csrf: "fixture" });
    const ctx: any = {
        mode: "tui",
        model: { id: "fixture-model" },
        cwd: f.home,
        async waitForIdle() {},
        ui: {
            setWidget() {},
            notify(message: string, kind: string) {
                if (kind === "error") assert.fail(message);
            },
            custom(factory: any) {
                return new Promise((done, reject) => {
                    const screen = factory(tui, theme, undefined, done);
                    screen.render(80);
                    void (async () => {
                        if (screen.practice.view.view === "results") await until(() => screen.practice.result?.state === "complete");
                        screen.handleInput("\x1b"); screen.handleInput("\x1b");
                    })().catch(reject);
                });
            },
        },
    };
    await f.command.handler("open 1", ctx);
    assert.equal(f.messages.length, 0, "light entry does not start unsolicited opening");
    await f.command.handler("test", ctx);
    assert.equal(f.messages.length, 1);
    await f.events.get("agent_end")(
        { messages: [{ role: "assistant", stopReason: "stop", content: [{ type: "text", text: "这个边界是否处理了？" }] }] },
        ctx,
    );
    await f.command.handler("status", ctx);
    assert.equal(f.messages.length, 1);
});


test("failed first public fetch can be retried without falling back to a demo", async (t) => {
    let reads = 0;
    const f = await fixture(t, (() => ({
        id: "fixture",
        async problem() { if (++reads === 1) throw new Error("temporary network failure"); return problem; },
    })) as any);
    const errors: string[] = [];
    let screens = 0;
    const ctx: any = { mode: "tui", cwd: f.home, async waitForIdle() {}, ui: {
        setWidget() {}, notify(message: string, kind: string) { if (kind === "error") errors.push(message); },
        custom(factory: any) { return new Promise(done => {
            const screen = factory(tui, theme, undefined, done);
            assert.equal(screen.practice.code, problem.template); screens++;
            screen.handleInput("\x1b"); screen.handleInput("\x1b");
        }); },
    } };
    await f.command.handler("", ctx);
    assert.deepEqual(errors, ["temporary network failure"]);
    await f.command.handler("", ctx);
    assert.equal(reads, 2); assert.equal(screens, 1);
    assert.equal((await new Workspace(f.home).resume()).problem.source, "leetcode");
});


test("original-page action opens the canonical URL and restores drafts; failure retains a copyable address", async t => {
    const f = await fixture(t, (() => ({ id: "fixture", async problem() { return problem; } })) as any);
    let screenCount = 0;
    const ctx: any = { mode: "tui", cwd: f.home, async waitForIdle() {}, ui: {
        setWidget() {}, notify(message: string, kind: string) { if (kind === "error") assert.fail(message); },
        custom(factory: any) { return new Promise((done, reject) => {
            const screen = factory(tui, theme, undefined, done);
            screen.render(80); screenCount++;
            try {
                if (screenCount === 1) {
                    screen.handleInput("\r"); screen.render(80); screen.handleInput("// draft\n");
                    screen.handleInput("\x1b[18~"); // F7
                } else if (screenCount === 2) {
                    assert.equal(screen.practice.view.view, "code");
                    assert.match(screen.practice.code, /draft/);
                    screen.handleInput("\x1b[18~");
                } else {
                    assert.match(screen.render(80).join("\n"), /未能打开浏览器/);
                    assert.match(screen.render(80).join("\n"), /https:\/\/leetcode.cn\/problems\/two-sum\//);
                    screen.handleInput("\x1b"); screen.handleInput("\x1b");
                }
            } catch (error) { reject(error); }
        }); },
    } };
    await f.command.handler("open 1", ctx);
    assert.equal(screenCount, 3);
    assert.deepEqual(f.openedUrls, ["https://leetcode.cn/problems/two-sum/", "https://leetcode.cn/problems/two-sum/"]);
    assert.match((await (await new Workspace(f.home).resume()).read()).code, /draft/);
});

type PickerStep = (screen: any, done: (value: any) => void, fail: (error: unknown) => void) => void;
function screenDriver(steps: PickerStep[]) {
    let index = 0;
    return {
        steps,
        custom(factory: any) {
            return new Promise((done, reject) => {
                const screen = factory(tui, theme, undefined, done);
                const step = steps[index++];
                if (!step) { reject(new Error(`unexpected screen: ${screen?.constructor?.name}`)); return; }
                try { step(screen, done, reject); }
                catch (error) { reject(error); }
            });
        },
        count: () => index,
    };
}
function pickerBackend(other: typeof problem & { difficulty?: string }, searchCalls: string[] = []): (credentials?: Credentials) => LeetCodeBackend {
    return () => ({
        id: "fixture",
        async account() { return { username: "fixture", slug: "fixture" }; },
        async search(keyword = "") { searchCalls.push(keyword); return { items: [{ id: other.id, slug: other.slug, title: other.title, difficulty: other.difficulty ?? "Hard", paid: false }], total: 1 }; },
        async problem(reference: string) { return reference === other.slug ? other : problem; },
        async start() { throw new Error("unexpected send"); },
        async check() { return undefined; },
    });
}

test("F8 saves before the picker, cancel restores the draft and view, and the picker never runs code", async (t) => {
    const f = await fixture(t, pickerBackend({ ...problem, id: "42", slug: "trapping-rain-water", title: "接雨水" }));
    const driver = screenDriver([
        (screen) => {
            assert.ok(screen instanceof Workbench);
            screen.focused = true;
            screen.practice.view.view = "code";
            screen.render(80);
            screen.handleInput("// 草稿\n");
            screen.handleInput("\x1b[19~"); // F8
        },
        (screen) => {
            assert.ok(screen instanceof ProblemPicker, "F8 opens the same picker as /leet pick");
            assert.equal(screen.keyword, "");
            screen.render(80);
            screen.handleInput("\x1b"); // cancel
        },
        (screen) => {
            assert.ok(screen instanceof Workbench);
            screen.focused = true;
            assert.equal(screen.practice.view.view, "code", "cancel restores the previous tab");
            assert.match(screen.practice.code, /草稿/, "cancel restores the saved draft");
            screen.render(80);
            screen.handleInput("\x1b");
            screen.handleInput("\x1b");
        },
    ]);
    const ctx: any = {
        mode: "tui", cwd: f.home, async waitForIdle() {},
        ui: { setWidget() {}, notify(message: string, kind: string) { if (kind === "error" && !/文件已被其他编辑器修改/.test(message)) assert.fail(message); }, custom: driver.custom },
    };
    await f.command.handler("open 1", ctx);
    assert.equal(driver.count(), 3);
    assert.match((await (await new Workspace(f.home).resume()).read()).code, /草稿/);
});

test("F8 picking another problem switches and keeps the original practice on disk", async (t) => {
    const other = { ...problem, id: "42", slug: "trapping-rain-water", title: "接雨水", statement: "# 42 · 接雨水\n\n题意" };
    const f = await fixture(t, pickerBackend(other));
    const driver = screenDriver([
        (screen) => {
            assert.ok(screen instanceof Workbench);
            screen.focused = true;
            screen.practice.view.view = "code";
            screen.render(80);
            screen.handleInput("// 原题草稿\n");
            screen.handleInput("\x1b[19~");
        },
        (screen, _done, fail) => {
            assert.ok(screen instanceof ProblemPicker);
            void (async () => {
                await until(() => !screen.isLoading && screen.entries.length > 0);
                assert.equal(screen.entries[0]?.summary.slug, "trapping-rain-water");
                screen.render(80);
                screen.handleInput("\r");
            })().catch(fail);
        },
        (screen) => {
            assert.ok(screen instanceof Workbench);
            screen.focused = true;
            assert.equal((screen as any).workspace.problem.slug, "trapping-rain-water");
            assert.match(screen.render(80).join("\n"), /接雨水/);
            screen.handleInput("\x1b");
            screen.handleInput("\x1b");
        },
    ]);
    const ctx: any = {
        mode: "tui", cwd: f.home, async waitForIdle() {},
        ui: { setWidget() {}, notify(message: string, kind: string) { if (kind === "error") assert.fail(message); }, custom: driver.custom },
    };
    await f.command.handler("open 1", ctx);
    assert.equal(driver.count(), 3);
    const last = JSON.parse(await readFile(join(f.home, "last-problem.json"), "utf8"));
    assert.equal(last.problem.slug, "trapping-rain-water");
    const original = await new Workspace(f.home, problem).read();
    assert.match(original.code, /原题草稿/, "the original problem keeps its saved work");
});

test("a save conflict on F8 keeps the workbench and never opens the picker", async (t) => {
    const f = await fixture(t, pickerBackend({ ...problem, id: "42", slug: "trapping-rain-water", title: "接雨水" }));
    await new Workspace(f.home).initialize();
    const directory = await new Workspace(f.home, problem).problemDirectory();
    const driver = screenDriver([
        (screen, _done, fail) => {
            assert.ok(screen instanceof Workbench);
            screen.focused = true;
            screen.practice.view.view = "code";
            screen.render(80);
            screen.handleInput("// 本地草稿\n");
            void (async () => {
                await writeFile(join(directory, "solution.go"), "// 其他编辑器改写\n");
                screen.handleInput("\x1b[19~"); // F8
                await until(() => screen.render(80).join("\n").includes("文件已被其他编辑器修改"));
                assert.match(screen.render(80).join("\n"), /本地草稿/, "the draft stays visible after a save failure");
                screen.handleInput("\x11"); // Ctrl+Q discard on confirmation
                await until(() => screen.render(80).join("\n").length > 0);
            })().catch(fail);
        },
    ]);
    const ctx: any = {
        mode: "tui", cwd: f.home, async waitForIdle() {},
        ui: { setWidget() {}, notify() {}, async confirm() { return true; }, custom: driver.custom },
    };
    await f.command.handler("open 1", ctx);
    assert.equal(driver.count(), 1, "save failure stays in the workbench");
    assert.equal((await readFile(join(directory, "solution.go"), "utf8")), "// 其他编辑器改写\n", "disk content is never overwritten");
});

test("/leet pick opens the same picker and cancelling changes nothing", async (t) => {
    const other = { ...problem, id: "42", slug: "trapping-rain-water", title: "接雨水" };
    const f = await fixture(t, pickerBackend(other));
    const driver = screenDriver([
        (screen, _done, fail) => {
            assert.ok(screen instanceof ProblemPicker);
            void (async () => {
                await until(() => !screen.isLoading && screen.entries.length > 0);
                screen.render(80);
                screen.handleInput("\x1b");
            })().catch(fail);
        },
    ]);
    const ctx: any = {
        mode: "tui", cwd: f.home, async waitForIdle() {},
        ui: { setWidget() {}, notify() {}, custom: driver.custom },
    };
    await f.command.handler("pick", ctx);
    assert.equal(driver.count(), 1);
    assert.equal((await new Workspace(f.home).resume()).problem.slug, "two-sum", "cancel keeps the current problem");
});

test("a background judge result lands on its own problem after an F8 switch", async (t) => {
    const other = { ...problem, id: "42", slug: "trapping-rain-water", title: "接雨水", statement: "# 42 · 接雨水\n\n题意" };
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let starts = 0;
    const f = await fixture(t, () => ({
        id: "fixture",
        async account() { return { username: "fixture", slug: "fixture" }; },
        async search() { return { items: [{ id: "42", slug: other.slug, title: other.title, difficulty: "Hard", paid: false }], total: 1 }; },
        async problem(reference: string) { return reference === other.slug ? other : problem; },
        async start() { starts++; return "job-1"; },
        async check() { await gate; return { verdict: "样例通过" }; },
    }));
    const { AuthStore } = await import("../src/auth.js");
    await new AuthStore(f.home).save({ session: "fixture", csrf: "fixture" });
    let sawNewResult = false;
    const driver = screenDriver([
        (screen) => {
            assert.ok(screen instanceof Workbench);
            screen.focused = true; screen.render(80);
            screen.handleInput("\x12"); // Ctrl+R run
        },
        (screen, _done, fail) => {
            assert.ok(screen instanceof Workbench);
            screen.focused = true; screen.render(80);
            void (async () => {
                await until(() => starts === 1);
                screen.handleInput("\x1b[19~"); // F8 while the judge is still running
            })().catch(fail);
        },
        (screen, _done, fail) => {
            assert.ok(screen instanceof ProblemPicker);
            void (async () => {
                await until(() => !screen.isLoading && screen.entries.length > 0);
                screen.render(80);
                screen.handleInput("\r");
            })().catch(fail);
        },
        (screen, _done, fail) => {
            assert.ok(screen instanceof Workbench);
            screen.focused = true;
            screen.render(80);
            void (async () => {
                const aExecution = join(await new Workspace(f.home, problem).problemDirectory(), "execution.json");
                release();
                await until(async () => JSON.parse(await readFile(aExecution, "utf8")).state === "complete");
                await new Promise(resolve => setTimeout(resolve, 30));
                sawNewResult = /样例通过/.test(screen.render(80).join("\n"));
                screen.handleInput("\x1b");
                screen.handleInput("\x1b");
            })().catch(fail);
        },
    ]);
    const ctx: any = {
        mode: "tui", cwd: f.home, async waitForIdle() {},
        ui: { setWidget() {}, notify(message: string, kind: string) { if (kind === "error") assert.fail(message); }, custom: driver.custom },
    };
    await f.command.handler("open 1", ctx);
    assert.equal(driver.count(), 4);
    assert.equal(starts, 1);
    assert.equal(sawNewResult, false, "the old problem's result never appears on the new problem");
    assert.equal((await new Workspace(f.home, other).read()).result, undefined, "the new practice has no borrowed result");
    assert.equal(JSON.parse(await readFile(join(await new Workspace(f.home, problem).problemDirectory(), "execution.json"), "utf8")).state, "complete", "the result is saved on its own problem");
    assert.equal(f.messages.length, 0, "opening the picker never starts a model turn");
});
