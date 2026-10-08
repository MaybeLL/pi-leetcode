export const demoProblem = {
    source: "demo" as const,
    id: "1",
    slug: "two-sum",
    title: "两数之和",
    language: "Go",
    statement: `# 两数之和 · 演示题

给定整数数组 nums 和目标值 target，返回两个不同位置的下标，使对应元素之和等于 target。假设恰好有一组答案，下标的返回顺序不限。

## 示例

- nums = [2, 7, 11, 15]，target = 9 → [0, 1]
- nums = [3, 2, 4]，target = 6 → [1, 2]
- nums = [3, 3]，target = 6 → [0, 1]

## 约束

- 数组长度至少为 2。
- 元素可以重复，也可以为负数。
- 同一个位置不能使用两次。

这是交互原型的内置题目，尚未连接 LeetCode。代码编辑和保存可用；测试界面仅展示固定演示结果，不执行代码。`,
    template: `package main

func twoSum(nums []int, target int) []int {
    // 在这里实现你的解法。
    return nil
}
`,
    cases: [
        { nums: [2, 7, 11, 15], target: 9, expected: [0, 1] },
        { nums: [3, 3], target: 6, expected: [0, 1] },
    ],
};
export type Guidance = "independent" | "light" | "coached";
export const guidanceLabels: Record<Guidance, string> = {
    independent: "自主练习",
    light: "轻度引导",
    coached: "逐步带练",
};
export type View = "problem" | "code" | "results" | "notes";
export interface ViewState {
    view: View;
    problemOffset: number;
    resultOffset: number;
    caseIndex?: number;
    resultDetails?: boolean;
    cursor: {
        line: number;
        col: number;
    };
}
export function defaultViewState(): ViewState {
    return { view: "problem", problemOffset: 0, resultOffset: 0, cursor: { line: 0, col: 0 } };
}
