import type { Problem } from "./backend.js";

export function originalProblemUrl(problem: Problem): string | undefined {
    return problem.source === "leetcode" ? `https://leetcode.cn/problems/${encodeURIComponent(problem.slug)}/` : undefined;
}
