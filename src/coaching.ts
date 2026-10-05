import { demoProblem, guidanceLabels, type Guidance } from "./problem.js";
import type { Practice } from "./workspace.js";
export function coachingInstructions(guidance: Guidance): string {
    const behavior = {
        independent: "只回应用户本次请求；操作只报告结果，不主动给提示或追问。",
        light: "在有实质进展的节点可给一个简短观察或问题，不必每个节点都发言。",
        coached: "主动引导理解和推导，一次推进一个关键点，提问后等待用户回答。",
    }[guidance];
    return `当前 LeetCode 引导程度：${guidanceLabels[guidance]}。${behavior}
主动程度与求助深度分别处理，用户可请求完整解法或代写。单次求助不改变设置。
优先结合用户的已有思路，提示简短不代表可以直接揭示算法。不因沉默或等待时间继续提示。
用户只请求分析、提示或测试时不要修改解题代码。只有表达了修改意图才写代码。
当前为交互原型，测试是固定 fixture 预览，未运行用户代码，不可推断正确性或 Accepted。
使用 leet_context 获取当前文件与结果；用 leet_set_guidance 处理用户明确提出的引导程度调整。
练习目录独立于 Pi 的 cwd，文件路径以工具返回为准。`;
}
export function helpContext(practice: Practice, directory: string): string {
    return `当前练习：${demoProblem.title}（演示题），Go。
解题文件：${directory}/solution.go
题意：${demoProblem.statement}
当前已保存代码：\n\n${practice.code}
最近结果：${practice.result ? JSON.stringify(practice.result) : "尚无结果"}
笔记：${practice.notes}`;
}
