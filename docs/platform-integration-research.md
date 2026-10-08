# LeetCode platform integration research

Research date: 2026-10-08 (Asia/Shanghai). This is a development-planning note, not a claim that live integration already works.

## Evidence and limits

- Reviewed `kawre/leetcode.nvim` at commit `4e8b3683940a8377379ce9398e7f329e3560b42c`. Its source is primary evidence for that plugin's implementation, not an official LeetCode API contract. [Repository snapshot](https://github.com/kawre/leetcode.nvim/tree/4e8b3683940a8377379ce9398e7f329e3560b42c)
- LeetCode's own help center documents online Run, editable test cases, default language templates, and Submit. It does not establish a supported third-party API or a rate-limit guarantee. No first-party developer contract for these endpoints was found in this research. [Test cases](https://support.leetcode.com/hc/en-us/articles/32442719377939-How-to-create-test-cases-on-LeetCode), [Coding practice](https://support.leetcode.com/hc/en-us/articles/360012016874-Start-your-Coding-Practice)
- Reviewed Pi's official extension documentation; current upstream revision resolved to `89e12ccd4a5eb587bfa3f4a823baa7cad1549735`. The existing prototype targets Pi 0.87.1; implementation must continue checking that version's exported declarations before adopting newer APIs. [Pi extension documentation](https://github.com/earendil-works/pi/blob/89e12ccd4a5eb587bfa3f4a823baa7cad1549735/packages/coding-agent/docs/extensions.md)
- No user credentials were read, no authenticated calls were made, and no code was run or submitted. Browser-tool GET access to the COM GraphQL URL failed and CN returned 400; neither observation tests a valid authenticated GraphQL POST or establishes platform availability.

## What the reference implementation establishes

### Authentication

`leetcode.nvim` parses both `LEETCODE_SESSION` and `csrftoken`, sends the cookie plus `x-csrftoken`, and validates `userStatus`. It stores CN and COM cookies separately. Its headers include site-specific Origin/Referer. These are implementation observations requiring live verification, not a browser-login protocol we should assume is stable. [Cookie parser](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/cache/cookie.lua), [Headers](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/headers.lua), [Authentication validation](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/auth.lua)

Proposed first implementation: browser sign-in followed by a dedicated masked credential-import UI, local validation, and per-site credential storage outside practice files. Prefer an OS credential store where available; an explicitly selected local fallback needs restrictive permissions. Never put cookies in model context, normal settings, logs, command arguments, test fixtures, or exported practice records. Do not promise that hiding the input alone isolates credentials from Pi's other tools: Pi extensions share process permissions. [Pi extension permissions](https://github.com/earendil-works/pi/blob/89e12ccd4a5eb587bfa3f4a823baa7cad1549735/packages/coding-agent/docs/extensions.md)

### Problem data and regional differences

The reference queries problem details by `titleSlug`: internal `questionId`, display `questionFrontendId`, content, difficulty, premium status, `codeSnippets`, `exampleTestcaseList`, and `metaData`. Its editor picks the snippet matching the language slug. Preserve internal ID, display ID, slug, site, and language independently; never construct submitted code from a model-invented template. [COM queries](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/queries.lua), [Template selection](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode-ui/question.lua)

CN is more than a hostname switch. CN queries add translated title/content, use `userSlug`, use `todayRecord`, and return a different random-question shape. COM uses `userId`, `activeDailyCodingChallengeQuestion`, and a structured random-question object. Some CN statistics calls use `/graphql/noj-go/`, while core question/auth calls use `/graphql/`. [CN queries](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode-plugins/cn/queries.lua), [CN endpoints](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode-plugins/cn/urls.lua), [COM queries](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/queries.lua)

The plugin uses `/api/problems/algorithms/` for the catalog and a separate CN translation query. This is one proven source-code approach, not evidence that its full catalog remains available today. Validate catalog retrieval early; isolate it behind a provider so pagination or a different query can replace it without changing the UI. [Catalog implementation](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/problems.lua)

Proposed content handling: render sanitized HTML as Markdown, retain links and image descriptions/open-in-browser affordances, fall back to original content when translation is absent, and keep topic tags/platform hints collapsed to avoid accidental spoilers. Missing templates and premium-only content should produce explicit availability messages.

### Run, Submit, and polling

The reference uses these routes for both regions:

| Operation | Method and relative URL | Job identifier |
| --- | --- | --- |
| Run user cases | POST `/problems/{slug}/interpret_solution/` | `interpret_id` |
| Submit to judge | POST `/problems/{slug}/submit/` | `submission_id` |
| Poll an existing job | GET `/submissions/detail/{id}/check/` | Existing ID |

The request includes `lang`, `typed_code`, internal `question_id`, and `data_input` for Run. The reference serializes user cases as raw lines and then polls until a result appears. Its exact delays are an implementation choice, not an official polling allowance. [Endpoints](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/urls.lua), [Request body](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/runner/init.lua), [Polling](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/interpreter.lua)

LeetCode explicitly distinguishes Run against selected cases from Submit against system cases. Raw cases place parameters on separate lines. Linked lists, trees, design problems, and special hidden parameters complicate generic local execution. Therefore use the remote runner first and defer a generic Go harness. Run success must read “selected cases passed,” never global Accepted. [LeetCode test-case guidance](https://support.leetcode.com/hc/en-us/articles/32442719377939-How-to-create-test-cases-on-LeetCode)

The reference result types include compile/runtime errors, comparison output, counts, runtime/memory, and intermediate states. Treat these as optional, variant-dependent fields. Unknown fields/status codes must not be converted into success; preserve a sanitized bounded diagnostic for investigation. [Result types](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/types.lua)

### Failure semantics

The reference distinguishes HTTP 429 during execution and describes 401/403 as either expired authentication or temporary API restriction. A 403 is insufficient evidence to erase credentials or demand re-login. Its generic HTTP helper retries 5xx requests, but pi-leetcode should not copy that policy for submission POSTs. [HTTP handling](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/utils.lua), [Execution handling](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/lua/leetcode/api/interpreter.lua)

Proposed policy:

- Cache reads and serialize online judge requests per account/site. Back off polling with jitter and respect Retry-After when present; do not claim a known safe numerical request rate.
- Distinguish signed-out, forbidden/challenge, throttled, transport failure, protocol/schema mismatch, platform failure, and user-code verdicts.
- Persist code/case hashes and a pending attempt before POST. Persist the returned job ID immediately; later network failure can resume polling the same job.
- A POST timeout or connection loss without a job ID means outcome unknown. Never automatically repeat Submit. Provide the official submission-history link and require a new user decision after checking it.
- Cancel means stop local waiting; do not claim the remote job was cancelled. Late responses must stay attached to their original problem, attempt, and code snapshot.
- Set a bounded polling deadline. Expiry is unresolved judging, not TLE: TLE is a verdict returned by the judge.
- Editing after a run marks its result stale. Unknown status or HTTP 200 GraphQL errors cannot become an empty catalog or successful result.

These are engineering recommendations derived from failure ambiguity; their timing constants and exact response decoding remain to be verified.

## Recommended delivery boundary and verification gates

Recommendation: first supported release uses **CN + Go (`golang`)**, free algorithm problems, official snippets, online Run, and Submit. This is a product choice aligned with the current Chinese workflow, not a finding that CN is more reliable. Keep the provider contract site-aware from day one; COM becomes supported only after the same end-to-end matrix passes. The reference lists Go's language slug as `golang`. [Reference configuration](https://github.com/kawre/leetcode.nvim/blob/4e8b3683940a8377379ce9398e7f329e3560b42c/README.md)

Gate 1 — platform feasibility: with a user-provided test account/session during implementation, verify sign-in status, detail/template/sample retrieval, catalog search, a real Run, and one explicitly requested Submit. Record sanitized response fixtures and endpoint date. If blocked by challenge/restriction, expose a browser fallback and keep support status experimental rather than bypassing controls.

Gate 2 — contract tests: fixture-backed success/failure/unknown response decoding, CN/COM separation, HTML conversion, missing translations/templates, 429 cooldown, 403 ambiguity, timeout with/without job ID, cancellation, and resuming pending polling. Never send credentials to test logs or model tools.

Gate 3 — user workflow: independent and coached settings, fresh and resumed problems, custom test cases, failed-case reuse, compile error/WA/AC, editing while a previous result arrives, network interruption, restart, external-file conflicts, and credential renewal without losing work. Use arrays, strings, lists, trees, and a Go design problem as representatives; document exclusions instead of assuming every category works.

Gate 4 — Pi integration: UI actions and model tools call the same application service and produce the same normalized attempts/results. Keep model help bounded to the requested depth; a Run or judge result alone must not trigger code edits or automatic Submit. Verify the real configured Pi model in addition to the existing mocked handoff tests. Pi's command/tool/session/event mechanisms support this architecture. [Pi extension integration points](https://github.com/earendil-works/pi/blob/89e12ccd4a5eb587bfa3f4a823baa7cad1549735/packages/coding-agent/docs/extensions.md)

This research establishes a concrete implementation path and live-test checklist. It does not establish current authenticated endpoint availability or a guaranteed schedule.
