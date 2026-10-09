# Vendored LeetCode client

`vendor/leetcode-client/` holds the generated library-only build of
[MaybeLL/leetcode-cli, pi-sdk](https://github.com/MaybeLL/leetcode-cli/tree/pi-sdk),
fork commit `294bc86` (full revision in `SOURCE.json`), based on
night-slayer18/leetcode-cli v3.5.2 at
`282096f5c3952ae0e94a704adac344ec73c7732b`.

| File | Purpose |
| --- | --- |
| `client.js` | Generated SDK entrypoint; imported by `src/sdk-backend.ts` |
| `client.d.ts` | Generated types for the same entrypoint |
| `LICENSE` | Upstream Apache-2.0 license |
| `README.md` | Maintained change log of the fork |
| `SOURCE.json` | Exact upstream/fork revisions and cleanliness flag |

No TUI, credential store, keytar or collaboration code is included. The client's
only direct dependencies are `got` and `zod`; both are declared in the
`dependencies` of pi-leetcode, so no npm dependency is vendored and the package
installs identically under npm, pnpm and Bun.

Do not edit generated client files here; change the fork and rebuild.

## Refresh

Build in a clean checkout of the fork revision using Node 24.19.0:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:sdk
```

Verify the build's `SOURCE.json` reports `dirty: false`, then copy the generated
files over this directory:

```sh
cp build/client-package/{client.js,client.d.ts,LICENSE,README.md,SOURCE.json} \
   /absolute/path/to/pi-leetcode/vendor/leetcode-client/
```

Then run `npm run check && npm test`. Bump `got`/`zod` in `package.json` only if
the rebuilt `client.d.ts` requires different versions.
