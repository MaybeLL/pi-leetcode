import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme } from "@earendil-works/pi-coding-agent";
import extension from "../extensions/leetcode.js";
import { Workbench } from "../src/workbench.js";
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
            appendEntry() {},
            sendUserMessage(text: string) {
                messages.push(text);
            },
        } as any,
        factory,
    );
    return { home, tools, events, messages, command };
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
                        screen.handleInput("\x1bOQ");
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
