# night-slayer18/leetcode-cli 接入评估

评估日期：2026-10-08。本记录包含固定版本源码/发布物研究，以及隔离安装、API 测试和公开中国站读取实测。没有启动完整 CLI、读取用户凭据或执行真实 Run/Submit。模拟判题与公开读取的证据见文末。

## 实施更新

后续已完成 fork、SDK 提取及 Pi 可选后端接入。以下为选型时的原版评估；当前实现与验证状态见 [SDK 接入计划](sdk-integration-plan.md)。原版缺口已经在 fork 中补充，真实账户判题仍待验证。

## 结论

**在两个外部候选中，优先选择 night-slayer18 作为复用对象。** 它有持续至 2026 年的发布、中国站独立查询/适配、现代 TypeScript 类型和响应校验，客户端类也比旧版插件全局链容易隔离。但不能直接把其终端命令当成 Pi 后端协议：它仍没有 JSON CLI/公开 SDK，发送与轮询耦合，不能立即向 Pi 返回任务 ID 以支持恢复。

推荐对固定版本的 **API client 层做小范围适配或推动上游提供 SDK**，先验证改动量与真实链路。保持 Pi 工作台、教学节奏、练习目录、代码快照和记录归本项目所有。现有直连后端保留为对照与过渡；不要先删除它，也不要把整个上游 TUI、工作区、协作和 Git 同步栈嵌入 Pi。

## 版本与实际发布物

| 项目 | 核实值 |
| --- | --- |
| 默认分支 main | `77ffcc06f63dd4d8ef18847042a974d973866232`，提交时间 2026-09-07 17:34:08 UTC |
| 最新 GitHub release | `v3.5.2`，2026-09-07 17:15:57 UTC |
| release 对应 commit / npm gitHead | `282096f5c3952ae0e94a704adac344ec73c7732b` |
| npm 包 | `@night-slayer18/leetcode-cli@3.5.2`，2026-09-07 17:17:27 UTC 发布 |
| Node / license | Node >=22.0.0；Apache-2.0 |

来源：[main commit](https://github.com/night-slayer18/leetcode-cli/commit/77ffcc06f63dd4d8ef18847042a974d973866232)、[release](https://github.com/night-slayer18/leetcode-cli/releases/tag/v3.5.2)、[npm 固定版本元数据](https://registry.npmjs.org/@night-slayer18/leetcode-cli/3.5.2)、[npm 版本时间线](https://registry.npmjs.org/@night-slayer18/leetcode-cli)、[package.json](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/package.json)。仓库 pushed_at 比主分支提交时间更晚，不能把 pushed_at 当作主线代码更新时间。

main 相对 release 的差异只涉及 package/package-lock 和 GitHub 配置，所审业务 `src/` 相同；后续适配优先固定 release commit，避免把浮动 main 误当作 npm 发布版。来源：[比较](https://github.com/night-slayer18/leetcode-cli/compare/282096f5c3952ae0e94a704adac344ec73c7732b...77ffcc06f63dd4d8ef18847042a974d973866232)。

直接下载并列出了官方 npm tarball：仅有 CLI bundle `dist/index.js`，类型文件 `dist/index.d.ts` 只有 shebang，没有 client 导出；源码未打包。package 的 main/bin 都指向 CLI 入口，没有 SDK exports。`import '@night-slayer18/leetcode-cli'` 会进入程序启动逻辑，不是无副作用的客户端导入。来源：[npm tarball](https://registry.npmjs.org/@night-slayer18/leetcode-cli/-/leetcode-cli-3.5.2.tgz)、[构建配置](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/package.json)、[入口](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/index.ts)。

## 已具备、值得复用的能力

- **真实的中国站分层。** `LeetCodeClient(site)` 支持 `leetcode.cn` 和 `leetcode.com`；CN query pack 与 normalization adapter 处理中文标题/题面、题目列表、每日题和用户资料。3.5.2 还修正了中国站 submissionList/submissionDetail 的 schema 差异。Go 文件扩展名映射为 `golang`。这是源码支持，尚不等于我们已验证当前账户的判题链路。来源：[client](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/api/client.ts)、[CN 查询](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/api/queries.cn.ts)、[CN 适配](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/api/adapters/cn.ts)、[语言映射](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/utils/languages.ts)。
- **可实例化客户端。** API 类直接依赖 got、Zod、类型与站点查询/适配文件，不导入 TUI、配置目录或 keychain。底部导出默认单例，但可以自行创建实例。因此提取 library 的范围相对明确；不能因为源码 export class 就宣称已发布 SDK。来源：[client](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/api/client.ts)。
- **响应结构校验。** 题目、账户、判题等使用 Zod schema，优于解析终端彩色文字。但 TestResult/SubmissionResult schema 有多个必填字段，例如 run_success，提交还要求 total_correct、百分位等；应专门验证编译失败、运行错误与平台返回字段缺省时能否保留原始判定，不能只测 Accepted。来源：[schemas](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/schemas/api.ts)。

## 接入阻碍与明确边界

### 终端命令不提供机器协议

test/submit 命令没有 JSON 选项，打印 spinner/彩色说明；多种错误会 catch 后仅打印或直接 return，没有为失败设置非零退出码。它们还要求自己的工作区边界和 `{id}.{slug}.{ext}` 文件名，提交成功后可能记录 timer 和触发 star 提示。用子进程包装完整命令会额外承接格式、目录和交互副作用，无法只凭退出码可靠判定成功。来源：[命令注册](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/index.ts#L263-L316)、[test](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/commands/test.ts)、[submit](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/commands/submit.ts)。这里没有执行子进程验证退出码，结论限定为源码可见错误路径。

### 发送与查询尚未分离

`testSolution()`/`submitSolution()` 收到 interpret_id/submission_id 后直接调用 private `pollSubmission()`，返回的是最终结果，既没有提前返回 ID，也没有独立公共 check 方法。getSubmissionDetails 是历史详情查询，不能替代持久化当前运行任务 ID 和恢复检查。需要增加 startRun/startSubmit/checkJob 三个公开方法，保留旧方法作为兼容包装；Pi 在 start 返回后立刻保存 ID，再自行调度查询。来源：[发送与轮询](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/api/client.ts#L515-L590)。

轮询至多 12 次、延迟由 500ms 增至 3s，优于旧版无明显上限的循环；但每次 HTTP 请求有 30s timeout 与 got 重试，因此最终文案里的“30 seconds”并不是总时限，也没有传入 AbortSignal 的公开参数。Pi 的停止等待/恢复语义应由独立 check + Signal 支持实现。来源同上及 [HTTP 配置](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/api/client.ts#L96-L110)。

**没有证据表明该新版会自动重发 submit POST。** 上游设置 got retry limit=2；所审 main lockfile 的 got 14.6.6 默认 retry methods 不含 POST，客户端也没有旧版那种登录后重放 submitSolution 的外层逻辑。适配时仍应明确禁用非幂等 POST 重试，并用“服务端可能收到但客户端未取得 ID”的测试固定行为。来源：[client](https://github.com/night-slayer18/leetcode-cli/blob/77ffcc06f63dd4d8ef18847042a974d973866232/src/api/client.ts)、[lockfile](https://github.com/night-slayer18/leetcode-cli/blob/77ffcc06f63dd4d8ef18847042a974d973866232/package-lock.json)、[got 14.6.6 默认配置](https://github.com/sindresorhus/got/blob/v14.6.6/source/core/options.ts)。

### 凭据能力可参考，但不宜隐式共享

默认通过 keytar 存入系统 keychain；可选择文件后端，使用 LEETCODECLI_MASTER_KEY、scrypt 与 AES-256-GCM 加密；也支持 LEETCODE_SESSION/LEETCODE_CSRF_TOKEN 只读环境凭据。目录/文件会尝试设置 0700/0600。它比简单明文文件提供更多选择，但 keytar 是原生依赖，完整 CLI 的安装面也包括 TUI、Supabase 等 Pi 后端不需要的依赖。来源：[credentials](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/storage/credentials.ts)、[package](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/package.json)。

所审存储采用固定 keychain service/account 或单一文件，没有按站点/账户分区；client.setSite 会将已有 credentials 应用到新站点。Pi 应自行按站点/账户管理并显式注入凭据，不自动读取用户其他 CLI 的全局凭据，也不直接共享该单例。来源：[credentials](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/storage/credentials.ts)、[setSite](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/api/client.ts#L114-L135)。

## 测试证据的范围

release notes 报告 356 tests / 38 suites 通过，这是上游报告，本轮仅复跑其中 API 与提交结果 schema 的 28 个测试，不代表全部 356 个测试。源码中有中国站列表/题面适配、query resolver、submission 历史与详情、凭据存储等回归；API 测试 mock got，命令 solve 测试 mock testSolution/submitSolution。检索没有发现直接覆盖 API client 的 start→poll、断线恢复、重复发送防护测试，因此现有测试数不能替代我们需要的判题契约验证。来源：[release](https://github.com/night-slayer18/leetcode-cli/releases/tag/v3.5.2)、[CN client 测试](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/__tests__/api/client-cn.test.ts)、[历史测试](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/__tests__/api/client-submissions.test.ts)、[solve 测试](https://github.com/night-slayer18/leetcode-cli/blob/282096f5c3952ae0e94a704adac344ec73c7732b/src/__tests__/commands/solve.test.ts)。

## 与旧 CLI 的选择

| 维度 | skygragon | night-slayer18 |
| --- | --- | --- |
| 主线/发布 | 2019，2.6.2 | 2026-09，3.5.2 |
| 中国站 | 外部旧插件，旧域名 | 内置独立 query/adapters，已有 CN 修复发布 |
| Go | 支持 | 支持 |
| 内部复用 | 全局插件链和初始化耦合 | TypeScript client 类可独立实例化 |
| 发布为 SDK / JSON CLI | 不具备 | 仍不具备 |
| 提前返回任务 ID、独立 check | 不具备 | 仍需补充 |
| 轮询 | 无明显总上限等问题 | 次数有界，但没有总 deadline/取消入口 |
| 决策 | 停止优先投入适配 | 优先进行 API 层小补丁验证 |

旧版证据与实测范围见 [旧 CLI 评估](cli-backend-evaluation.md)。新版逐项证据如上。

下一步的最小成果应是一个不带 CLI/TUI 副作用的可导入 client 入口，加独立发送/检查和取消能力，再接到本项目既有 backend interface。先做无凭据、模拟 HTTP 的契约测试；再验证公开 CN 题目和 Go 模板；最后用用户已授权的账户运行/提交流程完成真实判题认证。只有这些通过后才切换默认后端。若只能靠长期复制大段上游并维护明显分叉，则重新比较维护成本，不把“依赖新 CLI”本身当成交付目标。

## 本地验证（2026-10-08）

环境为 Node 24.19.0，临时检出 main `77ffcc0`，`npm ci --ignore-scripts --no-audit --no-fund` 成功。安装时跳过生命周期脚本，因此这不构成 keytar 原生凭据功能或完整 CLI 安装验证。

- 上游 API 与提交结果 schema 测试：6 个文件、28 个测试通过。
- 单独构建 `src/api/client.ts` 成功（35.51 KB ESM；got/Zod 外部依赖）；不加载 TUI、工作区、keychain。
- 公开中国站搜索成功，返回 2 项；真实读取 two-sum、reverse-linked-list、maximum-depth-of-binary-tree、min-stack，均有题面与非空 Go 模板。覆盖数组、链表、树、设计类题目读取。
- 模拟提交：一次 POST 返回 ID 后，调用仍等待判题；最后返回值不含 submission_id。证实需要补充独立 start/check。此测试完全替换实例 HTTP transport，Accepted 是 fixture，未向平台发送解题代码。
- pi-leetcode 抽象边界已完成：工厂注入、独立 JudgeBackend、执行记录标记后端、旧记录兼容及跨后端查询拒绝；31 项本地测试和类型检查通过。默认后端仍为 direct，尚未导入上游生产代码。

复现：在固定的临时上游检出目录安装后执行：

```sh
npm exec vitest run src/__tests__/api src/__tests__/schemas/submission-result-schema.test.ts
npm exec tsup -- src/api/client.ts --format esm --out-dir probe-dist
```

回到 pi-leetcode：

```sh
node scripts/probe-modern-client.mjs /absolute/path/to/checkout/probe-dist/client.js --live-cn
```

省略 `--live-cn` 时只进行模拟协议验证。探针不访问用户凭据、不创建上游用户工作区；上游源码和 node_modules 保留在临时检出中，不作为本仓库依赖。

## 接下来的实施边界

1. 固定 release 3.5.2，把 API/query/adapters/schema 的最小依赖闭包做成可导入客户端；保留 Apache-2.0 许可及来源说明，记录补丁，保持接口便于回馈上游。无需维护整套 CLI/TUI 分叉。
2. 增加 startRun、startSubmit、checkJob 与 AbortSignal；任务 ID 在查询前持久化。覆盖编译失败、运行错误、缺字段、超时、断线及未知发送状态，不把协议失败当作 Wrong Answer。
3. 用现有 backend adapter 映射题目与 JudgeResult，显式注入当前站点账户；不隐式读取 CLI 全局凭据。切换前保留 direct adapter 处理既有记录。
4. 完成真实账户 Run/Submit 验证后再切换默认后端；公开题目实测和 mock 成功都不能代替这一步。
