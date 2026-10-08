import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initTheme, type ExtensionAPI, type ExtensionCommandContext, type Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import extension from "../extensions/leetcode.js";
import { Workbench, type WorkbenchAction } from "../src/workbench.js";
import { Workspace } from "../src/workspace.js";
import type { LeetCodeBackend } from "../src/backend.js";
import { DIRECT_BACKEND_ID } from "../src/backend.js";
import { Executions } from "../src/execution.js";
initTheme("dark", false);
test("Pi tools use the injected backend and keep fetched problems in the existing workspace", async t => {
    const root = await mkdtemp(join(tmpdir(), "pi-leetcode-backend-"));
    const previous = process.env.PI_LEETCODE_HOME;
    process.env.PI_LEETCODE_HOME = root;
    t.after(async () => {
        if (previous === undefined) delete process.env.PI_LEETCODE_HOME;
        else process.env.PI_LEETCODE_HOME = previous;
        await rm(root, { recursive: true, force: true });
    });
    await new Workspace(root).initialize("independent");
    const tools = new Map<string, any>();
    const backend: LeetCodeBackend = {
        id: "fixture-v1",
        async account() { return { username: "fixture", slug: "fixture" }; },
        async search(keyword, difficulty, skip) {
            assert.equal(keyword, "fixture"); assert.equal(difficulty, "EASY"); assert.equal(skip, 2);
            return { items: [], total: 0 };
        },
        async problem(reference) {
            assert.equal(reference, "42");
            return { source: "leetcode", id: "42", questionId: "101", slug: "fixture", title: "Fixture", language: "Go", statement: "Backend statement", template: "// untouched" };
        },
        async start() { throw new Error("unexpected send"); },
        async check() { throw new Error("unexpected query"); },
    };
    let historicalSends = 0;
    const historical: LeetCodeBackend = { ...backend, id: DIRECT_BACKEND_ID,
        async start() { historicalSends++; return "old-job"; },
        async check(id) { assert.equal(id, "old-job"); return { verdict: "Accepted" }; },
    };
    const selected: (string | undefined)[] = [];
    extension({ registerCommand() {}, registerTool(definition: any) { tools.set(definition.name, definition); }, on() {}, appendEntry() {} } as unknown as ExtensionAPI,
        (_credentials, id) => { selected.push(id); return id === DIRECT_BACKEND_ID ? historical : backend; });
    assert.equal((await tools.get("leet_search").execute("id", { keyword: "fixture", difficulty: "EASY", skip: 2 })).details.total, 0);
    await tools.get("leet_open").execute("id", { reference: "42" });
    const context = await tools.get("leet_context").execute();
    assert.match(context.content[0].text, /Backend statement/);
    assert.match(context.content[0].text, /untouched/);
    const opened = new Workspace(root, await backend.problem("42"));
    const practice = await opened.read();
    const settings = (await opened.settings())!;
    const record = await new Executions(join(settings.workspace, "records"), historical, "fixture").start("submit", opened.problem, practice.code, "");
    practice.result = record;
    await opened.save(practice, { code: practice.code, notes: practice.notes });
    const recovered = await tools.get("leet_status").execute("id", {});
    assert.equal(recovered.details.state, "complete");
    assert.equal(selected.at(-1), DIRECT_BACKEND_ID);
    assert.equal(historicalSends, 1);
});
test("Pi command saves before handing help to the agent, retains guidance, and detaches on leave", async (t) => {
    const root = await mkdtemp(join(tmpdir(), "pi-leetcode-extension-"));
    const previous = process.env.PI_LEETCODE_HOME;
    process.env.PI_LEETCODE_HOME = join(root, "data");
    t.after(async () => {
        if (previous === undefined)
            delete process.env.PI_LEETCODE_HOME;
        else
            process.env.PI_LEETCODE_HOME = previous;
        await rm(root, { recursive: true, force: true });
    });
    const tools = new Map<string, any>();
    const events = new Map<string, any>();
    let command: any;
    const messages: string[] = [];
    extension({
        registerCommand(_name: string, definition: any) { command = definition; },
        registerTool(definition: any) { tools.set(definition.name, definition); },
        on(name: string, handler: any) { events.set(name, handler); },
        appendEntry() { },
        sendUserMessage(message: string) { messages.push(message); },
    } as unknown as ExtensionAPI);
    await assert.rejects(stat(process.env.PI_LEETCODE_HOME!), { code: "ENOENT" });
    const store = new Workspace(process.env.PI_LEETCODE_HOME);
    let interactions = 0;
    const theme = { fg: (_color: string, text: string) => text } as Theme;
    const tui = { terminal: { rows: 24, columns: 80 }, requestRender() { } } as unknown as TUI;
    const ctx = {
        mode: "tui",
        cwd: root,
        model: { id: "test-model" },
        async waitForIdle() { },
        ui: {
            async select(_title: string, options: string[]) { return options[0]; },
            async input() { return "只检查我的思路，不要修改代码"; },
            setWidget() { },
            notify(message: string, kind: string) { if (kind === "error")
                assert.fail(message); },
            custom(factory: (tui: TUI, theme: Theme, keys: unknown, done: (action: WorkbenchAction) => void) => Workbench) {
                interactions++;
                return new Promise<WorkbenchAction>(done => {
                    const screen = factory(tui, theme, undefined, done);
                    screen.focused = true;
                    screen.practice.view.view = "code";
                    screen.render(80);
                    screen.handleInput("// 用户草稿\n");
                    screen.handleInput("\x08");
                });
            },
        },
    } as unknown as ExtensionCommandContext;
    await command.handler("demo", ctx);
    assert.equal(interactions, 1);
    assert.equal(messages.length, 1);
    assert.match(messages[0]!, /只检查我的思路/);
    assert.equal((await store.settings())?.guidance, "light");
    const context = await tools.get("leet_context").execute();
    assert.match(context.content[0].text, /用户草稿/);
    assert.match(context.content[0].text, /轻度引导/);
    const event = { systemPromptOptions: { sections: {} as Record<string, string> } };
    await events.get("before_agent_start")(event);
    assert.match(event.systemPromptOptions.sections.leetcode_practice!, /单次求助不改变/);
    await tools.get("leet_set_guidance").execute("id", { level: "independent" }, undefined, undefined, ctx);
    assert.equal((await store.settings())?.guidance, "independent");
    await command.handler("leave", ctx);
    await assert.rejects(tools.get("leet_context").execute(), /没有活动练习/);
    const detached = { systemPromptOptions: { sections: {} as Record<string, string> } };
    await events.get("before_agent_start")(detached);
    assert.deepEqual(detached.systemPromptOptions.sections, {});
});
test("real command, masked login and agent tools share the same saved solution and judge result", async t => {
    const root = await mkdtemp(join(tmpdir(), "pi-leetcode-real-"));
    const oldHome = process.env.PI_LEETCODE_HOME;
    const oldFetch = globalThis.fetch;
    process.env.PI_LEETCODE_HOME = root;
    t.after(async () => {
        globalThis.fetch = oldFetch;
        if (oldHome === undefined) delete process.env.PI_LEETCODE_HOME; else process.env.PI_LEETCODE_HOME = oldHome;
        await rm(root, { recursive: true, force: true });
    });
    const sends: any[] = [];
    globalThis.fetch = (async (url: any, init: any) => {
        const body = init.body && JSON.parse(init.body);
        if (String(url).endsWith("/graphql/")) {
            if (body.query.includes("userStatus")) return new Response(JSON.stringify({ data: { userStatus: { isSignedIn: true, username: "test-user", userSlug: "test-user" } } }));
            return new Response(JSON.stringify({ data: { question: {
                questionId: "1", questionFrontendId: "1", title: "Two Sum", titleSlug: "two-sum", translatedTitle: "真实两数之和",
                content: "<p>Read the real problem</p>", difficulty: "Easy", codeSnippets: [{ langSlug: "golang", code: "func twoSum() {}" }], exampleTestcaseList: ["[3,3]\n6"], metaData: "{}",
            } } }));
        }
        if (init.method === "POST") { sends.push(body); return new Response(JSON.stringify({ interpret_id: "run_1", submission_id: 123 })); }
        return new Response(JSON.stringify({ state: "SUCCESS", status_code: 10, correct_answer: true, code_answer: ["[0,1]"], expected_code_answer: ["[0,1]"] }));
    }) as typeof fetch;
    const tools = new Map<string, any>();
    let command: any;
    const messages: string[] = [];
    extension({ registerCommand(_name: string, definition: any) { command = definition; }, registerTool(definition: any) { tools.set(definition.name, definition); }, on() {}, appendEntry() {}, sendUserMessage(message: string) { messages.push(message); } } as unknown as ExtensionAPI);
    await new Workspace(root).initialize("independent");
    const theme = { fg: (_color: string, text: string) => text } as Theme;
    const tui = { terminal: { rows: 24, columns: 80 }, requestRender() {} } as unknown as TUI;
    const ctx = {
        mode: "tui", cwd: root, model: { id: "test-model" }, async waitForIdle() {},
        ui: {
            setWidget() {}, notify(message: string, kind: string) { if (kind === "error") assert.fail(message); },
            custom(factory: any) {
                return new Promise(done => {
                    const screen = factory(tui, theme, undefined, done);
                    if (screen instanceof Workbench) {
                        screen.practice.view.view = "code"; screen.focused = true; screen.render(80);
                        screen.handleInput("// saved learner code\n"); screen.handleInput("\x1b");
                    } else {
                        screen.handleInput("\x1b[200~LEETCODE_SESSION=secret; csrftoken=csrf\x1b[201~");
                        assert.doesNotMatch(screen.render(80).join("\n"), /secret|csrf$/);
                        screen.handleInput("\r");
                    }
                });
            },
        },
    } as unknown as ExtensionCommandContext;
    await command.handler("login", ctx);
    await command.handler("open two-sum", ctx);
    assert.equal(messages.length, 0, "independent practice must not start unsolicited model turns");
    const context = await tools.get("leet_context").execute();
    assert.match(context.content[0].text, /真实两数之和/);
    assert.doesNotMatch(context.content[0].text, /secret|csrftoken/);
    const run = await tools.get("leet_run").execute("tool", {}, undefined);
    assert.match(run.content[0].text, /样例通过/);
    assert.equal(sends.length, 1);
    assert.match(sends[0].typed_code, /saved learner code/);
    assert.equal(sends[0].data_input, "[3,3]\n6");
    assert.equal((await (await new Workspace(root).resume()).read()).result?.source, "leetcode");
    await tools.get("leet_status").execute("tool", {}, undefined);
    assert.equal(sends.length, 1, "querying an existing result must not send code again");
    const submission = await tools.get("leet_submit").execute("tool", {}, undefined);
    assert.match(submission.content[0].text, /Accepted/);
    assert.equal(sends.length, 2);
    assert.equal(sends[1].data_input, undefined);
});
