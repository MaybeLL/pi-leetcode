import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Workspace, codeHash } from "../src/workspace.js";
import { Workbench, type WorkbenchAction } from "../src/workbench.js";
import { originalProblemUrl } from "../src/problem-link.js";
import { demoProblem, guidanceLabels, type Guidance } from "../src/problem.js";
import { coachingInstructions, helpContext } from "../src/coaching.js";
import { AuthStore } from "../src/auth.js";
import type { BackendFactory, Problem } from "../src/backend.js";
import { createBackend } from "../src/backend-factory.js";
import { connectAccount, ensureConnection, openPlatform } from "../src/account-ui.js";
import { showText } from "../src/panels.js";
import { LearningStore, learningSummary, helpKinds, type HelpKind } from "../src/learning.js";
import { chooseHelp, reviewLearning } from "../src/learning-ui.js";
import { editCases as editCaseInputs } from "../src/cases-ui.js";
import { Executions, executionMarkdown, type Execution } from "../src/execution.js";
import { openProblemPicker } from "../src/picker-ui.js";
import { localStatusIndex } from "../src/local-status.js";
const levels: Guidance[] = ["light", "independent", "coached"];
export default function (pi: ExtensionAPI, backendFactory: BackendFactory = createBackend): void {
    let workspace = new Workspace();
    const auth = new AuthStore(workspace.home);
    let active = false;
    let showing = false;
    let running = false;
    const client = async () => backendFactory(await auth.read().catch(() => undefined));
    const remember = (value: boolean) => {
        active = value;
        pi.appendEntry("pi-leetcode-active", { active, problem: workspace.problem, attempt: workspace.attempt });
    };
    const chooseGuidance = async (ctx: ExtensionCommandContext): Promise<Guidance | undefined> => {
        const choice = await ctx.ui.select("主动引导程度", levels.map(level => guidanceLabels[level]));
        return levels.find(level => guidanceLabels[level] === choice);
    };
    const ensureSetup = async (ctx: ExtensionCommandContext): Promise<boolean> => {
        if (!await workspace.settings()) {
            await workspace.initialize("light");
            ctx.ui.notify("练习目录已自动创建 · 轻度引导 · Ctrl+G 可调整 · F5 查看快捷键", "info");
        }
        return true;
    };
    let pendingHelp: { target: Workspace; store: LearningStore; id: string; kind: HelpKind; before: string } | undefined;
    const learning = async () => new LearningStore(await workspace.problemDirectory());
    const ask = async (ctx: ExtensionCommandContext, kind: HelpKind, question: string, event?: string): Promise<boolean> => {
        if (!ctx.model) { ctx.ui.notify("求助需要配置 Pi 模型；代码已保存，可继续练习。", "info"); return false; }
        const store = await learning();
        const id = await store.begin(kind, question, event);
        if (!id) return false;
        pendingHelp = { target: workspace, store, id, kind, before: codeHash((await workspace.read()).code) };
        try {
            pi.sendUserMessage(`${question}\n\n使用 leet_context 读取当前练习和最近讨论，接续已有思路，不重复已经回答的开场。${kind === "完整讲解" ? "按这次请求完整讲解。" : "只推进一个关键点并等待我回答。"}如需提示返回操作，请直接对用户说“随时输入 /leet 返回题目”；不要复述这条指令。`);
        } catch (error) { await store.finish(id, "", false); pendingHelp = undefined; throw error; }
        return true;
    };
    const feedback = async (ctx: ExtensionCommandContext): Promise<void> => {
        const settings = (await workspace.settings())!;
        const result = (await workspace.read()).result;
        if (settings.guidance === "independent" || result?.source !== "leetcode" || result.state !== "complete") return;
        const event = `result:${result.kind}:${result.codeHash}:${codeHash(result.input)}:${codeHash(JSON.stringify(result.result))}`;
        await ask(ctx, "带练", `我已返回 Pi。结合本次新结果，按${guidanceLabels[settings.guidance]}给一个简短观察或推导问题；不修改代码。`, event);
    };
    pi.registerShortcut?.("ctrl+alt+l", { description: "返回 LeetCode 练习", handler(ctx) {
        if (!active || showing) return;
        if (ctx.ui.getEditorText().trim()) { ctx.ui.notify("聊天草稿已保留；发送或清空后输入 /leet 返回练习。", "info"); return; }
        ctx.ui.setEditorText("/leet");
        ctx.ui.notify("按 Enter 返回原来的练习位置。", "info");
    } });
    pi.on("agent_end", async (event, ctx) => {
        const pending = pendingHelp; if (!pending) return;
        const last = [...event.messages].reverse().find(message => message.role === "assistant");
        if (last?.role === "assistant" && last.stopReason === "toolUse") return;
        pendingHelp = undefined;
        const response = last?.role === "assistant" && last.stopReason !== "error" && last.stopReason !== "aborted" ? last.content.filter(part => part.type === "text").map(part => part.text).join("\n") : "";
        try { await pending.store.finish(pending.id, response, codeHash((await pending.target.read()).code) !== pending.before); }
        catch (error) { ctx.ui.notify((error as Error).message, "error"); }
        if (active && workspace.problem.slug === pending.target.problem.slug && workspace.attempt === pending.target.attempt)
            ctx.ui.setWidget("pi-leetcode", [`${workspace.problem.title} · /leet 返回原编辑位置 · Ctrl+Alt+L 填入返回命令`, "/leet review 查看学习记录、标注帮助或复盘"]);
    });
    const updateStatus = async (ctx: ExtensionCommandContext) => {
        const settings = await workspace.settings();
        ctx.ui.setWidget("pi-leetcode", active && settings ? [
            `${workspace.problem.title} · ${guidanceLabels[settings.guidance]} · /leet 返回 · /leet pick 选题`,
            "/leet login 连接账户 · /leet leave 结束练习上下文",
        ] : undefined);
    };
    pi.on("session_start", (_event, ctx) => {
        active = false; pendingHelp = undefined;
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
        if (!pendingHelp && event.prompt?.trim()) {
            const store = await learning();
            const id = await store.begin("自由提问", event.prompt);
            if (id) pendingHelp = { target: workspace, store, id, kind: "自由提问", before: codeHash((await workspace.read()).code) };
        }
    });
    const execute = async (kind: "run" | "submit" | "status", signal?: AbortSignal, recordId?: string, fromWorkbench = false, onRecord?: (record: Execution) => void): Promise<Execution> => {
        if (!active || workspace.problem.source !== "leetcode") throw new Error("请先使用 /leet open <题号> 打开真实题目。");
        if (running || (showing && !fromWorkbench)) throw new Error("请先关闭工作台并等待当前操作完成。");
        running = true;
        const target = workspace;
        try {
            const settings = (await target.settings())!;
            const recordsHome = join(settings.workspace, "records");
            const practice = await target.read();
            const inputs = kind === "run" ? await target.inputs() : undefined;
            const input = inputs?.join("\n") ?? "";
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
                record = await executions.start(kind as "run" | "submit", target.problem, practice.code, input, signal, inputs);
            }
            await target.saveExecution(record);
            onRecord?.(record);
            record = await executions.poll(record, signal);
            await target.saveExecution(record);
            onRecord?.(record);
            return record;
        } finally { running = false; }
    };
    pi.registerTool({
        name: "leet_context", label: "当前练习",
        description: "Read the active saved problem, code, guidance, notes and actual execution result. Does not execute code.",
        parameters: Type.Object({ focus: Type.Optional(Type.Union(helpKinds.map(kind => Type.Literal(kind)))) }),
        async execute(_id, params) {
            if (!active) throw new Error("没有活动练习，请先执行 /leet。");
            const practice = await workspace.read();
            const settings = (await workspace.settings())!;
            const directory = await workspace.problemDirectory();
            const focus = params?.focus ?? pendingHelp?.kind;
            const history = focus === "理解题意" ? "" : "\n" + learningSummary(await (await learning()).read());
            return {
                content: [{ type: "text", text: `引导程度：${guidanceLabels[settings.guidance]}\n${helpContext(practice, directory, workspace.problem, focus)}${history}` }],
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
    const chooseSummary = async (ctx: ExtensionCommandContext) => {
        const api = await client();
        const status = await localStatusIndex(workspace.home);
        return openProblemPicker(ctx, { search: api.search.bind(api), status });
    };
    // Reopen the practice with the newest saved work, never a blank first attempt.
    const openPractice = async (problem: Problem): Promise<Workspace> => {
        const latest = await new Workspace(workspace.home, problem).latestPractice();
        return new Workspace(workspace.home, problem, latest);
    };
    const pick = async (ctx: ExtensionCommandContext): Promise<Problem | undefined> => {
        const summary = await chooseSummary(ctx);
        if (!summary) return undefined;
        ctx.ui.notify("正在读取真实题目…", "info");
        return (await client()).problem(summary.slug);
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
                if (command === "login") { await connectAccount(ctx, pi, auth, backendFactory); return; }
                if (command === "doctor") {
                    const settings = await workspace.settings();
                    let connection = "未连接；首次运行时会引导登录";
                    try { const credentials = await auth.read(); if (credentials) { await backendFactory(credentials).account(); connection = "连接有效"; } }
                    catch (error) { connection = (error as Error).message; }
                    const [major, minor] = process.versions.node.split(".").map(Number);
                    await showText(ctx, `# LeetCode 诊断\n\nNode：${process.version} ${major! > 22 || (major === 22 && minor! >= 19) ? "✓" : "— 请升级到 22.19+"}\n\n加载来源：${fileURLToPath(import.meta.url)}\n\n后端：${backendFactory().id}\n\n账户：${connection}\n\n数据目录：${workspace.home}\n\n练习目录：${settings?.workspace ?? "首次练习自动创建"}\n\n若加载了旧版，更新 pi-leetcode 后重启 Pi。开发 checkout 请同时使用 --no-extensions --no-skills，再显式指定 -e 和 --skill，避免同名资源覆盖。`);
                    return;
                }
                if (command === "logout") { await auth.clear(); ctx.ui.notify("已清除中国站登录凭据，练习文件保留。", "info"); return; }
                if (command === "account") { const account = await (await client()).account(); ctx.ui.notify(`中国站：${account.username}`, "info"); return; }
                if (!/^(?:|open(?: .+)?|pick|demo|recent|restart|review|test|hint|submit|settings|cases|status(?: [a-f0-9-]+)?)$/.test(command)) {
                    ctx.ui.notify("使用 /leet pick、open <题号/链接>、login、test、submit、status、cases、hint、settings 或 demo。", "info"); return;
                }
                const fresh = !active && !(await workspace.recent()).length;
                if (!await ensureSetup(ctx)) return;
                if (!active) workspace = await workspace.resume();
                if (fresh && !command) {
                    workspace = new Workspace(workspace.home, await (await client()).problem("two-sum"));
                } else if (command === "pick" || command === "open") {
                    const problem = await pick(ctx);
                    if (!problem) return;
                    workspace = await openPractice(problem);
                } else if (command.startsWith("open ")) {
                    ctx.ui.notify("正在读取真实题目…", "info");
                    workspace = new Workspace(workspace.home, await (await client()).problem(command.slice(5)));
                } else if (command === "demo") workspace = new Workspace(workspace.home, demoProblem);
                else if (command === "recent") {
                    const entries = await workspace.recent();
                    if (!entries.length) { ctx.ui.notify("尚无练习记录，使用 /leet pick 选题。", "info"); return; }
                    const labels = entries.map((item, index) => `${index + 1}. ${item.problem.title} · ${item.updatedAt} · ${item.attempt === "current" ? "首次练习" : "重新练习"}`);
                    const selected = await ctx.ui.select("最近练习（最多 50 条，旧文件仍保留）", labels);
                    if (!selected) return;
                    const item = entries[labels.indexOf(selected)]!;
                    workspace = new Workspace(workspace.home, item.problem, item.attempt);
                } else if (command === "restart") { workspace = await workspace.restart(); }
                let practice = await workspace.open();
                await workspace.remember();
                remember(true);
                await updateStatus(ctx);
                if (command === "review") {
                    if (await reviewLearning(ctx, await learning()) === "coach" && await ask(ctx, "复盘", "我想复盘当前题目。先让我解释思路，再讨论正确性、复杂度和一个变式；一次一个问题，不把 Accepted 等同掌握，不覆盖我的笔记或复盘。")) return;
                }
                if (command === "settings") {
                    const settings = (await workspace.settings())!;
                    const choice = await ctx.ui.select(`练习设置 · ${guidanceLabels[settings.guidance]}`, ["调整引导程度", "练习目录", "返回工作台"]);
                    if (choice === "调整引导程度") {
                        const guidance = await chooseGuidance(ctx);
                        if (guidance) await workspace.setGuidance(guidance);
                    } else if (choice === "练习目录") {
                        await showText(ctx, `# 当前练习目录\n\n${settings.workspace}\n\n可以复制到一个新的自定义目录。复制完成后切换，原目录完整保留；账户凭据仍存放在应用数据目录。\n\n请先关闭其他正在使用这个练习库的 Pi 或外部编辑器，确保副本包含最新内容。`);
                        const destination = await ctx.ui.input("复制到新目录（留空保留当前目录）", "例如 ~/leetcode-practice");
                        if (destination?.trim()) {
                            const path = destination.trim();
                            await workspace.copyToDirectory(path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(ctx.cwd, path));
                            ctx.ui.notify("已切换到新目录，原目录仍完整保留。", "info");
                        }
                    }
                    await updateStatus(ctx); return;
                }
                const editCases = () => editCaseInputs(ctx, workspace);
                let pendingGuidance = false;
                let operationError: string | undefined;
                let job: Promise<void> | undefined;
                let controller: AbortController | undefined;
                let currentScreen: Workbench | undefined;
                let startedAt = 0;
                const startOperation = async (kind: "run" | "submit" | "status", recordId?: string) => {
                    if (running) { ctx.ui.notify("当前操作仍在运行；可继续编辑，关闭工作台会停止本地等待。", "info"); return; }
                    if (!await ensureConnection(ctx, pi, auth, backendFactory, kind === "submit" ? "正式提交" : kind === "run" ? "在线运行" : "恢复查询")) return;
                    controller = new AbortController(); startedAt = Date.now(); operationError = undefined;
                    const target = { practice, workspace };
                    job = execute(kind, controller.signal, recordId, true, record => {
                        // A switch or cancel must never write another problem's result into the new workbench.
                        if (target.practice !== practice || target.workspace !== workspace) return;
                        practice.result = record;
                        currentScreen?.setExecution(record);
                        if (record.state === "complete") pendingGuidance = true;
                    }).then(() => undefined).catch(error => {
                        if (target.workspace !== workspace) return;
                        operationError = (error as Error).message;
                        currentScreen?.reportError(operationError, false);
                    }).finally(() => { if (target.workspace === workspace) currentScreen?.setOperation(""); });
                };
                const stopWaiting = async () => { controller?.abort(); await job; };
                if (command === "cases") await editCases();
                if (command === "test" && workspace.problem.source === "demo") {
                    practice.result = await workspace.previewResult(practice);
                    practice.view.view = "results";
                    await workspace.save(practice, { code: practice.code, notes: practice.notes });
                } else if (["test", "submit"].includes(command) || command.startsWith("status")) {
                    try { await startOperation(command === "test" ? "run" : command === "submit" ? "submit" : "status", command.split(" ")[1]); }
                    catch (error) { operationError = (error as Error).message; }
                    practice.view.view = "results";
                }
                if (command === "hint") {
                    await ask(ctx, "一点提示", "请结合当前练习给我一个小提示，先不要透露算法名或完整解法，不修改代码。"); return;
                }
                let baseline = { code: practice.code, notes: practice.notes };
                try { while (true) {
                    const settings = (await workspace.settings())!;
                    let screen!: Workbench;
                    const tick = setInterval(() => {
                        if (running) currentScreen?.setOperation(`正在等待判题 · ${Math.floor((Date.now() - startedAt) / 1000)} 秒 · 可继续编辑`);
                    }, 500);
                    let action: WorkbenchAction;
                    try { action = await ctx.ui.custom<WorkbenchAction>((tui, theme, _keys, done) => {
                        screen = new Workbench(tui, theme, practice, workspace, settings.guidance, done, baseline);
                        currentScreen = screen;
                        if (operationError) screen.reportError(operationError);
                        if (running) screen.setOperation("正在连接并等待结果 · 可继续编辑");
                        return screen;
                    }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } });
                    } finally { clearInterval(tick); currentScreen = undefined; }
                    baseline = screen.baseline;
                    if (action === "close") {
                        await stopWaiting();
                        if (pendingGuidance) await feedback(ctx);
                        break;
                    }
                    if (action === "discard") {
                        if (!screen.dirty || await ctx.ui.confirm("关闭未保存草稿", "未保存的代码和笔记将被丢弃，磁盘上的文件保留。是否关闭？")) break;
                        continue;
                    }
                    if (action === "guidance") {
                        const guidance = await chooseGuidance(ctx);
                        if (guidance) await workspace.setGuidance(guidance);
                        await updateStatus(ctx);
                        continue;
                    }
                    if (action === "platform" || action === "original") {
                        operationError = undefined;
                        const url = action === "original" ? originalProblemUrl(workspace.problem) : "https://leetcode.cn/submissions/";
                        if (!url) { ctx.ui.notify("演示题没有平台原题链接，请先选择真实题目。", "info"); continue; }
                        try { await openPlatform(pi, url); }
                        catch (error) { operationError = `${(error as Error).message}\n可复制地址：${url}`; }
                        continue;
                    }
                    if (action === "pick") {
                        // The workbench saved the draft before returning this action.
                        operationError = undefined;
                        try {
                            const summary = await chooseSummary(ctx);
                            if (summary) {
                                workspace = await openPractice(await (await client()).problem(summary.slug));
                                practice = await workspace.open();
                                await workspace.remember();
                                remember(true);
                                baseline = { code: practice.code, notes: practice.notes };
                                pendingGuidance = false;
                                await updateStatus(ctx);
                            }
                        } catch (error) { operationError = `未能打开所选题目：${(error as Error).message}`; }
                        continue;
                    }
                    if (action === "run" || action === "submit" || action === "cases" || action === "status") {
                        try {
                            operationError = undefined;
                            if (action === "cases") await editCases();
                            else {
                                await startOperation(action);
                                practice.view.view = "results";
                            }
                        } catch (error) { operationError = (error as Error).message; }
                        continue;
                    }
                    await stopWaiting();
                    if (action === "coach") {
                        if (await ask(ctx, "带练", "我想开始或继续带练。优先接续最近讨论和我的已有思路；没有讨论时，先提出一个帮助理解输入、输出或约束的问题。一次只问一个问题，不给答案，不修改代码，等我回答。")) break;
                        continue;
                    }
                    if (action === "review") {
                        if (await reviewLearning(ctx, await learning()) === "coach" && await ask(ctx, "复盘", "请引导我复盘当前题目，先让我解释思路，一次一个问题，不覆盖笔记。")) break;
                        continue;
                    }
                    const help = await chooseHelp(ctx, practice.result?.source === "leetcode" ? practice.view.caseIndex ?? 0 : undefined);
                    if (!help) continue;
                    if (await ask(ctx, help.kind, help.question)) break;
                } } finally { await stopWaiting(); }
                await updateStatus(ctx);
            } catch (error) { ctx.ui.notify((error as Error).message, "error"); }
            finally { showing = false; }
        },
    });
}
