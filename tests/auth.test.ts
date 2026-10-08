import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuthStore } from "../src/auth.js";
import { SecretInput } from "../src/secret-input.js";

test("credential files have private permissions and logout leaves unrelated practice data", async t => {
    const root = await mkdtemp(join(tmpdir(), "leet-auth-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new AuthStore(root);
    assert.equal(await store.read(), undefined);
    await store.save({ session: "secret-session", csrf: "secret-csrf" });
    assert.equal((await stat(join(root, "auth"))).mode & 0o777, 0o700);
    assert.equal((await stat(join(root, "auth", "cn.json"))).mode & 0o777, 0o600);
    assert.deepEqual(await store.read(), { session: "secret-session", csrf: "secret-csrf" });
    await writeFile(join(root, "notes.md"), "practice");
    await writeFile(join(root, "auth", "cn.json"), "{}");
    await assert.rejects(store.read(), /登录文件无效/);
    await store.clear(); assert.equal(await store.read(), undefined);
    assert.ok(await stat(join(root, "notes.md")));
});
test("secret input never renders values and safely handles chunked bracketed paste", () => {
    let submitted: string | undefined;
    const input = new SecretInput(value => { submitted = value; });
    input.handleInput("\x1b[200~LEETCODE_SESSION=SUPERSECRET;\n");
    assert.equal(submitted, undefined);
    input.handleInput("csrftoken=SECRET2\x1b[201~");
    assert.doesNotMatch(input.render(100).join("\n"), /SUPERSECRET|SECRET2/);
    input.handleInput("\r");
    assert.equal(submitted, "LEETCODE_SESSION=SUPERSECRET;csrftoken=SECRET2");
    assert.match(input.render(100).join("\n"), /等待粘贴/);
    input.handleInput("SHOULD-DISCARD"); input.handleInput("\x1b");
    assert.equal(submitted, undefined);
    assert.doesNotMatch(input.render(100).join("\n"), /SHOULD-DISCARD/);
});
