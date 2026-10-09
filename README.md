# pi-leetcode

Practice LeetCode inside Pi Coding Agent: read problems, write Go, inspect results, and ask for coaching without copying context between tools.

Backend research: [legacy CLI evaluation](docs/cli-backend-evaluation.md) and
[modern CLI evaluation](docs/modern-cli-evaluation.md). The modern client's API
layer is now the default SDK backend after live CN judging verification. The
direct CN adapter remains available as a fallback. The SDK is built
from our [fixed fork](https://github.com/MaybeLL/leetcode-cli/tree/pi-sdk), without
the upstream CLI/TUI or keychain dependencies.

## Status

The development version connects **LeetCode China (`leetcode.cn`) and Go**. Public problem retrieval and search have been verified live, including array, linked-list, binary-tree and design problems. The workbench has been tested on Pi 0.87.1 and 1.1.0.

**The SDK backend has passed live CN account checks, sample runs, wrong-answer/compile-error/runtime-error runs, saved-job recovery, and one formal Two Sum submission (Accepted, 65/65). This remains an experimental development version; broader problems and failure conditions need continued validation.** The original demo remains available separately through `/leet demo`; its results are explicitly marked as fixed fixtures.

## Get started

Requires Node.js 22.19+; tested with Pi 0.87.1 and 1.1.0:

```bash
pi install git:github.com/MaybeLL/pi-leetcode
pi
```

Enter `/leet`. First use creates `~/.pi/leetcode/` and opens the public Two Sum problem with light guidance. Later visits resume your practice. Use `/leet pick` to choose another problem or `/leet open 42` for a specific one. No practice repository or login is needed to start reading and editing; paid content may require platform access.

The first Run or Submit requests account connection if needed, then continues that operation. Cancel returns to your saved practice. Existing credentials are reused. `/leet doctor` shows the loaded extension path, backend, runtime and data locations when diagnosing installation problems.

### Develop from this checkout

Run these commands **inside the cloned pi-leetcode directory**:

```bash
npm install
pi --no-extensions --no-skills -e ./extensions/leetcode.ts --skill ./skills/leetcode-coach
```

The flags disable auto-discovered extensions and skills so an installed copy cannot shadow the checkout. The explicit paths load this checkout. After updating an installed package, restart Pi to load code and dependency changes.

### Backend selection

```bash
PI_LEETCODE_BACKEND=sdk pi --no-extensions --no-skills -e ./extensions/leetcode.ts --skill ./skills/leetcode-coach
```

Public reading works without login. This setting selects the backend for new
operations; saved jobs always resume through their original backend. SDK is the
default when omitted; set `PI_LEETCODE_BACKEND=direct` to use the fallback. Credentials continue
to come only from this plugin's explicit `/leet login`, not another CLI.

The SDK artifact is pinned and distributed with the plugin; no fork checkout or
separate CLI installation is required. See [SDK plan and progress](docs/sdk-integration-plan.md)
and [artifact provenance](vendor/README.md).

## Account connection

Public reading and editing work without a login. To run or submit:

1. Sign in to **leetcode.cn** in your browser.
2. In browser developer tools, find the site's `LEETCODE_SESSION` and `csrftoken` cookie values.
3. Use the connection menu shown by Run/Submit, or `/leet login`. The menu includes browser steps and an open-website action. In its dedicated hidden input, paste `LEETCODE_SESSION=<value>; csrftoken=<value>`, then Enter.
4. The plugin validates the session before saving it. `/leet account` checks it again; `/leet logout` removes it.

Do not paste credentials into the normal Pi chat. They are stored locally in `auth/cn.json` with mode 0600 inside a mode-0700 directory; this is private-file storage, **not encryption**. The plugin does not include credentials in model context, practice records or errors. Like other Pi extensions, it shares the host process's filesystem permissions.

If the platform rejects access or presents a browser challenge, complete normal browser verification or retry later. A 403 does not necessarily mean your cookie expired.

## Practice workflow

| Command | Behavior |
| --- | --- |
| `/leet` | Open Two Sum on first use, otherwise resume the current/recent practice. |
| `/leet pick` | Open the shared problem browser: the first screen lists problems immediately, search runs as you type, difficulty and free-only filters combine with the keyword, and paging keeps the current page visible. Each row shows the number, title, Chinese difficulty, member mark, and local practice status. |
| `/leet open 42` | Open by number, slug, or a `leetcode.cn/problems/...` URL. |
| `/leet recent` | Restore one of the last 50 practice entries; older files are retained. |
| `/leet restart` | Start a fresh attempt, preserving the previous code and notes. |
| `/leet cases` | Add/edit/delete individual cases, with one parameter per line; advanced JSON editing remains available. |
| `/leet test` | Save/run the active real problem's inputs online. Demo problems show fixtures instead. |
| `/leet submit` | Formally submit the saved Go code to the connected account. |
| `/leet status [record-id]` | Resume querying an existing job without sending code again. |
| `/leet hint` | Ask Pi for a limited hint using the saved practice context. |
| `/leet review` | Open reflection, help history, user labels or guided review; notes remain separate. |
| `/leet settings` | Change proactive guidance or copy the practice library to a new directory. |
| `/leet doctor` | Inspect runtime, loaded source, backend, connection and data locations. |
| `/leet leave` | Detach practice coaching from the Pi conversation. |
| `/leet demo` | Open the original offline Two Sum prototype. |

### Workbench keys

Problem and code share one **F1 做题** page, not separate tabs. Wide terminals show them side by side; narrow terminals show the focused content. Open the page to read and scroll immediately, press Enter to write code, and Esc to return to reading with the editor cursor preserved. In reading mode, Left/Right cycles through practice, results and notes, while Up/Down and PageUp/PageDown scroll the current content. Notes also open in reading mode: Enter edits and Esc returns to notes reading. Only the active pane has a filled inverse heading and ▸ marker; the selected page uses a quieter ● marker. The original-problem link at the bottom of a real statement is clickable, including wrapped URL lines; F7 (spelled out as “F7 去leetcode查看原题”) is the keyboard alternative. Browser launch failures show a copyable URL. F8 选题 opens the same problem browser as `/leet pick` from inside the workbench. The footer separates status from actions: save, run, submit, cases, help, coaching, guidance, return, original problem, problem picker and more remain visible, wrapping in narrow windows. F5 lists the full keymap. The editor provides basic text editing, without IDE completion.

| Key | Action |
| --- | --- |
| Click a tab / F1 / F3 / F4 | Open practice / results / notes in reading mode; no separate tab-navigation layer. F2 is removed. Mouse clicks require terminal mouse events. |
| Left / Right in reading mode | Cycle through practice, results and notes, wrapping at either end. |
| Enter while reading the problem or notes | Start/resume code or notes editing without inserting a newline. |
| Esc while editing code or notes | Return to reading that same page, without saving or stopping a background judge. |
| Esc while reading results or notes | Return to reading the problem. |
| Tab / Shift+Tab in code or notes | Insert four spaces / remove up to four leading spaces on the current line. |
| Enter in code/notes | Insert a newline. |
| Up / Down, PageUp / PageDown | Navigate focused content. |
| Ctrl+S | Save code, notes, and position. |
| Ctrl+R | Save and run inputs (demo: fixed fixture). |
| Ctrl+T | Save and formally submit a real problem. |
| Ctrl+E | Save and edit test inputs. |
| Ctrl+H | Save and ask Pi for help. |
| Ctrl+P | Resume the saved judge job without resending. |
| Ctrl+B | Open platform submission history. |
| Ctrl+V | Open reflection and learning history. |
| Shift+Left / Shift+Right in results | Select a test case; unmodified arrows still switch pages. |
| d in results | Toggle technical execution details. |
| F5 | Open keyboard help; F5/Esc returns to the same focus. |
| F6 | Save and start/continue coaching in Pi, using the existing discussion. |
| Click the original-problem link / F7 去leetcode查看原题 | Save and open the current problem in your browser; retain your workbench position. |
| F8 选题 | Save the draft, notes and position, then open the problem browser. Cancelling restores the same problem, tab, cursor and reading position; confirming another problem keeps the original files. Selecting a problem you have practised before continues its newest practice (including later re-practice attempts); only `/leet restart` starts a blank attempt. |
| Ctrl+G | Save and choose guidance. |
| Esc while reading the problem | Save and return to Pi. During execution: stop waiting, not the remote job. |
| Ctrl+Q | Close; confirm before discarding an unsaved draft. |

The minimum viewport is 32×16; 80×24 or larger is recommended. While judging, the workbench stays open for reading and editing. Results update without stealing focus. Esc while editing returns to the same page's reading mode while judging continues. Esc from results or notes reading returns to problem reading; Esc from problem reading saves, stops local waiting, preserves the job, and returns to Pi; `/leet status` resumes polling. If a background judge finishes after you have switched problems with F8, its result is written only to the problem that started it.

### Problem browser and local status

The browser distinguishes focus from selection: the search label, focused filter or focused result row uses inverse bold with ▸; ✓ marks applied filters, and ● remembers the selected result when focus is elsewhere. An inactive search field has no fake caret. The footer describes the keys for the current area (search, filters or list); key/action pairs and filters wrap intact on narrow terminals. Clicking a filter also moves keyboard focus to it.

Inside the browser, typing pauses for about 300 ms before searching; a pure number pins the exact question once at the front (removed from every later page, so paging never repeats it), and clearing the box returns to browsing under the current filters. A new search keeps the previous confirmed list on screen with a “搜索中” marker, and a late response from an older query or filter never replaces the current results. Rows on a not-yet-confirmed list are labelled as the previous result and cannot be opened until the current search settles. Loading, empty and failed states are shown in place, and a failed request offers a retry without losing the keyword or filters. With 仅免费, the browser keeps scanning past a page of member problems; if none is found within the scan window it offers 继续加载 instead of reporting no results.

The status column comes only from this machine's practice files: `未练习` means no local record, `已开始` means a record without a formal Accepted, and `曾通过` means a formal submit recorded by this plugin once returned Accepted. Sample runs never count, a later re-practice never erases a pass, and a problem removed from the 50-entry recent index still reports its real status. This is not your LeetCode account history and does not mean the problem is mastered; browsing, searching and opening need no login.

Results retain the exact submitted code and inputs. Editing afterwards marks the result as belonging to an earlier version. Sample success never claims whole-problem Accepted. Missing platform output stays missing. If a POST may have succeeded but returned no job ID, its outcome is unknown and the plugin does not automatically repeat it.

### Pi collaboration

Three guidance levels share one workflow: independent, light (default), and coached. A one-off help request never changes the level. Help requires a configured Pi model; reading/editing/judging do not.

Every guidance level opens the workbench first. F6 explicitly starts or continues coaching in the Pi conversation, after saving your draft; changing guidance also stays in the workbench. Independent guidance stays quiet until you ask. Light/coached guidance offers an observation after a new completed result when returning to Pi. Reopening or querying the same result does not repeat it. It never interrupts editing or reacts to silence.

Ctrl+H offers problem explanation, thought checking, a small hint, selected-case analysis, full explanation, and free-form requests. Problem-only help excludes your solution and results from `leet_context`. Return with `/leet` to the saved position; Ctrl+Alt+L fills that command when the chat editor is empty.

Each attempt saves help requests and replies in `learning.json` (requests capped at 6,000 characters, replies at 8,000 with a truncation notice). Model failures remain failed requests and can be retried. `/leet review` lets you label the help actually received and write a reflection separate from notes. Guidance, requested help depth, and actual help are recorded separately; Accepted never implies mastery.

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

Use `/leet settings` to copy the practice library to a new custom directory. Close other Pi sessions and editors using the library first. The destination must not already exist; successful copying switches the setting and retains the entire old directory. Credentials stay in the application data directory. `PI_LEETCODE_HOME` changes the application data directory for isolated trials. Paths are independent of Pi's working directory. Cache cleanup must not remove workspace/auth files. Merging into an existing directory and offline catalog caching are not implemented.

Background judge updates use a separate `execution.json` file and do not rewrite code or notes. External edits are detected before saves; Ctrl+O on a save error preserves the draft in a separate folder. Concurrent Pi saves/sends use exclusive lock files. An abnormal process exit can leave `.write-lock` in a problem folder or `judge.lock` under records. Check that the old process has stopped and inspect platform history before manually removing such a lock; it is never silently discarded. A response saved before a subsequent practice-file conflict can be recovered using `/leet status <record-id>`.

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
PI_LEETCODE_BACKEND=sdk node --import tsx scripts/verify-platform.ts --authenticated --submit
# Add wrong-answer, compile-error and runtime-error runs (20 seconds between sends):
PI_LEETCODE_BACKEND=sdk node --import tsx scripts/verify-platform.ts --authenticated --matrix
```

Verification execution records are retained under `~/.pi/leetcode/verification/`. A failed/unknown probe must be investigated before rerunning it; do not repeatedly submit to test connectivity.

Automated tests use temporary directories and simulated HTTP responses, not a live account. See [product design](docs/product-design.md), [development plan](docs/full-workflow-plan.md), [platform research](docs/platform-integration-research.md), and [verification status](docs/integration-status.md).

Later work includes broader live judge coverage, COM/other languages, offline catalog, per-case platform verdicts, broader teaching evaluation and a local runner. The underlying website endpoints are not a promised stable third-party API.
