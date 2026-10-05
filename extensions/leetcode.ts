import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Workspace } from "../src/workspace.js";
import { Workbench, type WorkbenchAction } from "../src/workbench.js";
import { demoProblem, guidanceLabels, type Guidance } from "../src/problem.js";
import { coachingInstructions, helpContext } from "../src/coaching.js";
const levels: Guidance[] = ["light", "independent", "coached"];
export default function (pi: ExtensionAPI): void {
    const workspace = new Workspace();
    let active = false;
    let showing = false;
    const remember = (value: boolean) => {
        active = value;
        pi.appendEntry("pi-leetcode-active", { active });
    };
    const chooseGuidance = async (ctx: ExtensionCommandContext): Promise<Guidance | undefined> => {
        const choice = await ctx.ui.select("主动引导程度", levels.map(level => guidanceLabels[level]));
        return levels.find(level => guidanceLabels[level] === choice);
    };
    const ensureSetup = async (ctx: ExtensionCommandContext): Promise<boolean> => {
        if (await workspace.settings())
            return true;
        const destination = await ctx.ui.select("首次使用 · 练习目录", ["默认目录（自动创建）", "指定目录"]);
        if (!destination)
            return false;
        let directory: string | undefined;
        if (destination === "指定目录") {
            const input = await ctx.ui.input("练习目录", "例如 ~/leetcode-practice");
            if (!input?.trim())
                return false;
            const path = input.trim();
            directory = path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : resolve(ctx.cwd, path);
        }
        const guidance = await chooseGuidance(ctx);
        if (!guidance)
            return false;
        await workspace.initialize(guidance, directory);
        return true;
    };
    const updateStatus = async (ctx: ExtensionCommandContext) => {
        const settings = await workspace.settings();
        ctx.ui.setWidget("pi-leetcode", active && settings ? [
            `LeetCode 演示 · 两数之和 · ${guidanceLabels[settings.guidance]} · /leet 返回工作台`,
            `练习目录：${settings.workspace} · /leet leave 结束练习上下文`,
        ] : undefined);
    };
    pi.on("session_start", (_event, ctx) => {
        active = false;
        for (const entry of ctx.sessionManager.getBranch()) {
            if (entry.type === "custom" && entry.customType === "pi-leetcode-active") {
                active = (entry.data as {
                    active?: boolean;
                } | undefined)?.active === true;
            }
        }
        ctx.ui.setWidget("pi-leetcode", active ? ["LeetCode 演示练习 · /leet 恢复工作台 · /leet leave 结束"] : undefined);
    });
    pi.on("before_agent_start", async (event) => {
        if (!active)
            return;
        const settings = await workspace.settings();
        if (!settings)
            return;
        event.systemPromptOptions.sections["leetcode_practice"] = coachingInstructions(settings.guidance);
    });
    pi.registerTool({
        name: "leet_context",
        label: "当前练习",
        description: "Read the active LeetCode prototype's saved solution, notes, guidance and fixture preview. Does not run code.",
        parameters: Type.Object({}),
        async execute() {
            if (!active)
                throw new Error("没有活动练习，请先执行 /leet。");
            const practice = await workspace.read();
            const settings = (await workspace.settings())!;
            const directory = await workspace.problemDirectory();
            return {
                content: [{ type: "text", text: `引导程度：${guidanceLabels[settings.guidance]}\n${helpContext(practice, directory)}` }],
                details: { problemId: demoProblem.id, guidance: settings.guidance, directory },
            };
        },
    });
    pi.registerTool({
        name: "leet_set_guidance",
        label: "调整引导程度",
        description: "Change proactive guidance only when the user explicitly requests a setting change. One-off help does not change this setting.",
        parameters: Type.Object({ level: Type.Union(levels.map(level => Type.Literal(level))) }),
        async execute(_id, params, _signal, _onUpdate, ctx) {
            if (!active)
                throw new Error("没有活动练习，请先执行 /leet。");
            await workspace.setGuidance(params.level);
            ctx.ui.setWidget("pi-leetcode", [`两数之和 · ${guidanceLabels[params.level]} · /leet 返回工作台`]);
            return { content: [{ type: "text", text: `引导程度已调整为${guidanceLabels[params.level]}。` }], details: { guidance: params.level } };
        },
    });
    pi.registerCommand("leet", {
        description: "LeetCode 交互原型：工作台、演示结果和 Pi 求助",
        handler: async (args, ctx) => {
            if (ctx.mode !== "tui") {
                ctx.ui.notify("/leet 工作台需要 Pi 交互终端模式。", "error");
                return;
            }
            if (showing)
                return;
            showing = true;
            try {
                await ctx.waitForIdle();
                const command = args.trim();
                if (command === "leave") {
                    remember(false);
                    await updateStatus(ctx);
                    return;
                }
                if (!["", "open", "open 1", "pick", "test", "hint", "submit", "settings"].includes(command)) {
                    ctx.ui.notify("原型仅支持演示题 1。使用 /leet、/leet test、/leet hint、/leet settings 或 /leet leave。", "info");
                    return;
                }
                if (command === "submit") {
                    ctx.ui.notify("提交尚未接入，没有发送代码到 LeetCode。", "info");
                    return;
                }
                if (!await ensureSetup(ctx))
                    return;
                let practice = await workspace.open();
                remember(true);
                await updateStatus(ctx);
                if (command === "settings") {
                    const guidance = await chooseGuidance(ctx);
                    if (guidance)
                        await workspace.setGuidance(guidance);
                    await updateStatus(ctx);
                    return;
                }
                if (command === "test") {
                    practice.result = await workspace.previewResult(practice);
                    practice.view.view = "results";
                    await workspace.save(practice, { code: practice.code, notes: practice.notes });
                }
                if (command === "hint") {
                    if (!ctx.model) {
                        ctx.ui.notify("当前 Pi 未配置模型，暂时无法求助。代码已保留，可用 /leet 返回工作台。", "info");
                        return;
                    }
                    pi.sendUserMessage("请结合当前 LeetCode 演示练习给我一点提示，先不要给完整解法。使用 leet_context 读取当前实现。回答后我会用 /leet 返回工作台。");
                    return;
                }
                let baseline = { code: practice.code, notes: practice.notes };
                while (true) {
                    const settings = (await workspace.settings())!;
                    let screen!: Workbench;
                    const action = await ctx.ui.custom<WorkbenchAction>((tui, theme, _keys, done) => {
                        screen = new Workbench(tui, theme, practice, workspace, settings.guidance, done, baseline);
                        return screen;
                    }, { overlay: true, overlayOptions: { anchor: "center", width: "100%", maxHeight: "100%", margin: 0 } });
                    baseline = screen.baseline;
                    if (action === "close")
                        break;
                    if (action === "discard") {
                        if (!screen.dirty || await ctx.ui.confirm("关闭未保存草稿", "未保存的代码和笔记将被丢弃，磁盘上的文件保留。是否关闭？"))
                            break;
                        continue;
                    }
                    if (action === "guidance") {
                        const guidance = await chooseGuidance(ctx);
                        if (guidance)
                            await workspace.setGuidance(guidance);
                        await updateStatus(ctx);
                        continue;
                    }
                    const question = await ctx.ui.input("向 Pi 求助", "例如：检查我的思路，不要修改代码");
                    if (!question?.trim())
                        continue;
                    if (!ctx.model) {
                        ctx.ui.notify("当前 Pi 未配置模型，暂时无法求助。代码已保存，可用 /leet 返回工作台。", "info");
                        break;
                    }
                    // Sending after the workbench closes keeps chat and code focus separate.
                    pi.sendUserMessage(`${question.trim()}\n\n使用 leet_context 获取当前练习文件和结果。固定测试预览没有执行代码。回答后我会用 /leet 返回原来的编辑位置。`);
                    break;
                }
                await updateStatus(ctx);
            }
            catch (error) {
                ctx.ui.notify((error as Error).message, "error");
            }
            finally {
                showing = false;
            }
        },
    });
}
