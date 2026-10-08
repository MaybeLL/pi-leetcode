import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Workspace } from "./workspace.js";
export async function editCases(ctx: ExtensionCommandContext, workspace: Workspace): Promise<void> {
    if (workspace.problem.source === "demo") throw new Error("演示题不支持真实用例，请先打开平台题目。");
    while (true) {
        const inputs = await workspace.inputs();
        const labels = inputs.map((value, index) => `用例 ${index + 1} · ${value.replace(/\n/g, " / ").slice(0, 65)}`);
        const selected = await ctx.ui.select("测试用例 · 每个参数单独一行", [...labels, "新增用例", "高级 JSON 编辑", "返回工作台"]);
        if (!selected || selected === "返回工作台") return;
        try {
            if (selected === "高级 JSON 编辑") {
                let draft = JSON.stringify(inputs, null, 2);
                while (true) {
                    const edited = await ctx.ui.editor("用例 JSON · 字符串数组", draft);
                    if (edited === undefined) break;
                    draft = edited;
                    try {
                        const values: unknown = JSON.parse(edited);
                        if (!Array.isArray(values) || values.some((value) => typeof value !== "string"))
                            throw new Error("格式应为非空字符串数组。");
                        await workspace.saveInputs(values);
                        break;
                    } catch (error) {
                        ctx.ui.notify((error as Error).message, "error");
                    }
                }
            } else {
                const index = labels.indexOf(selected);
                const action = index < 0 ? "编辑" : await ctx.ui.select(`用例 ${index + 1}`, ["编辑", "删除", "返回"]);
                if (action === "删除") await workspace.saveInputs(inputs.filter((_, i) => i !== index));
                else if (action === "编辑") {
                    let draft = index < 0 ? "" : inputs[index]!;
                    while (true) {
                        const edited = await ctx.ui.editor("测试输入 · 每个参数一行，无需转义换行", draft);
                        if (edited === undefined) break;
                        draft = edited;
                        try {
                            const next = [...inputs];
                            if (index < 0) next.push(edited);
                            else next[index] = edited;
                            await workspace.saveInputs(next);
                            break;
                        } catch (error) {
                            ctx.ui.notify((error as Error).message, "error");
                        }
                    }
                }
            }
        } catch (error) {
            ctx.ui.notify((error as Error).message, "error");
        }
    }
}
