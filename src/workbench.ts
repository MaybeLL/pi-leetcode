import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Markdown, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI, type KeyId } from "@earendil-works/pi-tui";
import { demoProblem, guidanceLabels, type Guidance, type View } from "./problem.js";
import { codeHash, Workspace, type Practice } from "./workspace.js";
export type WorkbenchAction = "close" | "help" | "guidance" | "discard";
const views: View[] = ["problem", "code", "results", "notes"];
const labels: Record<View, string> = { problem: "题目", code: "代码", results: "结果", notes: "笔记" };
function padded(line: string, width: number): string {
    const clipped = truncateToWidth(line, width, "");
    return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
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
    private status = "演示原型 · 编辑可保存 · 测试只预览固定结果";
    private error?: string;
    private restoreCursor = true;
    private contentHeight = 10;
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
        this.statement = new Markdown(demoProblem.statement, 0, 0, getMarkdownTheme());
    }
    private syncDraft(): void {
        this.practice.code = this.codeEditor.getExpandedText();
        this.practice.notes = this.notesEditor.getExpandedText();
        if (!this.restoreCursor)
            this.practice.view.cursor = this.codeEditor.getCursor();
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
            this.error = (error as Error).message;
            this.practice.view.view = "results";
            this.practice.view.resultOffset = 0;
            this.status = "保存失败 · F3 查看原因 · F2 返回草稿";
        }
        finally {
            this.busy = false;
            if (!this.disposed)
                this.tui.requestRender();
        }
    }
    handleInput(data: string): void {
        if (this.busy)
            return;
        const keys: [
            KeyId,
            "save" | "preview" | WorkbenchAction
        ][] = [
            ["ctrl+s", "save"], ["ctrl+r", "preview"], ["ctrl+h", "help"],
            ["ctrl+g", "guidance"], ["escape", "close"], ["ctrl+q", "discard"],
        ];
        for (const [key, action] of keys) {
            if (matchesKey(data, key)) {
                void this.perform(action);
                return;
            }
        }
        const viewKeys: KeyId[] = ["f1", "f2", "f3", "f4"];
        const view = views.find((_value, index) => matchesKey(data, viewKeys[index]!));
        if (view)
            this.practice.view.view = view;
        else if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
            const direction = matchesKey(data, "shift+tab") ? -1 : 1;
            this.practice.view.view = views[(views.indexOf(this.practice.view.view) + direction + views.length) % views.length]!;
        }
        else if (this.practice.view.view === "code" || this.practice.view.view === "notes") {
            const editor = this.practice.view.view === "code" ? this.codeEditor : this.notesEditor;
            if (matchesKey(data, "enter"))
                editor.handleInput("\n");
            else
                editor.handleInput(data);
        }
        else {
            const step = matchesKey(data, "pageDown") ? this.contentHeight :
                matchesKey(data, "pageUp") ? -this.contentHeight :
                    matchesKey(data, "down") ? 1 : matchesKey(data, "up") ? -1 : 0;
            const key = this.practice.view.view === "problem" ? "problemOffset" : "resultOffset";
            this.practice.view[key] = Math.max(0, this.practice.view[key] + step);
        }
        this.tui.requestRender();
    }
    private editorLines(width: number, editor: Editor, restore: boolean): string[] {
        editor.focused = this.focused;
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
        return lines;
    }
    private problemLines(width: number): string[] {
        const all = this.statement.render(width);
        this.practice.view.problemOffset = Math.min(this.practice.view.problemOffset, Math.max(0, all.length - this.contentHeight));
        return all.slice(this.practice.view.problemOffset, this.practice.view.problemOffset + this.contentHeight);
    }
    private resultLines(width: number): string[] {
        const result = this.practice.result;
        const text = this.error ? `# 保存失败\n\n${this.error}\n\n当前草稿仍在编辑器中。F2 返回代码，F4 查看笔记。Ctrl+Q 可关闭并确认丢弃草稿。` : result ? `# 固定测试结果预览\n\n${result.message}\n\n` +
            `- 输入：${result.input}\n- 预期：${result.expected}\n- 实际：${result.actual}\n\n` +
            `记录时间：${result.createdAt}\n\n` +
            (result.codeHash !== codeHash(this.codeEditor.getExpandedText()) ? "代码已变化，此预览记录来自之前版本。\n\n" : "") +
            "正式测试与提交尚未接入。此结果不能证明代码正确或错误。" :
            "# 尚无结果\n\nCtrl+R 加载固定失败结果预览。不会执行代码，也不会提交到 LeetCode。";
        const lines = new Markdown(text, 0, 0, getMarkdownTheme()).render(width);
        this.practice.view.resultOffset = Math.min(this.practice.view.resultOffset, Math.max(0, lines.length - this.contentHeight));
        return lines.slice(this.practice.view.resultOffset, this.practice.view.resultOffset + this.contentHeight);
    }
    render(width: number): string[] {
        const height = this.tui.terminal.rows;
        if (width < 32 || height < 16) {
            return ["终端过小，请扩大至至少 32×16。", "Esc 保存返回 · Ctrl+Q 关闭草稿"].map(line => truncateToWidth(line, width));
        }
        this.contentHeight = Math.max(7, height - 9);
        const view = this.practice.view.view;
        const header = this.theme.fg("accent", "pi-leetcode · 两数之和") + "  Go · 演示原型";
        const tabs = views.map((item, i) => `${i + 1} ${item === view ? `[${labels[item]}]` : labels[item]}`).join("  ");
        let body: string[];
        this.codeEditor.focused = false;
        this.notesEditor.focused = false;
        if (width >= 100 && (view === "problem" || view === "code")) {
            const leftWidth = Math.floor((width - 3) * 0.45);
            const rightWidth = width - leftWidth - 3;
            const left = this.problemLines(leftWidth);
            const right = this.editorLines(rightWidth, this.codeEditor, true);
            this.codeEditor.focused = this.focused && view === "code";
            const focusedRight = this.codeEditor.render(rightWidth);
            body = Array.from({ length: this.contentHeight }, (_, i) => padded(left[i] || "", leftWidth) + this.theme.fg("border", " │ ") + padded(focusedRight[i] || right[i] || "", rightWidth));
        }
        else {
            body = view === "problem" ? this.problemLines(width) :
                view === "code" ? this.editorLines(width, this.codeEditor, true) :
                    view === "notes" ? this.editorLines(width, this.notesEditor, false) : this.resultLines(width);
            body = Array.from({ length: this.contentHeight }, (_, i) => body[i] || "");
        }
        const footer = [
            `F1–F4 / Tab 切换 · 当前焦点：${labels[view]} · Enter 换行`,
            "Ctrl+S 保存 · Ctrl+R 演示结果 · Ctrl+H 求助 · Ctrl+G 引导",
            "Esc 保存并返回 Pi · Ctrl+Q 关闭（有草稿会确认）",
        ];
        return [header, `${guidanceLabels[this.guidance]} · ${this.dirty ? "有未保存修改" : "已保存"}`, tabs,
            "─".repeat(width), ...body, this.theme.fg("muted", this.status), ...footer]
            .map(line => truncateToWidth(line, width));
    }
    invalidate(): void {
        this.codeEditor.invalidate();
        this.notesEditor.invalidate();
        this.statement.invalidate();
    }
    dispose(): void { this.disposed = true; }
}
