import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Workspace, codeHash } from "../src/workspace.js";
import { Workbench, type WorkbenchAction } from "../src/workbench.js";
import { demoProblem, guidanceLabels, type Guidance } from "../src/problem.js";
import { coachingInstructions, helpContext } from "../src/coaching.js";
import { AuthStore } from "../src/auth.js";
import { parseCredentials } from "../src/platform.js";
import type { BackendFactory, Problem } from "../src/backend.js";
import { createBackend } from "../src/backend-factory.js";
import { SecretInput } from "../src/secret-input.js";
import { Executions, executionMarkdown, type Execution } from "../src/execution.js";
const levels: Guidance[] = ["light", "independent", "coached"];
export default function (pi: ExtensionAPI, backendFactory: BackendFactory = createBackend): void {
    let workspace = new Workspace();
    const auth = new AuthStore(workspace.home);
    let active = false;
    let showing = false;
    let running = false;
    const client = async () => backendFactory(await auth.read());
    const remember = (value: boolean) => {
        active = value;
        pi.appendEntry("pi-leetcode-active", { active, problem: workspace.problem, attempt: workspace.attempt });
    };
    const chooseGuidance = async (ctx: ExtensionCommandContext): Promise<Guidance | undefined> => {
        const choice = await ctx.ui.select("主动引导程度", levels.map(level => guidanceLabels[level]));
        return levels.find(level => guidanceLabels[level] === choice);
    };
    const ensureSetup = async (ctx: ExtensionCommandContext): Promise<boolean> => {
        if (await workspace.settings()) return true;
        const destination = await ctx.ui.select("首次使用 · 练习目录", ["默认目录（自动创建）", "指定目录"]);
        if (!destination) return false;
        let directory: string | undefined;
        if (destination === "指定目录") {
            const input = await ctx.ui.input("练习目录", "例如 ~/leetcode-practice");
            if (!input?.trim()) return false;
            const path = input.trim();
            directory = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(ctx.cwd, path);
        }
        const guidance = await chooseGuidance(ctx);
        if (!guidance) return false;
        await workspace.initialize(guidance, directory);
        return true;
    };
    const updateStatus = async (ctx: ExtensionCommandContext) => {
        const settings = await workspace.settings();
        ctx.ui.setWidget("pi-leetcode", active && settings ? [
            `${workspace.problem.title} · ${guidanceLabels[settings.guidance]} · /leet 返回 · /leet pick 选题`,
            "/leet login 连接账户 · /leet leave 结束练习上下文",
        ] : undefined);
    };
    pi.on("session_start", (_event, ctx) => {
        active = false;
        for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type === "custom" && entry.customType === "pi-leetcode-active") {
                const data = entry.data as { active?: boolean; problem?: Problem; attempt?: string } | undefined;
                active = data?.active === true;
                if (data?.problem) workspace = new Workspace(workspace.home, data.problem, data.attempt);
            }
        }
        ctx.ui.setWidget("pi-leetcode", active ? [`${workspace.problem.title} · /leet 恢复工作台 · /leet leave 结束`] : undefined);
    });
    pi.on("before_agent_start", async event => {
        if (!active) return;
        const settings = await workspace.settings();
        if (settings) event.systemPromptOptions.sections["leetcode_practice"] = coachingInstructions(settings.guidance, workspace.problem.source === "demo");
    });
    const execute = async (kind: "run" | "submit" | "status", signal?: AbortSignal, recordId?: string): Promise<Execution> => {
        if (!active || workspace.problem.source !== "leetcode") throw new Error("请先使用 /leet open <题号> 打开真实题目。");
        if (running || showing) throw new Error("请先关闭工作台并等待当前操作完成。");
        running = true;
        const target = workspace;
        try {
            const settings = (await target.settings())!;
            const recordsHome = join(settings.workspace, "records");
            const practice = await target.read();
            const input = kind === "run" ? (await target.inputs()).join("\n") : "";
            const previous = practice.result;
            let resumeId: string | undefined;
            if (kind === "status") {
                resumeId = recordId || (previous?.source === "leetcode" ? previous.id : undefined);
                if (!resumeId) throw new Error("当前题目没有可恢复的在线任务。");
            } else {
                if (previous?.source === "leetcode" && previous.state === "unknown" && previous.kind === kind)
                    throw new Error("上次发送状态未知。请先在平台提交记录确认；不要重复发送。可用 /leet restart 开始新练习并保留当前记录。");
                if (previous?.source === "leetcode" && previous.state === "pending" && previous.kind === kind && previous.codeHash === codeHash(practice.code) && previous.input === input)
                    resumeId = previous.id;
            }
            const backendId = resumeId ? await Executions.backendId(recordsHome, resumeId) : undefined;
            const api = backendFactory(await auth.read(), backendId);
            const account = await api.account();
            const executions = new Executions(recordsHome, api, account.slug);
            let record: Execution;
            if (resumeId) {
                record = await executions.load(resumeId);
                if (record.slug !== target.problem.slug) throw new Error("该任务属于另一道题，请先打开对应题目。");
            } else {
                record = await executions.start(kind as "run" | "submit", target.problem, practice.code, input, signal);
            }
            // Save the pointer before polling so a restart can resume the existing ID.
            practice.result = record;
            try { await target.save(practice, { code: practice.code, notes: practice.notes }); }
            catch { throw new Error(`平台操作记录已保存，但练习文件发生冲突。请重新打开题目后用 /leet status ${record.id} 恢复查询，勿重复提交。`); }
            record = await executions.poll(record, signal);
            const latest = await target.read();
            latest.result = record;
            await target.save(latest, { code: latest.code, notes: latest.notes });
            return record;
        } finally { running = false; }
    };
    pi.registerTool({
        name: "leet_context", label: "当前练习",
        description: "Read the active saved problem, code, guidance, notes and actual execution result. Does not execute code.",
        parameters: Type.Object({}),
        async execute() {
            if (!active) throw new Error("没有活动练习，请先执行 /leet。");
            const practice = await workspace.read();
            const settings = (await workspace.settings())!;
            const directory = await workspace.problemDirectory();
            return {
                content: [{ type: "text", text: `引导程度：${guidanceLabels[settings.guidance]}\n${helpContext(practice, directory, workspace.problem)}` }],
                details: { problemId: workspace.problem.id, guidance: settings.guidance, directory },
            };
        },
    });
    pi.registerTool({
        name: "leet_search", label: "搜索题目", description: "Search LeetCode CN problems without revealing algorithm tags.",
        parameters: Type.Object({ keyword: Type.String(), difficulty: Type.Optional(Type.Union([Type.Literal("EASY"), Type.Literal("MEDIUM"), Type.Literal("HARD")])), skip: Type.Optional(Type.Integer({ minimum: 0 })) }),
        async execute(_id, params) {
            const page = await (await client()).search(params.keyword, params.difficulty, params.skip);
            return { content: [{ type: "text", text: JSON.stringify(page) }], details: page };
        },
    });
    pi.registerTool({
        name: "leet_open", label: "打开题目", description: "Open a LeetCode CN problem by number, slug or CN link. Preserves saved work; first run /leet to initialize storage.",
        parameters: Type.Object({ reference: Type.String() }),
        async execute(_id, params) {
            if (showing || running) throw new Error("请先关闭工作台并等待操作完成。");
            running = true;
            try {
                if (!await workspace.settings()) throw new Error("请先执行 /leet 初始化练习目录。");
                const problem = await (await client()).problem(params.reference);
                const next = new Workspace(workspace.home, problem);
                await next.open(); await next.remember(); workspace = next; remember(true);
                return { content: [{ type: "text", text: `${problem.statement}\n\n实现路径：${await workspace.problemDirectory()}/solution.go` }], details: { slug: problem.slug } };
            } finally { running = false; }
        },
    });
    for (const kind of ["run", "submit", "status"] as const) {
        pi.registerTool({
            name: `leet_${kind}`, label: { run: "在线运行", submit: "正式提交", status: "恢复判题查询" }[kind],
            description: kind === "submit" ? "Submit saved Go code to the current LeetCode CN account ONLY when the user requested submission (including an explicitly authorized solve-and-submit workflow). Never retry an unknown outcome automatically." :
                kind === "run" ? "Run the active saved Go code against cases.json on LeetCode CN. Does not edit code or formally submit." : "Resume polling an existing execution. Does not create a run or submission.",
            parameters: Type.Object({}),
            async execute(_id, _params, signal) {
                const record = await execute(kind, signal);
                return { content: [{ type: "text", text: executionMarkdown(record) }], details: { executionId: record.id, state: record.state } };
            },
        });
    }
    pi.registerTool({
        name: "leet_set_guidance", label: "调整引导程度",
        description: "Change proactive guidance only when the user explicitly requests a setting change. One-off help does not change this setting.",
        parameters: Type.Object({ level: Type.Union(levels.map(level => Type.Literal(level))) }),
        async execute(_id, params, _signal, _onUpdate, ctx) {
            if (!active) throw new Error("没有活动练习，请先执行 /leet。");
            await workspace.setGuidance(params.level);
            ctx.ui.setWidget("pi-leetcode", [`${workspace.problem.title} · ${guidanceLabels[params.level]} · /leet 返回工作台`]);
            return { content: [{ type: "text", text: `引导程度已调整为${guidanceLabels[params.level]}。` }], details: { guidance: params.level } };
        },
    });
    const pick = async (ctx: ExtensionCommandContext): Promise<Problem | undefined> => {
        const keyword = await ctx.ui.input("选题 · 标题或题号（留空浏览）", "例如 接雨水 或 42");
        if (keyword === undefined) return;
        const difficulty = await ctx.ui.select("难度", ["全部", "EASY", "MEDIUM", "HARD"]);
        if (!difficulty) return;
        const api = await client();
        let skip = 0;
        while (true) {
            ctx.ui.notify("正在读取题库…", "info");
            const page = await api.search(keyword, difficulty === "全部" ? "" : difficulty, skip);
            const labels = page.items.map(item => `${item.id} · ${item.title} · ${item.difficulty}${item.paid ? " · 会员" : ""}`);
            const options = [...labels, ...(skip + page.items.length < page.total && page.items.length ? ["下一页 →"] : []), ...(skip ? ["← 上一页"] : [])];
            if (!options.length) { ctx.ui.notify("没有找到题目，可换个关键词重试。", "info"); return; }
            const selected = await ctx.ui.select(`中国站题库 · 第 ${Math.floor(skip / 20) + 1} 页`, options);
            if (!selected) return;
            if (selected === "下一页 →") { skip += 20; continue; }
            if (selected === "← 上一页") { skip = Math.max(0, skip - 20); continue; }
            const item = page.items[labels.indexOf(selected)];
            if (item) return api.problem(item.slug);
        }
    };
    const runWithProgress = async (kind: "run" | "submit" | "status", ctx: ExtensionCommandContext, recordId?: string) => {
        let failure: unknown;
        const controller = new AbortController();
        showing = false;
        try {
            await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
                let stopping = false;
                void execute(kind, controller.signal, recordId).catch(error => { failure = error; }).finally(() => done());
                return {
                    render: (width: number) => [
                        `LeetCode 中国站 · ${workspace.problem.title}`,
                        stopping ? "正在停止等待…" : "正在连接并等待平台结果…",
                        "Esc 停止等待（不会撤销平台任务）",
                        "结果和代码快照会保存；稍后可用 /leet status 恢复查询。",
                    ].map(line => truncateToWidth(line, width)),
                    handleInput(data: string) { if (matchesKey(data, "escape")) { stopping = true; controller.abort(); tui.requestRender(); } },
                    invalidate() {},
                };
            });
        } finally { showing = true; }
        if (failure) throw failure;
    };
    pi.registerCommand("leet", {
        description: "LeetCode 中国站：选题、Go 工作台、在线运行、提交和 Pi 求助",
        handler: async (args, ctx) => {
            if (ctx.mode !== "tui") { ctx.ui.notify("/leet 工作台需要 Pi 交互终端模式。", "error"); return; }
            if (showing || running) return;
            showing = true;
            try {
                await ctx.waitForIdle();
                const command = args.trim();
                if (command === "leave") { remember(false); await updateStatus(ctx); return; }
                if (command === "login") {
                    const value = await ctx.ui.custom<string | undefined>((_tui, _theme, _keys, done) => new SecretInput(done));
                    if (!value) return;
                    const credentials = parseCredentials(value);
                    const account = await backendFactory(credentials).account();
                    await auth.save(credentials);
                    ctx.ui.notify(`已连接中国站：${account.username}`, "info"); return;
                }
                if (command === "logout") { await auth.clear(); ctx.ui.notify("已清除中国站登录凭据，练习文件保留。", "info"); return; }
                if (command === "account") { const account = await (await client()).account(); ctx.ui.notify(`中国站：${account.username}`, "info"); return; }
                if (!/^(?:|open(?: .+)?|pick|demo|recent|restart|review|test|hint|submit|settings|cases|status(?: [a-f0-9-]+)?)$/.test(command)) {
                    ctx.ui.notify("使用 /leet pick、open <题号/链接>、login、test、submit、status、cases、hint、settings 或 demo。", "info"); return;
                }
                const fresh = !await workspace.settings();
                if (!await ensureSetup(ctx)) return;
                if (!active) workspace = await workspace.resume();
                let opened = false;
                if (command === "pick" || command === "open" || (fresh && !command)) {
                    const problem = await pick(ctx);
                    if (!problem) return;
                    workspace = new Workspace(workspace.home, problem); opened = true;
                } else if (command.startsWith("open ")) {
                    ctx.ui.notify("正在读取真实题目…", "info");
                    workspace = new Workspace(workspace.home, await (await client()).problem(command.slice(5))); opened = true;
                } else if (command === "demo") workspace = new Workspace(workspace.home, demoProblem);
                else if (command === "recent") {
                    const entries = await workspace.recent();
                    if (!entries.length) { ctx.ui.notify("尚无练习记录，使用 /leet pick 选题。", "info"); return; }
                    const labels = entries.map((item, index) => `${index + 1}. ${item.problem.title} · ${item.updatedAt} · ${item.attempt === "current" ? "首次练习" : "重新练习"}`);
                    const selected = await ctx.ui.select("最近练习（最多 50 条，旧文件仍保留）", labels);
                    if (!selected) return;
                    const item = entries[labels.indexOf(selected)]!;
                    workspace = new Workspace(workspace.home, item.problem, item.attempt);
                } else if (command === "restart") { workspace = await workspace.restart(); opened = true; }
                let practice = await workspace.open();
                await workspace.remember();
                remember(true);
                await updateStatus(ctx);
                if (command === "review") {
                    if (!ctx.model) { ctx.ui.notify("复盘需要配置 Pi 模型；笔记可在工作台编辑。", "info"); return; }
                    pi.sendUserMessage("我想复盘当前题目。使用 leet_context 查看实现、判题和笔记，按当前引导程度讨论思路、正确性、复杂度及一个变式；不要把 Accepted 等同已经掌握，一次一个问题。不要覆盖我的笔记。"); return;
                }
                if (command === "settings") {
                    const guidance = await chooseGuidance(ctx);
                    if (guidance) await workspace.setGuidance(guidance);
                    await updateStatus(ctx); return;
                }
                const editCases = async () => {
                    if (workspace.problem.source === "demo") throw new Error("演示题不支持真实用例，请先打开平台题目。");
                    const edited = await ctx.ui.editor("测试输入 · JSON 字符串数组，每个用例用 \\n 分隔参数", JSON.stringify(await workspace.inputs(), null, 2));
                    if (edited !== undefined) {
                        const values: unknown = JSON.parse(edited);
                        if (!Array.isArray(values) || values.some(value => typeof value !== "string")) throw new Error("用例格式应为 JSON 字符串数组。");
                        await workspace.saveInputs(values as string[]);
                    }
                };
                let pendingGuidance = opened;
                let operationError: string | undefined;
                if (command === "cases") await editCases();
                if (command === "test" && workspace.problem.source === "demo") {
                    practice.result = await workspace.previewResult(practice);
                    practice.view.view = "results";
                    await workspace.save(practice, { code: practice.code, notes: practice.notes });
                } else if (["test", "submit"].includes(command) || command.startsWith("status")) {
                    try { await runWithProgress(command === "test" ? "run" : command === "submit" ? "submit" : "status", ctx, command.split(" ")[1]); }
                    catch (error) { operationError = (error as Error).message; }
                    practice = await workspace.read(); practice.view.view = "results"; pendingGuidance = true;
                }
                if (command === "hint") {
                    if (!ctx.model) { ctx.ui.notify("当前 Pi 未配置模型，代码已保留。", "info"); return; }
                    pi.sendUserMessage("请结合当前练习给我一点提示，先不要给完整解法。使用 leet_context 读取当前实现。回答后我会用 /leet 返回工作台。"); return;
                }
                let baseline = { code: practice.code, notes: practice.notes };
                while (true) {
                    const settings = (await workspace.settings())!;
                    let screen!: Workbench;
                    const action = await ctx.ui.custom<WorkbenchAction>((tui, theme, _keys, done) => {
                        screen = new Workbench(tui, theme, practice, workspace, settings.guidance, done, baseline);
                        if (operationError) screen.reportError(operationError);
                        return screen;
                    }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } });
                    baseline = screen.baseline;
                    if (action === "close") {
                        if (pendingGuidance && settings.guidance !== "independent" && ctx.model) {
                            pi.sendUserMessage(`我已返回 Pi。使用 leet_context 查看本次进展，按${guidanceLabels[settings.guidance]}给一个简短观察或推导问题，不修改代码，问完等待我回答。`);
                        }
                        break;
                    }
                    if (action === "discard") {
                        if (!screen.dirty || await ctx.ui.confirm("关闭未保存草稿", "未保存的代码和笔记将被丢弃，磁盘上的文件保留。是否关闭？")) break;
                        continue;
                    }
                    if (action === "guidance") {
                        const guidance = await chooseGuidance(ctx);
                        if (guidance) await workspace.setGuidance(guidance);
                        await updateStatus(ctx); continue;
                    }
                    if (action === "run" || action === "submit" || action === "cases") {
                        try {
                            operationError = undefined;
                            if (action === "cases") await editCases();
                            else {
                                await runWithProgress(action, ctx);
                                practice = await workspace.read(); practice.view.view = "results";
                                baseline = { code: practice.code, notes: practice.notes }; pendingGuidance = true;
                            }
                        } catch (error) { operationError = (error as Error).message; }
                        continue;
                    }
                    const question = await ctx.ui.input("向 Pi 求助", "例如：检查我的思路，不要修改代码");
                    if (!question?.trim()) continue;
                    if (!ctx.model) { ctx.ui.notify("当前 Pi 未配置模型，代码已保存。", "info"); break; }
                    pi.sendUserMessage(`${question.trim()}\n\n使用 leet_context 获取当前练习文件和结果。回答后我会用 /leet 返回原来的编辑位置。`); break;
                }
                await updateStatus(ctx);
            } catch (error) { ctx.ui.notify((error as Error).message, "error"); }
            finally { showing = false; }
        },
    });
}
