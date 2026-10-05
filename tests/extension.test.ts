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
initTheme("dark", false);
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
    await command.handler("", ctx);
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
