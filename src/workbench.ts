import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Markdown, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI, type KeyId, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { guidanceLabels, type Guidance, type View } from "./problem.js";
import { codeHash, Workspace, type Practice } from "./workspace.js";
import type { Execution } from "./execution.js";
import { caseCount, resultSummary } from "./results.js";
import { originalProblemUrl } from "./problem-link.js";
import { focusStyle } from "./focus-style.js";
export type WorkbenchAction = "close" | "help" | "guidance" | "discard" | "run" | "submit" | "cases" | "status" | "platform" | "review" | "coach" | "original" | "pick";
// Keep legacy persisted problem/code values as reading/editing states of one page.
const pages: { view: View; key: KeyId; label: string }[] = [
    { view: "problem", key: "f1", label: "做题" },
    { view: "results", key: "f3", label: "结果" },
    { view: "notes", key: "f4", label: "笔记" },
];
const labels: Record<View, string> = { problem: "题目 · 阅读中", code: "代码 · 编辑中", results: "结果", notes: "笔记 · 阅读中" };
type CommandAction = "save" | "preview" | WorkbenchAction;
function padded(line: string, width: number): string {
    const clipped = truncateToWidth(line, width, "");
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}
// Repair emphasis produced by HTML conversion without changing literal examples.
function readingMarkdown(value: string): string {
    let fence: string | undefined;
    return value.split("\n").map(line => {
        const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
        if (marker) {
            if (!fence) fence = marker;
            else if (marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = undefined;
            return line;
        }
        return fence ? line : line.replace(/\*\*([^*\n]*?\S)[ \t]+\*\*/g, "**$1** ");
    }).join("\n");
}
export class Workbench implements Component, Focusable {
    focused = false;
    private codeEditor: Editor;
    private notesEditor: Editor;
    private statement: Markdown;
    private originalLink?: Markdown;
    private linkRegions: { y: number; start: number; end: number }[] = [];
    private expected: {
        code: string;
        notes: string;
    };
    private busy = false;
    private disposed = false;
    private status = "演示题 · 运行仅展示固定结果";
    private error?: string;
    private errorTitle = "保存失败";
    private restoreCursor = true;
    private contentHeight = 10;
    private helpVisible = false;
    private helpOffset = 0;
    private operation = "";
    private tabRegions: { view: View; start: number; end: number }[] = [];
    private commandRegions: { y: number; start: number; end: number; action: CommandAction }[] = [];
    private renderedWidth = 0;
    constructor(private tui: TUI, private theme: Theme, readonly practice: Practice, private workspace: Workspace, private guidance: Guidance, private done: (action: WorkbenchAction) => void, baseline?: {
        code: string;
        notes: string;
    }) {
        const editorTheme = {
            borderColor: (text: string) => theme.fg("border", text),
            selectList: {
                selectedPrefix: (text: string) => theme.fg("accent", text),
                selectedText: (text: string) => theme.fg("accent", text),
                description: (text: string) => theme.fg("muted", text),
                scrollInfo: (text: string) => theme.fg("dim", text),
                noMatch: (text: string) => theme.fg("warning", text),
            },
        };
        this.codeEditor = new Editor(tui, editorTheme, { paddingX: 1 });
        this.notesEditor = new Editor(tui, editorTheme, { paddingX: 1 });
        this.codeEditor.disableSubmit = true;
        this.notesEditor.disableSubmit = true;
        this.codeEditor.setText(practice.code);
        this.notesEditor.setText(practice.notes);
        this.expected = baseline || { code: practice.code, notes: practice.notes };
        const url = originalProblemUrl(workspace.problem);
        const link = url ? `[在 LeetCode 查看原题](${url})` : undefined;
        const statement = workspace.problem.statement.trimEnd();
        const body = link && statement.endsWith(link) ? statement.slice(0, -link.length).trimEnd() : statement;
        this.statement = new Markdown(readingMarkdown(body), 0, 0, { ...getMarkdownTheme(), codeBlockBorder: () => "" });
        if (link) this.originalLink = new Markdown(link, 0, 0, getMarkdownTheme());
        if (workspace.problem.source === "leetcode") this.status = "先读题，再推导；随时可向 Pi 求助";
    }
    private syncDraft(): void {
        this.practice.code = this.codeEditor.getExpandedText();
        this.practice.notes = this.notesEditor.getExpandedText();
        if (!this.restoreCursor)
            this.practice.view.cursor = this.codeEditor.getCursor();
    }
    reportError(message: string, focus = true): void {
        this.error = message;
        this.errorTitle = "操作未完成";
        this.status = `操作未完成：${message}`;
        if (focus) this.practice.view.view = "results";
        this.practice.view.resultOffset = 0;
        if (!this.disposed) this.tui.requestRender();
    }
    setOperation(message: string): void {
        this.operation = message;
        if (!this.disposed) this.tui.requestRender();
    }
    setExecution(record: Execution): void {
        this.practice.result = record;
        this.status = record.state === "complete" ? `结果已就绪：${record.message}` : record.message;
        if (!this.disposed) this.tui.requestRender();
    }
    get dirty(): boolean {
        return this.codeEditor.getExpandedText() !== this.expected.code ||
            this.notesEditor.getExpandedText() !== this.expected.notes;
    }
    get baseline(): {
        code: string;
        notes: string;
    } { return { ...this.expected }; }
    private async save(): Promise<void> {
        this.syncDraft();
        await this.workspace.save(this.practice, this.expected);
        this.expected = { code: this.practice.code, notes: this.practice.notes };
        this.status = "已保存代码、笔记和阅读位置";
        this.error = undefined;
    }
    private async perform(action: "save" | "preview" | WorkbenchAction): Promise<void> {
        if (this.busy || this.disposed)
            return;
        if (action === "discard") {
            this.syncDraft();
            this.done("discard");
            return;
        }
        this.busy = true;
        this.status = "正在保存…";
        this.tui.requestRender();
        try {
            await this.save();
            if (action === "preview") {
                if (this.workspace.problem.source === "leetcode") { this.done("run"); return; }
                this.practice.result = await this.workspace.previewResult(this.practice);
                this.practice.view.view = "results";
                this.practice.view.resultOffset = 0;
                await this.save();
                this.status = "固定失败结果已加载 · 未执行代码";
            }
            else if (action !== "save") {
                this.done(action);
            }
        }
        catch (error) {
            this.errorTitle = "保存失败";
            this.error = (error as Error).message;
            this.practice.view.view = "results";
            this.practice.view.resultOffset = 0;
            this.status = `保存失败：${this.error}`;
        }
        finally {
            this.busy = false;
            if (!this.disposed)
                this.tui.requestRender();
        }
    }
    private get editing(): boolean {
        return this.practice.view.view === "code" || (this.practice.view.view === "notes" && this.practice.view.notesEditing === true);
    }
    private selectPage(view: View): void {
        this.practice.view.view = view;
        this.practice.view.notesEditing = false;
    }
    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        if (this.busy || this.disposed || this.helpVisible || event.width !== this.renderedWidth) return;
        if (event.button !== "left" || !["press", "click"].includes(event.type)) return;
        if (this.linkRegions.some(link => event.y === link.y && event.x >= link.start && event.x < link.end)) {
            // Capture press, activate on the single synthesized click after release.
            // Opening on both press and click can launch the browser twice.
            if (event.type === "press") return { handled: true, capture: true };
            if ((event.clickCount ?? 1) === 1) void this.perform("original");
            return { handled: true };
        }
        const command = this.commandRegions.find(item => event.y === item.y && event.x >= item.start && event.x < item.end);
        if (command) {
            if (event.type === "press") return { handled: true, capture: true };
            if ((event.clickCount ?? 1) === 1) void this.perform(command.action);
            return { handled: true };
        }
        if (event.y !== 2) return;
        const tab = this.tabRegions.find(tab => event.x >= tab.start && event.x < tab.end);
        if (!tab) return;
        this.selectPage(tab.view);
        this.tui.requestRender();
        return { handled: true, focus: true };
    }
    handleInput(data: string): void {
        if (this.busy || this.disposed)
            return;
        if (matchesKey(data, "f5") || (this.helpVisible && matchesKey(data, "escape"))) {
            this.helpVisible = !this.helpVisible; this.helpOffset = 0; this.tui.requestRender(); return;
        }
        if (this.helpVisible) {
            this.helpOffset = Math.max(0, this.helpOffset + (matchesKey(data, "down") ? 1 : matchesKey(data, "up") ? -1 : 0));
            this.tui.requestRender(); return;
        }
        if (matchesKey(data, "escape")) {
            if (this.practice.view.view === "problem") void this.perform("close");
            else {
                if (this.practice.view.view === "notes" && this.editing) this.practice.view.notesEditing = false;
                else this.selectPage("problem");
                this.tui.requestRender();
            }
            return;
        }
        if (this.error && matchesKey(data, "ctrl+o")) {
            this.syncDraft(); this.busy = true;
            void this.workspace.saveDraft(this.practice).then(path => {
                this.error = `草稿已另存到 ${path}。可安全关闭后重新打开题目，读取磁盘版本。`;
            }).catch(error => { this.error = (error as Error).message; }).finally(() => { this.busy = false; this.tui.requestRender(); });
            return;
        }
        const keys: [
            KeyId,
            "save" | "preview" | WorkbenchAction
        ][] = [
            ["ctrl+s", "save"], ["ctrl+r", "preview"], ["ctrl+h", "help"],
            ["ctrl+g", "guidance"], ["ctrl+q", "discard"],
            ["ctrl+t", "submit"], ["ctrl+e", "cases"],
            ["f6", "coach"], ["f7", "original"], ["f8", "pick"], ["ctrl+p", "status"], ["ctrl+b", "platform"], ["ctrl+v", "review"],
        ];
        for (const [key, action] of keys) {
            if (matchesKey(data, key)) {
                void this.perform(action);
                return;
            }
        }
        const page = pages.find(item => matchesKey(data, item.key));
        const direction = matchesKey(data, "right") ? 1 : matchesKey(data, "left") ? -1 : 0;
        if (page) {
            this.selectPage(page.view);
        } else if (!this.editing && direction) {
            const index = pages.findIndex(item => item.view === this.practice.view.view);
            this.selectPage(pages[(index + direction + pages.length) % pages.length]!.view);
        } else if (!this.editing && matchesKey(data, "enter")) {
            if (this.practice.view.view === "problem") this.practice.view.view = "code";
            else if (this.practice.view.view === "notes") this.practice.view.notesEditing = true;
        }
        else if (this.editing) {
            const editor = this.practice.view.view === "code" ? this.codeEditor : this.notesEditor;
            if (matchesKey(data, "tab")) editor.insertTextAtCursor("    ");
            else if (matchesKey(data, "shift+tab")) {
                const cursor = editor.getCursor();
                const leading = /^ {1,4}/.exec(editor.getLines()[cursor.line] || "")?.[0].length ?? 0;
                if (leading) {
                    editor.handleInput("\x01");
                    for (let i = 0; i < leading; i++) editor.handleInput("\x1b[3~");
                    const col = Math.max(0, cursor.col - leading);
                    while (editor.getCursor().col < col) editor.handleInput("\x1b[C");
                }
            }
            else if (matchesKey(data, "enter"))
                editor.handleInput("\n");
            else
                editor.handleInput(data);
        }
        else {
            if (this.practice.view.view === "results" && this.practice.result?.source === "leetcode") {
                if (data === "d") { this.practice.view.resultDetails = !this.practice.view.resultDetails; this.practice.view.resultOffset = 0; }
                const delta = matchesKey(data, "shift+right") ? 1 : matchesKey(data, "shift+left") ? -1 : 0;
                if (delta) {
                    this.practice.view.caseIndex = Math.max(0, Math.min((this.practice.view.caseIndex ?? 0) + delta, caseCount(this.practice.result) - 1));
                    this.practice.view.resultOffset = 0;
                }
            }
            const step = matchesKey(data, "pageDown") ? this.contentHeight :
                matchesKey(data, "pageUp") ? -this.contentHeight :
                    matchesKey(data, "down") ? 1 : matchesKey(data, "up") ? -1 : 0;
            const key = this.practice.view.view === "problem" ? "problemOffset" : this.practice.view.view === "notes" ? "notesOffset" : "resultOffset";
            this.practice.view[key] = Math.max(0, (this.practice.view[key] ?? 0) + step);
        }
        this.tui.requestRender();
    }
    private editorLines(width: number, editor: Editor, restore: boolean, active = true): string[] {
        editor.focused = this.focused && active;
        let lines = editor.render(width);
        if (restore && this.restoreCursor) {
            // Restore through the public keyboard interface, without private editor state.
            const cursor = this.practice.view.cursor;
            const targetLine = Math.max(0, Math.min(cursor.line, editor.getLines().length - 1));
            for (let attempts = 0; attempts < this.practice.code.length + 1 && editor.getCursor().line > targetLine; attempts++) {
                editor.handleInput("\x1b[A");
            }
            editor.handleInput("\x01");
            const targetCol = Math.min(cursor.col, (editor.getLines()[targetLine] || "").length);
            for (let attempts = 0; attempts < targetCol && editor.getCursor().col < targetCol; attempts++)
                editor.handleInput("\x1b[C");
            this.restoreCursor = false;
            lines = editor.render(width);
        }
        // Pi's chat editor always paints an inverse-video caret, even when unfocused.
        // Remove only that caret style from the inactive pane; keep the native editor and IME marker when focused.
        if (!active) lines = lines.map(line => line.replace(/\x1b\[7m/g, ""));
        if (!lines[0]?.includes("↑")) lines.shift();
        if (!lines.at(-1)?.includes("↓")) lines.pop();
        // In very small windows the command area can be taller than Pi's chat editor expects.
        // Keep the editing caret in view instead of clipping the last editable row.
        const caret = lines.findIndex(line => line.includes("\x1b[7m"));
        if (active && caret >= this.contentHeight) return lines.slice(caret - this.contentHeight + 1, caret + 1);
        return lines;
    }
    private problemLines(width: number): string[] {
        const content = this.statement.render(width);
        const linkLines = this.originalLink?.render(width) ?? [];
        const all = linkLines.length ? [...content, "", ...linkLines] : content;
        this.practice.view.problemOffset = Math.min(this.practice.view.problemOffset, Math.max(0, all.length - this.contentHeight));
        // The statement pane starts at (0,3); its content starts at (2,4).
        // Register only visible link cells, including every wrapped URL line.
        for (const [index, line] of linkLines.entries()) {
            const row = content.length + 1 + index - this.practice.view.problemOffset;
            const length = Math.min(width, visibleWidth(line));
            if (row >= 0 && row < this.contentHeight && length > 0)
                this.linkRegions.push({ y: 4 + row, start: 2, end: 2 + length });
        }
        return all.slice(this.practice.view.problemOffset, this.practice.view.problemOffset + this.contentHeight);
    }
    private notesLines(width: number): string[] {
        // Render the live draft, not the last saved notes; reading never moves the editor cursor.
        const lines = new Markdown(this.notesEditor.getExpandedText(), 0, 0, getMarkdownTheme()).render(width);
        const offset = Math.min(this.practice.view.notesOffset ?? 0, Math.max(0, lines.length - this.contentHeight));
        this.practice.view.notesOffset = offset;
        return lines.slice(offset, offset + this.contentHeight);
    }
    private resultLines(width: number): string[] {
        const result = this.practice.result;
        const stale = result && result.codeHash !== codeHash(this.codeEditor.getExpandedText()) ? "代码已变化，此结果来自之前版本。\n\n" : "";
        const text = this.error ? `# ${this.errorTitle}\n\n${this.error}\n\n当前草稿仍在编辑器中。F1 返回做题，Enter 开始写代码；F4 查看笔记。Ctrl+O 另存草稿；Ctrl+Q 关闭后重新打开可读取磁盘版本。` : result?.source === "leetcode" ? stale + resultSummary(result, this.practice.view.caseIndex, this.practice.view.resultDetails) : result ? `# 固定测试结果预览\n\n${result.message}\n\n` +
            `- 输入：${result.input}\n- 预期：${result.expected}\n- 实际：${result.actual}\n\n` +
            `记录时间：${result.createdAt}\n\n` +
            (result.codeHash !== codeHash(this.codeEditor.getExpandedText()) ? "代码已变化，此预览记录来自之前版本。\n\n" : "") +
            "正式测试与提交尚未接入。此结果不能证明代码正确或错误。" :
            (this.workspace.problem.source === "leetcode" ? "# 尚无结果\n\nCtrl+R 在线运行 · Ctrl+T 正式提交 · Ctrl+E 编辑用例\n\n首次运行或提交时会引导连接账户；现在可直接读题和编辑。" : "# 尚无结果\n\nCtrl+R 加载固定失败结果预览。不会执行代码，也不会提交到 LeetCode。");
        const lines = new Markdown(text, 0, 0, getMarkdownTheme()).render(width);
        this.practice.view.resultOffset = Math.min(this.practice.view.resultOffset, Math.max(0, lines.length - this.contentHeight));
        return lines.slice(this.practice.view.resultOffset, this.practice.view.resultOffset + this.contentHeight);
    }
    render(width: number): string[] {
        const height = this.tui.terminal.rows;
        this.renderedWidth = width;
        this.tabRegions = [];
        this.linkRegions = [];
        this.commandRegions = [];
        if (width < 32 || height < 16) {
            return ["终端过小，请扩大至至少 32×16。", this.practice.view.view === "problem" ? "Esc 保存返回 · Ctrl+Q 关闭" : "Esc 返回阅读/做题 · Ctrl+Q 关闭"].map(line => truncateToWidth(line, width));
        }
        if (this.helpVisible) {
            const lines = ["快捷键 · F5 / Esc 返回 · ↑ ↓ 滚动", "F1 做题 · F3 结果 · F4 笔记", "点击页签直接切页并操作", "点击题面底部链接 / F7 去leetcode查看原题：保存后在浏览器打开原题", "F8 选题：保存草稿后打开题库；取消保留原题与原位置", "题库：↑↓ 选择 · Enter 打开 · ←→ 翻页 · Tab 切换筛选", "阅读态 ←/→ 循环切页；↑↓ / PgUp / PgDn 滚动", "题目 Enter 写代码；笔记 Enter 编辑", "编辑时 Esc 返回当前页阅读；结果/笔记阅读时 Esc 返回做题", "编辑区 Tab 缩进 4 空格；Shift+Tab 减少行首缩进", "Ctrl+S 保存；编辑区 Enter 换行", "Ctrl+R 运行样例（未连接时引导登录）", "Ctrl+T 正式提交到当前账户", "Ctrl+E 编辑用例", "结果页 Shift+←/→ 切换用例；d 执行详情", "Ctrl+P 恢复查询（不重新发送）", "Ctrl+B 打开平台记录", "F6 开始 / 继续带练（先保存，进入 Pi 对话）", "Ctrl+H 求助 · Ctrl+G 调整引导", "Ctrl+V 复盘与学习记录", "保存冲突：Ctrl+O 另存草稿", "阅读题目时 Esc：保存返回 Pi，停止本地等待", "Ctrl+Q 关闭；未保存草稿需确认", "远程任务不会因关闭界面而取消", "回答后 /leet 返回原编辑位置"];
            const items = lines.slice(1), available = height - 2;
            this.helpOffset = Math.min(this.helpOffset, Math.max(0, items.length - available));
            return [lines[0]!, ...Array.from({ length: available }, (_, i) => items[this.helpOffset + i] || ""), "F5 / Esc 返回原位置"]
                .map(line => truncateToWidth(line, width));
        }
        const view = this.practice.view.view;
        const fg = (color: Parameters<Theme["fg"]>[0], text: string) => this.theme.fg(color, text);
        const row = (left: string, right: string) => {
            const room = Math.max(0, width - visibleWidth(right) - 2);
            return padded(left, room) + "  " + right;
        };
        const header = row(fg("accent", ` ${this.workspace.problem.id} · ${this.workspace.problem.title}`), fg("muted", "pi-leetcode "));
        const metadata = row(` ${guidanceLabels[this.guidance]} · ${this.workspace.problem.source === "demo" ? "演示题" : "中国站"} · Go`,
            fg(this.dirty ? "warning" : "muted", this.dirty ? "未保存 ● " : "已保存 "));
        let tabColumn = 0;
        const currentPage = view === "code" ? "problem" : view;
        const tabs = pages.map(item => {
            const selected = item.view === currentPage;
            const label = ` ${selected ? "● " : ""}${item.key.toUpperCase()} ${item.label} `;
            this.tabRegions.push({ view: item.view, start: tabColumn, end: tabColumn + visibleWidth(label) });
            tabColumn += visibleWidth(label);
            return fg(selected ? "accent" : "muted", label);
        }).join("");
        const commands: [string, string, CommandAction?][] = [
            ["Ctrl+S", "保存", "save"], ["Ctrl+R", this.workspace.problem.source === "demo" ? "演示" : "运行", "preview"],
            ["Ctrl+T", "提交", "submit"], ["Ctrl+E", "用例", "cases"], ["Ctrl+H", "求助", "help"], ["F6", "带练", "coach"],
            ["Ctrl+G", "引导", "guidance"], ["Esc", view === "problem" ? "返回Pi" : this.editing ? "返回阅读" : "返回做题"], ["F5", "更多"],
        ];
        if (this.originalLink) commands.push(["F7", "去leetcode查看原题", "original"]);
        commands.push(["F8", "选题", "pick"]);
        if (this.editing) commands.unshift(["Enter", "换行"], ["Tab", "缩进"]);
        else {
            const reading: [string, string][] = [["←/→", "切页"], ["↑/↓", "阅读"]];
            if (view === "problem" || view === "notes") reading.push(["Enter", view === "problem" ? "写代码" : "编辑笔记"]);
            commands.unshift(...reading);
        }
        if (view === "results") commands.push(["Shift+←/→", "用例"], ["d", "详情"], ["Ctrl+P", "查询", "status"]);
        const commandRows: string[] = [];
        const commandTokens: { row: number; start: number; end: number; action: CommandAction }[] = [];
        let commandRow = "";
        for (const [key, label, action] of commands) {
            const token = fg("accent", key) + ` ${label}`;
            if (commandRow && visibleWidth(commandRow) + 2 + visibleWidth(token) > width - 7) {
                commandRows.push(commandRow); commandRow = "";
            }
            if (action) {
                const start = commandRow ? visibleWidth(commandRow) + 2 : 0;
                commandTokens.push({ row: commandRows.length, start, end: start + visibleWidth(token), action });
            }
            commandRow += (commandRow ? "  " : "") + token;
        }
        if (commandRow) commandRows.push(commandRow);
        const context = { problem: "阅读题目", code: "编辑代码", results: "查看结果", notes: this.editing ? "编辑笔记" : "阅读笔记" }[view];
        const footer = [
            fg(this.error ? "error" : "muted", `状态 │ ${context} · ${this.operation || this.status}`),
            ...commandRows.map((line, i) => fg("muted", i === 0 ? "操作 │ " : "       ") + line),
        ];
        this.contentHeight = height - 5 - footer.length;
        // Body pane: 1 top border + contentHeight rows + 1 bottom border, starting at y=3.
        // Command rows render after a 7-column "操作 │ " / indent prefix.
        this.commandRegions = commandTokens.map(token => ({ y: 3 + this.contentHeight + 3 + token.row, start: 7 + token.start, end: 7 + token.end, action: token.action }));

        const pane = (lines: string[], columns: number, title: string, active: boolean) => {
            const color = active ? "accent" : "borderMuted";
            const label = truncateToWidth(` ${active ? "▸ " : ""}${title} `, columns - 2, "");
            const top = fg(color, "╭") + (active ? focusStyle(this.theme, label) : fg(color, label)) +
                fg(color, "─".repeat(Math.max(0, columns - 2 - visibleWidth(label))) + "╮");
            const body = Array.from({ length: this.contentHeight }, (_, i) => fg(color, "│") + " " + padded(lines[i] || "", columns - 4) + " " + fg(color, "│"));
            return [top, ...body, fg(color, "╰" + "─".repeat(columns - 2) + "╯")];
        };
        let body: string[];
        this.codeEditor.focused = false;
        this.notesEditor.focused = false;
        if (width >= 100 && (view === "problem" || view === "code")) {
            const leftWidth = Math.floor((width - 1) / 2), rightWidth = width - leftWidth - 1;
            const left = pane(this.problemLines(leftWidth - 4), leftWidth, view === "problem" ? labels.problem : "题目 · 只读", view === "problem");
            const right = pane(this.editorLines(rightWidth - 4, this.codeEditor, true, view === "code"), rightWidth, view === "code" ? "代码 · 编辑中 · solution.go" : "代码 · solution.go", view === "code");
            body = left.map((line, i) => line + " " + right[i]);
        } else {
            const lines = view === "problem" ? this.problemLines(width - 4) :
                view === "code" ? this.editorLines(width - 4, this.codeEditor, true) :
                view === "notes" ? (this.editing ? this.editorLines(width - 4, this.notesEditor, false) : this.notesLines(width - 4)) : this.resultLines(width - 4);
            const title = view === "code" ? "代码 · 编辑中 · solution.go" : view === "notes" && this.editing ? "笔记 · 编辑中" : labels[view];
            body = pane(lines, width, title, true);
        }
        return [header, metadata, tabs, ...body, ...footer].map(line => truncateToWidth(line, width));
    }

    invalidate(): void {
        this.codeEditor.invalidate();
        this.notesEditor.invalidate();
        this.statement.invalidate();
        this.originalLink?.invalidate();
    }
    dispose(): void { this.disposed = true; }
}
