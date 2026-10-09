import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Markdown, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI, type KeyId, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import { guidanceLabels, type Guidance, type View } from "./problem.js";
import { codeHash, Workspace, type Practice } from "./workspace.js";
import type { Execution } from "./execution.js";
import { caseCount, resultSummary } from "./results.js";
export type WorkbenchAction = "close" | "help" | "guidance" | "discard" | "run" | "submit" | "cases" | "status" | "platform" | "review" | "coach";
const views: View[] = ["problem", "code", "results", "notes"];
const labels: Record<View, string> = { problem: "题目", code: "代码", results: "结果", notes: "笔记" };
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
    private tabsFocused = false;
    private tabRegions: { view: View; start: number; end: number }[] = [];
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
        this.statement = new Markdown(readingMarkdown(workspace.problem.statement), 0, 0, { ...getMarkdownTheme(), codeBlockBorder: () => "" });
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
        if (focus) { this.practice.view.view = "results"; this.tabsFocused = false; }
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
            this.tabsFocused = false;
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
    handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
        if (this.busy || this.disposed || this.helpVisible || event.width !== this.renderedWidth) return;
        if (event.y !== 2 || event.button !== "left" || !["press", "click"].includes(event.type)) return;
        const tab = this.tabRegions.find(tab => event.x >= tab.start && event.x < tab.end);
        if (!tab) return;
        this.practice.view.view = tab.view;
        this.tabsFocused = false;
        this.tui.requestRender();
        return { handled: true, focus: true };
    }
    handleInput(data: string): void {
        if (this.busy)
            return;
        if (matchesKey(data, "f5") || (this.helpVisible && matchesKey(data, "escape"))) {
            this.helpVisible = !this.helpVisible; this.helpOffset = 0; this.tui.requestRender(); return;
        }
        if (this.helpVisible) {
            this.helpOffset = Math.max(0, this.helpOffset + (matchesKey(data, "down") ? 1 : matchesKey(data, "up") ? -1 : 0));
            this.tui.requestRender(); return;
        }
        if (matchesKey(data, "escape")) {
            if (this.tabsFocused) void this.perform("close");
            else { this.tabsFocused = true; this.tui.requestRender(); }
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
            ["f6", "coach"], ["ctrl+p", "status"], ["ctrl+b", "platform"], ["ctrl+v", "review"],
        ];
        for (const [key, action] of keys) {
            if (matchesKey(data, key)) {
                void this.perform(action);
                return;
            }
        }
        const viewKeys: KeyId[] = ["f1", "f2", "f3", "f4"];
        const view = views.find((_value, index) => matchesKey(data, viewKeys[index]!));
        if (view) {
            this.practice.view.view = view;
            this.tabsFocused = false;
        } else if (this.tabsFocused) {
            const direction = matchesKey(data, "right") ? 1 : matchesKey(data, "left") ? -1 : 0;
            if (direction) this.practice.view.view = views[(views.indexOf(this.practice.view.view) + direction + views.length) % views.length]!;
            if (matchesKey(data, "enter")) this.tabsFocused = false;
        }
        else if (this.practice.view.view === "code" || this.practice.view.view === "notes") {
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
                const delta = matchesKey(data, "right") ? 1 : matchesKey(data, "left") ? -1 : 0;
                if (delta) {
                    this.practice.view.caseIndex = Math.max(0, Math.min((this.practice.view.caseIndex ?? 0) + delta, caseCount(this.practice.result) - 1));
                    this.practice.view.resultOffset = 0;
                }
            }
            const step = matchesKey(data, "pageDown") ? this.contentHeight :
                matchesKey(data, "pageUp") ? -this.contentHeight :
                    matchesKey(data, "down") ? 1 : matchesKey(data, "up") ? -1 : 0;
            const key = this.practice.view.view === "problem" ? "problemOffset" : "resultOffset";
            this.practice.view[key] = Math.max(0, this.practice.view[key] + step);
        }
        this.tui.requestRender();
    }
    private editorLines(width: number, editor: Editor, restore: boolean, active = true): string[] {
        active = active && !this.tabsFocused;
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
        const all = this.statement.render(width);
        this.practice.view.problemOffset = Math.min(this.practice.view.problemOffset, Math.max(0, all.length - this.contentHeight));
        return all.slice(this.practice.view.problemOffset, this.practice.view.problemOffset + this.contentHeight);
    }
    private resultLines(width: number): string[] {
        const result = this.practice.result;
        const stale = result && result.codeHash !== codeHash(this.codeEditor.getExpandedText()) ? "代码已变化，此结果来自之前版本。\n\n" : "";
        const text = this.error ? `# ${this.errorTitle}\n\n${this.error}\n\n当前草稿仍在编辑器中。F2 返回代码，F4 查看笔记。Ctrl+O 另存草稿；Ctrl+Q 关闭后重新打开可读取磁盘版本。` : result?.source === "leetcode" ? stale + resultSummary(result, this.practice.view.caseIndex, this.practice.view.resultDetails) : result ? `# 固定测试结果预览\n\n${result.message}\n\n` +
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
        if (width < 32 || height < 16) {
            return ["终端过小，请扩大至至少 32×16。", this.tabsFocused ? "Esc 保存返回 · Ctrl+Q 关闭" : "Esc 聚焦页签 · 再按 Esc 返回"].map(line => truncateToWidth(line, width));
        }
        if (this.helpVisible) {
            const lines = ["快捷键 · F5 / Esc 返回 · ↑ ↓ 滚动", "F1 题目 · F2 代码 · F3 结果 · F4 笔记", "点击页签直接切换并进入对应区域", "Esc 聚焦页签；← → 切页；Enter 进入", "编辑区 Tab 缩进 4 空格；Shift+Tab 减少行首缩进", "Ctrl+S 保存；编辑区 Enter 换行", "Ctrl+R 运行样例（未连接时引导登录）", "Ctrl+T 正式提交到当前账户", "Ctrl+E 编辑用例", "结果页 ← → 切换用例；d 执行详情", "Ctrl+P 恢复查询（不重新发送）", "Ctrl+B 打开平台记录", "F6 开始 / 继续带练（先保存，进入 Pi 对话）", "Ctrl+H 求助 · Ctrl+G 调整引导", "Ctrl+V 复盘与学习记录", "保存冲突：Ctrl+O 另存草稿", "页签栏再按 Esc：保存返回 Pi，停止本地等待", "Ctrl+Q 关闭；未保存草稿需确认", "远程任务不会因关闭界面而取消", "回答后 /leet 返回原编辑位置"];
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
        const tabs = views.map((item, i) => {
            const label = ` ${item === view ? "▸ " : ""}F${i + 1} ${width < 60 ? labels[item].slice(0, 1) : labels[item]} `;
            this.tabRegions.push({ view: item, start: tabColumn, end: tabColumn + visibleWidth(label) });
            tabColumn += visibleWidth(label);
            return item === view ? fg("accent", `\x1b[1m\x1b[7m${label}\x1b[27m\x1b[22m`) : fg("muted", label);
        }).join("");
        const commands: [string, string][] = [
            ["Ctrl+S", "保存"], ["Ctrl+R", this.workspace.problem.source === "demo" ? "演示" : "运行"],
            ["Ctrl+T", "提交"], ["Ctrl+E", "用例"], ["Ctrl+H", "求助"], ["F6", "带练"],
            ["Ctrl+G", "引导"], ["Esc", this.tabsFocused ? "返回Pi" : "切页"], ["F5", "更多"],
        ];
        if (this.tabsFocused) commands.unshift(["←/→", "切页"], ["Enter", "进入"]);
        if (view === "results" && !this.tabsFocused) commands.push(["←/→", "用例"], ["d", "详情"], ["Ctrl+P", "查询"]);
        const commandRows: string[] = [];
        let commandRow = "";
        for (const [key, label] of commands) {
            const token = fg("accent", key) + ` ${label}`;
            if (commandRow && visibleWidth(commandRow) + 2 + visibleWidth(token) > width - 7) {
                commandRows.push(commandRow); commandRow = "";
            }
            commandRow += (commandRow ? "  " : "") + token;
        }
        if (commandRow) commandRows.push(commandRow);
        const footer = [
            fg(this.error ? "error" : "muted", `状态 │ ${this.tabsFocused ? "页签导航中" + (this.operation ? " · " + this.operation : "") : this.operation || this.status}`),
            ...commandRows.map((line, i) => fg("muted", i === 0 ? "操作 │ " : "       ") + line),
        ];
        this.contentHeight = height - 5 - footer.length;

        const pane = (lines: string[], columns: number, title: string, active: boolean) => {
            active = active && !this.tabsFocused;
            const color = active ? "accent" : "borderMuted";
            const label = truncateToWidth(` ${active ? "▸ " : ""}${title} `, columns - 2, "");
            const top = fg(color, "╭" + label + "─".repeat(Math.max(0, columns - 2 - visibleWidth(label))) + "╮");
            const body = Array.from({ length: this.contentHeight }, (_, i) => fg(color, "│") + " " + padded(lines[i] || "", columns - 4) + " " + fg(color, "│"));
            return [top, ...body, fg(color, "╰" + "─".repeat(columns - 2) + "╯")];
        };
        let body: string[];
        this.codeEditor.focused = false;
        this.notesEditor.focused = false;
        if (width >= 100 && (view === "problem" || view === "code")) {
            const leftWidth = Math.floor((width - 1) / 2), rightWidth = width - leftWidth - 1;
            const left = pane(this.problemLines(leftWidth - 4), leftWidth, "F1 题目 · ↑↓ 阅读", view === "problem");
            const right = pane(this.editorLines(rightWidth - 4, this.codeEditor, true, view === "code"), rightWidth, "F2 solution.go", view === "code");
            body = left.map((line, i) => line + " " + right[i]);
        } else {
            const lines = view === "problem" ? this.problemLines(width - 4) :
                view === "code" ? this.editorLines(width - 4, this.codeEditor, true) :
                view === "notes" ? this.editorLines(width - 4, this.notesEditor, false) : this.resultLines(width - 4);
            body = pane(lines, width, view === "code" ? "solution.go · Go" : labels[view], true);
        }
        return [header, metadata, tabs, ...body, ...footer].map(line => truncateToWidth(line, width));
    }

    invalidate(): void {
        this.codeEditor.invalidate();
        this.notesEditor.invalidate();
        this.statement.invalidate();
    }
    dispose(): void { this.disposed = true; }
}
