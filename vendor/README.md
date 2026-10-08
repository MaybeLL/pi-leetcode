# LeetCode client artifact

`maybell-leetcode-client-3.5.2-pi.1.tgz` is a library-only build from
[MaybeLL/leetcode-cli, pi-sdk](https://github.com/MaybeLL/leetcode-cli/tree/pi-sdk),
fork commit `f19ba4a` (full revision is in the archive's SOURCE.json), based on
night-slayer18/leetcode-cli v3.5.2 at
`282096f5c3952ae0e94a704adac344ec73c7732b`.

The original Apache-2.0 license and change documentation are included. This is
an npm-format artifact, not an npm registry publication. It contains the client,
types, provenance and documentation; its only direct dependencies are got and
Zod. No TUI, credential store, keytar or collaboration code is included.

Rebuild in a clean checkout of that fork revision using Node 24.19.0:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run build:sdk
npm pack ./build/client-package --pack-destination /absolute/path/to/pi-leetcode/vendor
```

Then explicitly install the artifact in pi-leetcode and update package-lock.json.
Verify SOURCE.json reports `dirty: false`. The lockfile pins the tarball's SHA-512
integrity and all transitive versions. npm distributions bundle the installed
SDK dependency so the relative artifact path also works outside a Git checkout.
Do not edit generated client files inside the archive; change the fork and rebuild.
