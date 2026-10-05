import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { Workspace } from "../src/workspace.js";
import { Workbench } from "../src/workbench.js";
initTheme("dark", false);
const root = await mkdtemp(join(tmpdir(), "pi-leetcode-preview-"));
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
const plain = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b_[^\x07]*\x07/g, "");
function renderCells(line: string, row: number): string {
    let column = 0;
    const glyphs: string[] = [];
    for (const { segment } of new Intl.Segmenter().segment(line)) {
        if (segment !== " ") glyphs.push(`<text x="${18 + column * 9}" y="${row}">${escape(segment)}</text>`);
        column += visibleWidth(segment);
    }
    return glyphs.join("");
}
try {
    const store = new Workspace(root);
    await store.initialize();
    const practice = await store.open();
    await mkdir("docs/images", { recursive: true });
    for (const [name, width, height] of [["workbench-wide", 120, 30], ["workbench-narrow", 80, 24]] as const) {
        practice.view.view = width >= 100 ? "code" : "problem";
        const tui = { terminal: { rows: height, columns: width }, requestRender() { } } as unknown as TUI;
        const theme = { fg: (_color: string, text: string) => text } as Theme;
        const screen = new Workbench(tui, theme, practice, store, "light", () => { });
        const lines = screen.render(width).map(plain);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * 9 + 36}" height="${(lines.length + 2) * 22 + 20}" viewBox="0 0 ${width * 9 + 36} ${(lines.length + 2) * 22 + 20}">
<rect width="100%" height="100%" fill="#171b22"/>
<g fill="#d9e0e9" font-family="Menlo, Consolas, monospace" font-size="14" xml:space="preserve">
<text x="18" y="26" fill="#92c8e6">组件渲染快照 · ${width}×${height} · 非线上判题</text>
${lines.map((line, i) => renderCells(line, (i + 2) * 22 + 10)).join("\n")}
</g></svg>\n`;
        await writeFile(`docs/images/${name}.svg`, svg);
        screen.dispose();
    }
    console.log("Wrote wide and narrow component render previews to docs/images/.");
}
finally {
    await rm(root, { recursive: true, force: true });
}
