import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { LearningStore, receivedHelp, type HelpKind } from "./learning.js";
import { showText } from "./panels.js";
export async function chooseHelp(
    ctx: ExtensionCommandContext,
    selectedCase?: number,
): Promise<{ kind: HelpKind; question: string } | undefined> {
    const choices = ["自由提问", "帮我理解题意", "检查我的思路", "给一点提示", "分析所选用例", "完整讲解或示范"];
    const choice = await ctx.ui.select(
        `向 Pi 求助${selectedCase === undefined ? "" : ` · 用例 ${selectedCase + 1}`} · 使用已保存内容`,
        choices,
    );
    if (!choice) return;
    if (choice === "自由提问") {
        const question = await ctx.ui.input("向 Pi 求助", "例如：检查我的思路，不要修改代码");
        return question?.trim() ? { kind: "自由提问", question: question.trim() } : undefined;
    }
    if (choice === "帮我理解题意")
        return { kind: "理解题意", question: "只帮我理解题意、输入输出和约束，不提供算法、伪代码或实现，不修改文件。" };
    if (choice === "检查我的思路") {
        const thought = await ctx.ui.input("我的思路（可留空，结合当前代码）", "例如：我想先枚举两个下标");
        if (thought === undefined) return;
        return {
            kind: "检查思路",
            question: `检查我的思路：${thought || "请结合当前代码"}。指出一个最值得思考的问题，先不要给完整解法，不修改代码。`,
        };
    }
    if (choice === "给一点提示")
        return { kind: "一点提示", question: "给我一个小提示，优先指出可观察的关系，不直接透露算法名或完整解法，不修改代码。" };
    if (choice === "分析所选用例")
        return {
            kind: "分析用例",
            question: `分析当前所选用例${selectedCase === undefined ? "" : ` ${selectedCase + 1}`}，结合运行时版本找出错误原因，先引导我手动推演，不代改代码。`,
        };
    return {
        kind: "完整讲解",
        question: "请完整讲解当前题目的思路、正确性和复杂度，可以提供示例代码，但不要修改我的文件，也不要正式提交。",
    };
}
export async function reviewLearning(ctx: ExtensionCommandContext, store: LearningStore): Promise<"coach" | undefined> {
    while (true) {
        const choice = await ctx.ui.select("复盘 · 判题结果与掌握程度分别记录", [
            "请 Pi 引导复盘",
            "填写或编辑我的复盘",
            "标注实际获得的帮助",
            "查看学习记录",
            "返回工作台",
        ]);
        if (!choice || choice === "返回工作台") return;
        if (choice === "请 Pi 引导复盘") return "coach";
        const record = await store.read();
        if (choice === "填写或编辑我的复盘") {
            const edited = await ctx.ui.editor(
                "我的复盘 · 不覆盖练习笔记",
                record.reflection ||
                    "# 我的复盘\n\n## 最初的思路\n\n## 改变思路的观察或反例\n\n## 正确性与复杂度\n\n## 下次能否独立讲清楚\n\n",
            );
            if (edited !== undefined) await store.reflect(edited, record.reflection);
        } else if (choice === "标注实际获得的帮助") {
            if (!record.exchanges.length) {
                ctx.ui.notify("还没有求助记录。", "info");
                continue;
            }
            const items = record.exchanges.slice(-20).reverse();
            const labels = items.map((item, i) => `${i + 1}. ${item.kind} · ${item.received} · ${item.requestedAt}`);
            const selected = await ctx.ui.select("选择求助记录（最近 20 次）", labels);
            if (!selected) continue;
            const level = await ctx.ui.select("实际获得的帮助 · 由你标注", [...receivedHelp]);
            if (level) await store.annotate(items[labels.indexOf(selected)]!.id, level as (typeof receivedHelp)[number]);
        } else {
            await showText(
                ctx,
                `# 学习记录 · 共 ${record.exchanges.length} 次请求\n\n` +
                    record.exchanges
                        .slice(-20)
                        .map(
                            (item) =>
                                `## ${item.kind} · ${item.state}\n\n请求：${item.request}\n\n回复：${item.response || (item.state === "failed" ? "本次回复失败或已中止，可重新求助。" : "尚无回复")}\n\n实际帮助：${item.received}（用户标注）\n\n${item.codeChanged ? "求助期间代码发生变化，不据此推断修改者。" : ""}`,
                        )
                        .join("\n\n") +
                    `\n\n# 用户复盘\n\n${record.reflection || "尚未填写"}`,
            );
        }
    }
}
