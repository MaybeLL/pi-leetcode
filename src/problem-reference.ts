import type { LeetCodeBackend } from "./backend.js";

/** CN number searches are fuzzy and relevance-ranked, not exact ID lookups. */
export async function slugForNumber(id: string, search: LeetCodeBackend["search"]): Promise<string> {
    // Bound unexpected catalog growth/repeated pages without claiming the ID is absent.
    for (let page = 0, skip = 0; page < 50; page++) {
        const { items, total } = await search(id, "", skip);
        const match = items.find(item => item.id === id);
        if (match) return match.slug;
        skip += items.length;
        if (!items.length || skip >= total)
            throw new Error("未找到该题号，请使用题目链接或英文 slug。");
    }
    throw new Error("题号搜索匹配过多，尚未找到精确匹配；请使用题目链接或英文 slug。");
}
