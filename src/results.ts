import { executionMarkdown, type Execution } from "./execution.js";

export function caseCount(record: Execution): number {
    return record.inputs?.length || record.result?.cases?.length || 1;
}
export function resultSummary(record: Execution, index = 0, details = false): string {
    if (details) return executionMarkdown(record);
    const result = record.result;
    let text = `# ${record.kind === "run" ? "样例运行" : "正式提交"} · ${record.message}\n\n`;
    if (record.state === "pending") return text + "平台任务已保存。Ctrl+P 继续查询；不会重新发送代码。\n\nF2 继续编辑 · d 查看详情";
    if (record.state === "unknown") return text + "请先在 LeetCode 检查记录；不自动重发。\n\nCtrl+B 打开平台记录 · d 查看详情 · F2 返回代码";
    if (record.state === "failed") return text + "本次未成功发送。Ctrl+R 重新运行 / Ctrl+T 重新提交；登录问题会引导重新连接。\n\nF2 返回代码 · d 查看详情";
    if (!result) return text + "正在发送；题目和代码仍可查看。";
    if (result.passed !== undefined && result.total !== undefined) text += `平台报告：${result.passed}/${result.total} 通过\n\n`;
    if (result.diagnostic) text += `错误信息：\n\n${result.diagnostic}\n\n`;
    if (record.kind === "submit" && result.verdict === "Accepted")
        return text + `耗时：${result.runtime ?? "未提供"} · 内存：${result.memory ?? "未提供"}\n\nCtrl+V 复盘 · Ctrl+H 求助 · d 执行详情\n\nAccepted 记录判题结果，掌握程度由你复盘。`;
    const count = caseCount(record);
    const selected = Math.max(0, Math.min(index, count - 1));
    const item = result.cases?.[selected];
    if (record.kind === "run") text += `用例 ${selected + 1}/${count} · ← → 切换\n\n`;
    const input = record.inputs?.[selected] ?? result.failingInput ?? record.input;
    if (input) text += `输入：\n\n${input}\n\n`;
    text += `预期：${item?.expected ?? (result.cases ? "平台未提供" : result.expected ?? "平台未提供")}\n\n`;
    text += `实际：${item?.output ?? (result.cases ? "平台未提供" : result.output ?? "平台未提供")}\n\n`;
    if (item?.stdout || result.stdout) text += `标准输出：${item?.stdout ?? result.stdout}\n\n`;
    return text + (record.kind === "run" ? "仅运行指定输入；逐例只对照输出，不推断平台未提供的判定。\n\n" : "") + "F2 返回代码 · Ctrl+H 分析所选用例 · d 详情";
}
