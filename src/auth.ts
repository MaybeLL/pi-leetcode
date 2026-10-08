import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCredentials, type Credentials } from "./platform.js";

export class AuthStore {
    private directory: string;
    constructor(home: string) { this.directory = join(home, "auth"); }
    async read(): Promise<Credentials | undefined> {
        try {
            const value = JSON.parse(await readFile(join(this.directory, "cn.json"), "utf8"));
            if (typeof value.session !== "string" || typeof value.csrf !== "string") throw new Error();
            return parseCredentials(`LEETCODE_SESSION=${value.session}; csrftoken=${value.csrf}`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            throw new Error("登录文件无效，请用 /leet login 重新连接。");
        }
    }
    async save(credentials: Credentials): Promise<void> {
        await mkdir(this.directory, { recursive: true, mode: 0o700 });
        await chmod(this.directory, 0o700);
        const temp = join(this.directory, `${randomUUID()}.tmp`);
        try {
            await writeFile(temp, JSON.stringify(credentials), { mode: 0o600, flag: "wx" });
            await rename(temp, join(this.directory, "cn.json"));
        } finally { await unlink(temp).catch(() => undefined); }
    }
    async clear(): Promise<void> {
        await unlink(join(this.directory, "cn.json")).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== "ENOENT") throw error;
        });
    }
}
