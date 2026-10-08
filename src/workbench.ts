import { getMarkdownTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { Editor, Markdown, matchesKey, truncateToWidth, visibleWidth, type Component, type Focusable, type TUI, type KeyId } from "@earendil-works/pi-tui";
import { guidanceLabels, type Guidance, type View } from "./problem.js";
import { codeHash, Workspace, type Practice } from "./workspace.js";
import type { Execution } from "./execution.js";
import { caseCount, resultSummary } from "./results.js";
export type WorkbenchAction = "close" | "help" | "guidance" | "discard" | "run" | "submit" | "cases" | "status" | "platform" | "review";
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
    private errorTitle = "保存失败";
    private restoreCursor = true;
    private contentHeight = 10;
    private helpVisible = false;
    private helpOffset = 0;
    private operation = "";
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
        this.statement = new Markdown(workspace.problem.statement, 0, 0, getMarkdownTheme());
        if (workspace.problem.source === "leetcode") this.status = "LeetCode 中国站 · Go · 真实题目";
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
        this.status = "F3 查看原因 · F2 返回代码 · Esc 返回 Pi";
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
        this.status = record.state === "complete" ? `结果已就绪：${record.message} · F3 查看 · Ctrl+H 求助` : record.message;
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
        if (matchesKey(data, "f5") || (this.helpVisible && matchesKey(data, "escape"))) {
            this.helpVisible = !this.helpVisible; this.helpOffset = 0; this.tui.requestRender(); return;
        }
        if (this.helpVisible) {
            this.helpOffset = Math.max(0, this.helpOffset + (matchesKey(data, "down") ? 1 : matchesKey(data, "up") ? -1 : 0));
            this.tui.requestRender(); return;
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
            ["ctrl+g", "guidance"], ["escape", "close"], ["ctrl+q", "discard"],
            ["ctrl+t", "submit"], ["ctrl+e", "cases"],
            ["ctrl+p", "status"], ["ctrl+b", "platform"], ["ctrl+v", "review"],
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
        if (width < 32 || height < 16) {
            return ["终端过小，请扩大至至少 32×16。", "Esc 保存返回 · Ctrl+Q 关闭草稿"].map(line => truncateToWidth(line, width));
        }
        this.contentHeight = Math.max(7, height - 9);
        if (this.helpVisible) {
            const lines = ["快捷键 · F5 / Esc 返回 · ↑ ↓ 滚动", "F1 题目 · F2 代码 · F3 结果 · F4 笔记", "Tab / Shift+Tab 切换焦点", "Ctrl+S 保存；编辑区 Enter 换行", "Ctrl+R 运行样例（未连接时引导登录）", "Ctrl+T 正式提交到当前账户", "Ctrl+E 编辑用例", "结果页 ← → 切换用例；d 执行详情", "Ctrl+P 恢复查询（不重新发送）", "Ctrl+B 打开平台记录", "Ctrl+H 求助 · Ctrl+G 调整引导", "Ctrl+V 复盘与学习记录", "保存冲突：Ctrl+O 另存草稿", "Esc 保存返回 Pi，并停止本地等待", "Ctrl+Q 关闭；未保存草稿需确认", "远程任务不会因关闭界面而取消", "回答后 /leet 返回原编辑位置"];
            this.helpOffset = Math.min(this.helpOffset, Math.max(0, lines.length - height + 1));
            return lines.slice(this.helpOffset, this.helpOffset + height - 1).map(line => truncateToWidth(line, width));
        }
        const view = this.practice.view.view;
        const header = this.theme.fg("accent", `pi-leetcode · ${this.workspace.problem.title}`) + `  Go · ${this.workspace.problem.source === "demo" ? "演示原型" : "中国站"}`;
        const tabs = views.map((item, i) => `F${i + 1} ${item === view ? `[${labels[item]}]` : labels[item]}`).join("  ");
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
            `F5 快捷键 · F1–F4 / Tab · 焦点：${labels[view]}`,
            this.workspace.problem.source === "demo" ? "Ctrl+S 保存 · Ctrl+R 演示结果 · Ctrl+H 求助 · Ctrl+G 引导" : "Ctrl+S 保存 · Ctrl+R 运行 · Ctrl+T 提交 · Ctrl+E 用例",
            "Esc 保存返回 · Ctrl+H 求助 · Ctrl+G 引导 · Ctrl+Q 关闭",
        ];
        return [header, `${guidanceLabels[this.guidance]} · ${this.dirty ? "有未保存修改" : "已保存"}`, tabs,
            "─".repeat(width), ...body, this.theme.fg("muted", this.operation || this.status), ...footer]
            .map(line => truncateToWidth(line, width));
    }
    invalidate(): void {
        this.codeEditor.invalidate();
        this.notesEditor.invalidate();
        this.statement.invalidate();
    }
    dispose(): void { this.disposed = true; }
}
