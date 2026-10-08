import { getMarkdownTheme, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Markdown, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";

export async function showText(ctx: ExtensionCommandContext, text: string): Promise<void> {
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
        const markdown = new Markdown(text, 0, 0, getMarkdownTheme());
        let offset = 0;
        return {
            render(width: number) {
                const lines = markdown.render(width), height = Math.max(1, tui.terminal.rows - 2);
                offset = Math.max(0, Math.min(offset, lines.length - height));
                return [...lines.slice(offset, offset + height), truncateToWidth("↑ ↓ 滚动 · Enter / Esc 返回", width)];
            },
            handleInput(data: string) {
                if (matchesKey(data, "escape") || matchesKey(data, "enter")) return done();
                offset += matchesKey(data, "down") ? 1 : matchesKey(data, "up") ? -1 : matchesKey(data, "pageDown") ? 10 : matchesKey(data, "pageUp") ? -10 : 0;
                tui.requestRender();
            },
            invalidate() { markdown.invalidate(); },
        };
    });
}
