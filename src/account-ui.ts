import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { AuthStore } from "./auth.js";
import { PlatformError, type BackendFactory } from "./backend.js";
import { parseCredentials } from "./platform.js";
import { SecretInput } from "./secret-input.js";
import { showText } from "./panels.js";

export async function openPlatform(pi: ExtensionAPI, url: string): Promise<void> {
    if (!url.startsWith("https://leetcode.cn/")) throw new Error("仅支持打开中国站链接。");
    const result = process.platform === "win32" ? await pi.exec("rundll32", ["url.dll,FileProtocolHandler", url]) :
        await pi.exec(process.platform === "darwin" ? "open" : "xdg-open", [url]);
    if (result.code !== 0) throw new Error(`未能打开浏览器，请手动访问 ${url}`);
}
export async function connectAccount(ctx: ExtensionCommandContext, pi: ExtensionAPI, auth: AuthStore, factory: BackendFactory, reason = "连接中国站"): Promise<boolean> {
    while (true) {
        const choice = await ctx.ui.select(`${reason} · 草稿已保留`, ["粘贴两项 Cookie", "查看复制步骤", "打开中国站登录网页", "暂不连接，继续练习"]);
        if (!choice || choice.startsWith("暂不")) return false;
        if (choice === "查看复制步骤") {
            await showText(ctx, "# 连接步骤\n\n1. 在浏览器登录 https://leetcode.cn/ 。\n2. Chrome / Edge 按 F12（macOS 可用 ⌘⌥I）打开开发者工具。\n3. 选择 Application（应用）→ Storage → Cookies → https://leetcode.cn 。\n4. 找到 LEETCODE_SESSION 与 csrftoken，分别复制 Value。\n5. 返回插件的隐藏输入，粘贴：\n\n`LEETCODE_SESSION=<第一个值>; csrftoken=<第二个值>`\n\nSafari 可在开发菜单的 Web 检查器 → 存储中查找 Cookie。\n\n不要粘贴到 Pi 聊天中。仅在本机私有文件保存，不发送给模型。连接成功后继续刚才的运行或提交。");
            continue;
        }
        if (choice === "打开中国站登录网页") {
            try { await openPlatform(pi, "https://leetcode.cn/"); } catch (error) { ctx.ui.notify((error as Error).message, "error"); }
            continue;
        }
        const value = await ctx.ui.custom<string | undefined>((_tui, _theme, _keys, done) => new SecretInput(done));
        if (!value) return false;
        try {
            const credentials = parseCredentials(value);
            ctx.ui.notify("正在验证连接…", "info");
            const account = await factory(credentials).account();
            await auth.save(credentials);
            ctx.ui.notify(`已连接中国站：${account.username}`, "info");
            return true;
        } catch (error) { ctx.ui.notify((error as Error).message, "error"); }
    }
}
export async function ensureConnection(ctx: ExtensionCommandContext, pi: ExtensionAPI, auth: AuthStore, factory: BackendFactory, operation: string): Promise<boolean> {
    let credentials;
    try { credentials = await auth.read(); } catch { /* Invalid local login can be replaced in the hidden form. */ }
    if (!credentials) return connectAccount(ctx, pi, auth, factory, `${operation}需要连接账户`);
    try { await factory(credentials).account(); return true; }
    catch (error) {
        if (error instanceof PlatformError && error.kind === "auth") return connectAccount(ctx, pi, auth, factory, "登录已失效，重新连接后继续");
        throw error;
    }
}
