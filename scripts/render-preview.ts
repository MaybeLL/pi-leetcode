import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { Workspace } from "../src/workspace.js";
import { Workbench } from "../src/workbench.js";
initTheme("dark", false);
// Preview-only: resolve the pinned dev runtime's actual theme, so exported colors match Pi.
const runtime = dirname(fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent")));
const { theme } = await import(pathToFileURL(join(runtime, "modes/interactive/theme/theme.js")).href) as { theme: Theme };
const root = await mkdtemp(join(tmpdir(), "pi-leetcode-preview-"));
const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);
const plain = (text: string) => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07|\x1b_[^\x07]*\x07/g, "");
function renderCells(line: string, row: number): string {
    let color = "#d9e0e9", inverse = false;
    const palette = (n: number): string => {
        if (n >= 232) return `rgb(${[0, 0, 0].map(() => 8 + (n - 232) * 10).join(",")})`;
        if (n >= 16) { const c = n - 16; const levels = [0, 95, 135, 175, 215, 255]; return `rgb(${[Math.floor(c / 36), Math.floor(c / 6) % 6, c % 6].map(i => levels[i]).join(",")})`; }
        return "#d9e0e9";
    };
    let column = 0;
    const glyphs: string[] = [];
    for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
        if (part.startsWith("\x1b[")) {
            const values = part.slice(2, -1).split(";").map(Number);
            if (values[0] === 38 && values[1] === 5) color = palette(values[2]!);
            else if (values[0] === 38 && values[1] === 2) color = `rgb(${values.slice(2, 5).join(",")})`;
            else if (values[0] === 0 || values[0] === 39) { color = "#d9e0e9"; inverse = false; }
            else if (values[0] === 7) inverse = true;
            else if (values[0] === 27) inverse = false;
            continue;
        }
        for (const { segment } of new Intl.Segmenter().segment(plain(part))) {
            const x = 18 + column * 9;
            if (inverse) glyphs.push(`<rect x="${x}" y="${row - 16}" width="${Math.max(1, visibleWidth(segment)) * 9}" height="22" fill="${color}"/>`);
            if (segment !== " ") glyphs.push(`<text x="${x}" y="${row}" fill="${inverse ? "#171b22" : color}">${escape(segment)}</text>`);
            column += visibleWidth(segment);
        }
    }
    return glyphs.join("");
}
try {
    const store = new Workspace(root);
    await store.initialize();
    const practice = await store.open();
    await mkdir("docs/images", { recursive: true });
    for (const [name, width, height] of [["workbench-wide", 120, 30], ["workbench-narrow", 80, 24], ["workbench-large", 153, 51]] as const) {
        practice.view.view = width >= 100 ? "code" : "problem";
        const tui = { terminal: { rows: height, columns: width }, requestRender() { } } as unknown as TUI;
        const screen = new Workbench(tui, theme, practice, store, "light", () => { });
        screen.focused = true;
        const lines = screen.render(width);
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
