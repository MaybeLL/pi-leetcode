import { Input, matchesKey, truncateToWidth, type Component, type Focusable } from "@earendil-works/pi-tui";

// Native Input handles paste framing and navigation; its render output is never used.
export class SecretInput implements Component, Focusable {
    focused = true;
    private input = new Input();
    constructor(private done: (value: string | undefined) => void) {}
    handleInput(data: string): void {
        if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
            this.input.setValue(""); this.done(undefined); return;
        }
        // Input handles bracketed paste before Enter submission, including split frames.
        this.input.onSubmit = value => { this.input.setValue(""); this.done(value); };
        this.input.handleInput(data);
    }
    render(width: number): string[] {
        return [
            "连接 LeetCode 中国站 · 隐藏输入",
            "在浏览器登录 leetcode.cn，复制以下两项 Cookie：",
            "LEETCODE_SESSION=…; csrftoken=…",
            "凭据仅存本机私有文件（未加密），不发送给 Pi 模型。",
            this.input.getValue() ? "[已输入凭据，内容隐藏]" : "[等待粘贴凭据]",
            "Enter 验证并保存 · Esc 取消",
        ].map(line => truncateToWidth(line, width));
    }
    invalidate(): void {}
    dispose(): void { this.input.setValue(""); }
}
