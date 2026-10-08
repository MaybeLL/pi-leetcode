# Legacy CLI protocol probe

Use a temporary checkout of `skygragon/leetcode-cli` at
`5245886992ceb64bfb322256b2bdc24184b36d76`. Download `plugins/leetcode.cn.js`
from `skygragon/leetcode-cli-plugins` at
`752e94e8a755106106af65af9d9b831d9810c4cd` into its `lib/plugins/` directory.
In that checkout, run `npm install --omit=dev --ignore-scripts --no-audit --no-fund`
using Node 24.19.0. The runner checks package version 2.6.2; preparing the exact
source revision is the caller's responsibility.

From pi-leetcode:

```sh
node scripts/legacy-cli-probe/run.mjs /absolute/path/to/temporary/checkout
# Optional anonymous catalogue GET against the upstream CN plugin's domain:
node scripts/legacy-cli-probe/run.mjs /absolute/path/to/temporary/checkout --live-cn
```

The runner creates a temporary directory and prints its path and report.
The preload overrides upstream's data-directory helper without changing HOME.
It disables automatic login/retry, supplies only synthetic credentials in mocked
scenarios, and prevents real HTTP except for the explicitly selected catalogue
GET. Run/Submit verdicts are mocked. No real submission is made. Each child has a
20-second deadline. Reports contain stdout/stderr and request methods/URLs, never
request headers or bodies. Remove the temporary checkout/report directories when
finished. This is verification instrumentation, not a supported plugin backend.
