# pi-leetcode

Practice LeetCode inside Pi Coding Agent: read problems, write Go, inspect results, and ask for coaching without copying context between tools.

Backend research: [legacy CLI evaluation](docs/cli-backend-evaluation.md) and
[modern CLI evaluation](docs/modern-cli-evaluation.md). The modern client's API
layer is now available as an opt-in SDK backend. The development default remains
the direct CN adapter until live account judging is verified. The SDK is built
from our [fixed fork](https://github.com/MaybeLL/leetcode-cli/tree/pi-sdk), without
the upstream CLI/TUI or keychain dependencies.

## Status

The development version connects **LeetCode China (`leetcode.cn`) and Go**. Public problem retrieval and search have been verified live, including array, linked-list, binary-tree and design problems. The workbench runs on Pi 0.87.1.

**Account connection and a real custom-input Run result have been verified with the SDK backend. Formal Submit and the full live judge/error matrix remain unverified. Treat this as an experimental development version.** The original demo remains available separately through `/leet demo`; its results are explicitly marked as fixed fixtures.

## Start from this checkout

Requires Node.js 22.19+ and Pi 0.87.1 (the currently tested version):

```bash
npm install
pi --no-extensions -e ./extensions/leetcode.ts --skill ./skills/leetcode-coach
```

`--no-extensions` prevents an already installed copy from registering duplicate commands in this development session. It also disables other automatically discovered extensions for this invocation.

Use `/leet` for first setup and problem selection, or `/leet open 42` to open a specific problem. Default storage is created automatically at `~/.pi/leetcode/`. No practice repository needs to be created manually. Existing prototype data is preserved; use `/leet pick` to move from the demo to real problems.

For the GitHub version, install with `pi install git:github.com/MaybeLL/pi-leetcode`, then restart Pi or `/reload`. Local checkout changes become available through this route only after they are pushed.

### Try the SDK backend

```bash
PI_LEETCODE_BACKEND=sdk pi --no-extensions -e ./extensions/leetcode.ts --skill ./skills/leetcode-coach
```

Public reading works without login. This setting selects the backend for new
operations; saved jobs always resume through their original backend. Omit it or
set `PI_LEETCODE_BACKEND=direct` to use the current default. Credentials continue
to come only from this plugin's explicit `/leet login`, not another CLI.

The SDK artifact is pinned and distributed with the plugin; no fork checkout or
separate CLI installation is required. See [SDK plan and progress](docs/sdk-integration-plan.md)
and [artifact provenance](vendor/README.md).

## Account connection

Public reading and editing work without a login. To run or submit:

1. Sign in to **leetcode.cn** in your browser.
2. In browser developer tools, find the site's `LEETCODE_SESSION` and `csrftoken` cookie values.
3. Run `/leet login` in Pi. In its dedicated hidden input, paste `LEETCODE_SESSION=<value>; csrftoken=<value>`, then Enter.
4. The plugin validates the session before saving it. `/leet account` checks it again; `/leet logout` removes it.

Do not paste credentials into the normal Pi chat. They are stored locally in `auth/cn.json` with mode 0600 inside a mode-0700 directory; this is private-file storage, **not encryption**. The plugin does not include credentials in model context, practice records or errors. Like other Pi extensions, it shares the host process's filesystem permissions.

If the platform rejects access or presents a browser challenge, complete normal browser verification or retry later. A 403 does not necessarily mean your cookie expired.

## Practice workflow

| Command | Behavior |
| --- | --- |
| `/leet` | Set up on first use, otherwise resume the current/recent practice. |
| `/leet pick` | Search titles/numbers, filter difficulty, and browse pages. |
| `/leet open 42` | Open by number, slug, or a `leetcode.cn/problems/...` URL. |
| `/leet recent` | Restore one of the last 50 practice entries; older files are retained. |
| `/leet restart` | Start a fresh attempt, preserving the previous code and notes. |
| `/leet cases` | Edit a JSON array of test-input strings; each string separates parameters with `\n`. |
| `/leet test` | Save/run the active real problem's inputs online. Demo problems show fixtures instead. |
| `/leet submit` | Formally submit the saved Go code to the connected account. |
| `/leet status [record-id]` | Resume querying an existing job without sending code again. |
| `/leet hint` | Ask Pi for a limited hint using the saved practice context. |
| `/leet review` | Start a guided review in Pi; does not overwrite notes. |
| `/leet settings` | Change proactive guidance. |
| `/leet leave` | Detach practice coaching from the Pi conversation. |
| `/leet demo` | Open the original offline Two Sum prototype. |

### Workbench keys

Wide terminals split problem and code; narrow terminals switch views. The editor provides basic text editing, without IDE completion.

| Key | Action |
| --- | --- |
| F1–F4 or Tab / Shift+Tab | Switch problem, code, results, notes. |
| Enter in code/notes | Insert a newline. |
| Up / Down, PageUp / PageDown | Navigate focused content. |
| Ctrl+S | Save code, notes, and position. |
| Ctrl+R | Save and run inputs (demo: fixed fixture). |
| Ctrl+T | Save and formally submit a real problem. |
| Ctrl+E | Save and edit test inputs. |
| Ctrl+H | Save and ask Pi for help. |
| Ctrl+G | Save and choose guidance. |
| Esc | Save and return to Pi. During execution: stop waiting, not the remote job. |
| Ctrl+Q | Close; confirm before discarding an unsaved draft. |

The minimum viewport is 32×16; 80×24 or larger is recommended. During an online operation, a progress view replaces the editor. Esc returns after local cancellation settles; `/leet status` resumes polling. Editing while polling is a later improvement.

Results retain the exact submitted code and inputs. Editing afterwards marks the result as belonging to an earlier version. Sample success never claims whole-problem Accepted. Missing platform output stays missing. If a POST may have succeeded but returned no job ID, its outcome is unknown and the plugin does not automatically repeat it.

### Pi collaboration

Three guidance levels share one workflow: independent, light (default), and coached. A one-off help request never changes the level. Help requires a configured Pi model; reading/editing/judging do not.

After opening a problem or completing an operation, returning from the workbench can start one observation/question for light/coached guidance. It never interrupts the editor or reacts to silence. Fine-grained teaching events and durable help-depth tracking are still planned.

Agent tools include `leet_search`, `leet_open`, `leet_context`, `leet_run`, `leet_submit`, `leet_status` and `leet_set_guidance`. Commands and tools share execution/storage behavior. Submission requires an explicit user request, including a clearly authorized solve-and-submit workflow. Teaching instructions ask the agent to stop after five consecutive automated attempts or repeated failures; they are not a filesystem sandbox or a hard agent-turn budget.

## Data and recovery

```text
~/.pi/leetcode/
  settings.json
  last-problem.json
  recent.json
  auth/cn.json
  workspace/
    problems/0001-two-sum/          # original prototype, preserved
    problems/cn/<slug>/            # real problem, Go solution, inputs, notes
      attempts/<id>/              # fresh practice attempts
    records/executions/<id>.json   # exact code/input snapshot and judge state
  cache/
```

Choose a custom practice directory at setup. `PI_LEETCODE_HOME` changes the application data directory for isolated trials. Paths are independent of Pi's working directory. Cache cleanup must not remove workspace/auth files. Existing-directory migration and offline catalog caching are not implemented.

External edits are detected before saves. Concurrent Pi saves/sends use exclusive lock files. An abnormal process exit can leave `.write-lock` in a problem folder or `judge.lock` under records. Check that the old process has stopped and inspect platform history before manually removing such a lock; it is never silently discarded. A response saved before a subsequent practice-file conflict can be recovered using `/leet status <record-id>`.

## Development and verification

```bash
npm run check
npm test
npm run preview
node --import tsx scripts/verify-platform.ts
# Public SDK checks, without reading credentials or sending code:
PI_LEETCODE_BACKEND=sdk node --import tsx scripts/verify-platform.ts
```

The default platform probe only reads public questions and searches. Authenticated probes use credentials saved by `/leet login` and are explicitly opt-in:

```bash
node --import tsx scripts/verify-platform.ts --authenticated
# Also sends one formal Two Sum submission to the connected account:
node --import tsx scripts/verify-platform.ts --authenticated --submit
```

Verification execution records are retained under `~/.pi/leetcode/verification/`. A failed/unknown probe must be investigated before rerunning it; do not repeatedly submit to test connectivity.

Automated tests use temporary directories and simulated HTTP responses, not a live account. See [product design](docs/product-design.md), [development plan](docs/full-workflow-plan.md), [platform research](docs/platform-integration-research.md), and [verification status](docs/integration-status.md).

Later work includes live judge certification, COM/other languages, offline catalog, richer per-case results, help history, full review UI, workspace migration and a local runner. The underlying website endpoints are not a promised stable third-party API.
