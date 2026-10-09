# 是否以 skygragon/leetcode-cli 作为平台后端

评估日期：2026-10-08。第一轮为源码研究；第二轮完成隔离安装及协议探针，见文末。本次评估阶段未迁移默认后端，未读取账户凭据或进行真实 Run/Submit。

> 历史候选评估：当前产品没有采用此旧 CLI 作为默认后端，而是采用另一个现代客户端的 SDK fork。后续选型见 [现代 CLI 评估](modern-cli-evaluation.md)，当前默认值见 [README](../README.md#backend-selection)。

## 结论

优先复用已有平台客户端符合本项目的定位，但当前证据不足以把这个原版 CLI 直接定为唯一后端。建议先做一个有明确通过条件的接入验证，比较“原版/维护分支 + 小型适配层”与现有直接接入。若必须长期维护 CLI 的认证、平台协议和输出协议，省下的工作可能少于新增的维护成本。

现有工作台、教学档位、练习文件、代码快照、历史及复盘交接继续由 pi-leetcode 管理。平台客户端负责账户、题目、运行、提交和查询。界面与教学只依赖这一层能力，不依赖某个 CLI 的终端文案或安装路径。

## 核实到的事实

1. **功能范围匹配。** README 提供 list/show/test/submit、模板生成、缓存、提交历史等能力；配置包含 `golang`。该项目可以作为复用候选。来源：[README](https://github.com/skygragon/leetcode-cli/blob/5245886992ceb64bfb322256b2bdc24184b36d76/README.md)、[config.js](https://github.com/skygragon/leetcode-cli/blob/5245886992ceb64bfb322256b2bdc24184b36d76/lib/config.js)。
2. **主线维护较久未更新。** GitHub API 查询到主分支最新提交为 `5245886992ceb64bfb322256b2bdc24184b36d76`，提交时间 2019-09-29；最新 release 是同日的 2.6.2。仓库未归档。仓库级 pushed_at/updated_at 更新不能当作主分支代码持续维护的证据。来源：[提交](https://github.com/skygragon/leetcode-cli/commit/5245886992ceb64bfb322256b2bdc24184b36d76)、[发布](https://github.com/skygragon/leetcode-cli/releases/tag/2.6.2)。
3. **CLI 输出不是稳定的数据协议。** 检查过的 test/submit 命令通过日志和彩色文本显示结果，没有声明 JSON 输出选项；内部方法有结构化回调，不能因此把终端 CLI 当成稳定 SDK。来源：[test.js](https://github.com/skygragon/leetcode-cli/blob/5245886992ceb64bfb322256b2bdc24184b36d76/lib/commands/test.js)、[submit.js](https://github.com/skygragon/leetcode-cli/blob/5245886992ceb64bfb322256b2bdc24184b36d76/lib/commands/submit.js)。
4. **中国站需要额外插件。** 核心配置默认 COM，外部 plugins 仓库的 `leetcode.cn.js` 在所审版本仍配置 `leetcode-cn.com`。这说明需要验证插件和当前站点的兼容性，不足以断言中国站必然不可用。来源：[CN 插件](https://github.com/skygragon/leetcode-cli-plugins/blob/752e94e8a755106106af65af9d9b831d9810c4cd/plugins/leetcode.cn.js)。
5. **任务恢复语义需要补充。** 核心将发送与轮询封装在一次回调中；本项目需要先取得并持久化 job ID，再独立恢复查询。自动登录默认关闭；若启用，retry 插件会在 EXPIRED 错误后重新调用 submitProblem 等操作，可能将查询阶段的失效扩大为重发整项操作。不能把这种行为等同于安全恢复原任务。来源：[平台实现](https://github.com/skygragon/leetcode-cli/blob/5245886992ceb64bfb322256b2bdc24184b36d76/lib/plugins/leetcode.js)、[重试实现](https://github.com/skygragon/leetcode-cli/blob/5245886992ceb64bfb322256b2bdc24184b36d76/lib/plugins/retry.js)。
6. **内部模块有初始化耦合。** core、config、session 与插件链是共享模块状态；直接 require 内部文件需要接管初始化、缓存、日志与插件。package 未提供明确的 main/exports SDK 入口。包声明 Node >=4，旧打包目标为 Node 10；这不证明它在现代 Node 必然失败，也不构成对我们 Node 22/24 的验证。许可证为 MIT。来源：[core.js](https://github.com/skygragon/leetcode-cli/blob/5245886992ceb64bfb322256b2bdc24184b36d76/lib/core.js)、[package.json](https://github.com/skygragon/leetcode-cli/blob/5245886992ceb64bfb322256b2bdc24184b36d76/package.json)。

## 本次只读实测

将 CLI 源码中的 `getQuestionDetail` 查询字段直接发送至当前 `https://leetcode.cn/graphql/`，以 two-sum 为输入，成功取得 content、stats、codeDefinition、sampleTestCase、enableRunCode、metaData、translatedContent。

因此，不能仅根据字段较旧就声称它的题目查询已经失效。这个请求没有运行 CLI、没有使用它的旧中国站域名或登录插件，也没有验证 Run/Submit。当前结论是“值得验证，但未证明可以直接替换”。

## 候选接法

| 接法 | 收益 | 需要承担的工作 | 建议 |
| --- | --- | --- | --- |
| 子进程包装原版终端输出 | 隔离 CLI 依赖，快速验证命令 | 文本解析、错误/退出码映射、任务 ID 和恢复查询不足 | 仅用于验证，不直接作为正式协议。 |
| 直接导入其内部模块 | 能获取结构化回调 | 非公开模块、全局初始化和插件状态耦合 | 不建议直接耦合进 Pi 进程。 |
| 经验证的维护分支或小型 bridge | 可统一 JSON 与任务事件，复用平台实现 | 固定版本、契约测试、明确上游维护责任 | 若修改量小且真实链路通过，优先考虑。 |
| 保留当前直接接入 | 代码、快照和恢复控制明确 | 我们承担平台协议变化 | 保留为比较基线，不因已投入开发就默认胜出。 |

目标能力边界为账户检查、题目检索/读取、发起运行、发起提交、查询既有任务。发起与查询必须可分离；凭据归客户端管理，向 Pi 只返回脱敏结果。命令和 Agent 工具使用同一练习服务。

## 接入验证的通过条件

1. 在目标 Node 和操作系统上可重复安装，固定 CLI/插件版本。
2. 当前中国站可正常连接账户、拉取真实 Go 模板和输入。
3. 分别验证一次 Run 与一次明确请求的正式 Submit；题目覆盖数组、链表、树及设计类。
4. 返回可机器读取的题目、编译错误、输出、判定、任务 ID；模型不负责解析终端文本来推断成败。
5. 取得 ID 后断网或退出，可以查询同一任务；未知发送状态不自动重发，取消本地等待不冒充远程取消。
6. 对比 bridge/补丁量与直接实现的维护面，再确定首发后端。

如果需要大规模改写认证、站点协议和调度，停止将其包装成“简单复用”；重新比较维护分支或直接实现。当前工作台和练习数据不依赖这一选择，无需推倒重建。

## 隔离验证结果（2026-10-08）

固定上述 CLI/插件 SHA，使用 Node 24.19.0，`npm install --omit=dev --ignore-scripts --no-audit --no-fund` 安装成功。探针见 [运行器](../scripts/legacy-cli-probe/run.mjs) 和 [复现说明](../scripts/legacy-cli-probe/README.md)。通过 preload 重定向 CLI 自身的数据目录函数，未更改 HOME，未访问用户 `.lc` 或浏览器凭据。

| 探针 | 结果 |
| --- | --- |
| `submit --help` | 正常运行；未声明 JSON 输出。 |
| 模拟网络失败 | 打印 `[ERROR] Error: FIXTURE_NETWORK_FAILURE`，进程退出码仍为 0。 |
| 模拟 `test --json` | 输出面向人的文本，JSON 解析失败；未输出任务编号。 |
| 模拟 `submit --json` | 输出 Accepted 文本，JSON 解析失败；未输出任务编号。Accepted 完全来自本地 mock，不是真实提交。 |
| 中国站匿名 catalogue GET | 请求旧域名 `leetcode-cn.com`，CLI 报 session expired，退出码 0。未验证登录后的行为。 |

原版终端协议未通过接入条件，停止将其作为首选适配目标。现代替代候选见 [night-slayer18 评估](modern-cli-evaluation.md)。

本项目已抽出 `LeetCodeBackend`/`JudgeBackend` 和工厂入口。执行记录保存后端标识；切换后端时拒绝误查原任务，缺少标识的旧记录仍归原 direct adapter。当前默认仍为直接中国站实现，未引入任一 CLI 作为生产依赖。
