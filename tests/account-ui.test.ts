import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthStore } from "../src/auth.js";
import { ensureConnection } from "../src/account-ui.js";
import { PlatformError, type BackendFactory } from "../src/backend.js";

test("expired connection is replaced through masked input; forbidden access does not loop through login", async t => {
    const root = await mkdtemp(join(tmpdir(), "leet-reauth-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const auth = new AuthStore(root); await auth.save({ session: "old", csrf: "old" });
    let prompts = 0;
    const ctx: any = { ui: {
        async select() { prompts++; return "粘贴两项 Cookie"; },
        notify(message: string) { assert.doesNotMatch(message, /new-secret/); },
        custom(factory: any) { return new Promise(done => {
            const screen = factory({}, {}, {}, done);
            screen.handleInput("LEETCODE_SESSION=new-secret; csrftoken=new-csrf");
            assert.doesNotMatch(screen.render(80).join("\n"), /new-secret/);
            screen.handleInput("\r");
        }); },
    } };
    const factory = ((credentials: any) => ({ async account() {
        if (credentials.session === "old") throw new PlatformError("auth", "expired");
        return { username: "fixture", slug: "fixture" };
    } })) as BackendFactory;
    assert.equal(await ensureConnection(ctx, {} as any, auth, factory, "运行"), true);
    assert.equal((await auth.read())?.session, "new-secret"); assert.equal(prompts, 1);
    const forbidden = (() => ({ async account() { throw new PlatformError("forbidden", "access denied"); } })) as unknown as BackendFactory;
    await assert.rejects(ensureConnection(ctx, {} as any, auth, forbidden, "运行"), /access denied/);
    assert.equal(prompts, 1);
});
