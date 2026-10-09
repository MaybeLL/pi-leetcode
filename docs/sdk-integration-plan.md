# LeetCode SDK fork 接入开发计划

日期：2026-10-08。范围：中国站、Go、Pi 现有练习与教学工作流。

状态：SDK 接入与默认切换已完成，当前新操作默认 SDK，direct 为显式回退。下文的初期 direct 默认值、旧 SDK 版本和测试数量是分阶段历史；当前使用方式见 [README](../README.md#backend-selection)，产物来源见 [vendor/README](../vendor/README.md)。

## 目标与约束

复用 night-slayer18/leetcode-cli 的 API client，保留 Pi 工作台、指导档位、练习文件、代码快照和执行历史。以 v3.5.2 对应提交 `282096f5c3952ae0e94a704adac344ec73c7732b` 为 fork 基线，补丁集中在独立 SDK 入口与可恢复任务接口。保持上游 CLI 兼容，不引入其 TUI、全局工作区或凭据存储行为。

用户验收闭环：选题 → 阅读 → 编码 → 测试 → 求助 → 提交 → 中断后恢复查询。公开读取、模拟 HTTP 测试和真实账户验证分别记录；只有真实判题验证通过才切换默认后端。

## 阶段 1：fork 与基线

- [x] 在 MaybeLL 账号创建 fork，本地独立仓库，保留 upstream remote。
- [x] 从固定 release 提交建立 SDK 开发分支，记录来源、许可证及补丁说明。
- [x] 复跑相关基线测试，确认没有覆盖其他工作区改动。

## 阶段 2：独立 SDK

- [x] 增加可导入 client 入口、类型声明和构建产物。
- [x] 导入不启动 CLI、不创建工作区、不读取全局凭据。
- [x] 凭据显式注入，每个账户/站点独立实例。
- [x] 从实际打包产物验证导入；依赖固定到可复现版本/提交。

## 阶段 3：任务契约

- [x] 增加 startRun、startSubmit、checkJob；发送立即返回任务 ID，查询只发一次检查请求。
- [x] 保留 testSolution/submitSolution，内部复用新接口实现兼容轮询。
- [x] 支持 AbortSignal、有限等待、脱敏错误分类与未知发送状态。
- [x] 不自动重发 Run/Submit；取消等待不表示取消远程任务。
- [x] 覆盖 Accepted、WA、编译/运行错误、缺字段、未知状态、断线、取消和重试次数。

## 阶段 4：Pi 适配

- [x] 实现新版客户端适配器，映射账户、题目、Go 模板、输入和判题结果。
- [x] 命令和 Agent 工具复用现有练习服务，发送后先持久化 ID，再查询。
- [x] 根据执行记录后端标识恢复任务；无标识旧记录归 direct 后端。
- [x] 保留 direct 作为验证完成前的默认值，提供明确的 SDK 试用入口。
- [x] 验证 SDK 构建产物安装、Pi 加载和所有本地回归。

## 阶段 5：验收与交付

- [x] 公开题目读取：数组、链表、树、设计类，真实中文题面、Go 模板和输入。
- [x] 有凭据时验证 Run、自定义输入、编译/运行失败、正式 Submit、停止与恢复查询。
- [x] 如账户未连接，准确记录待验证项，不将模拟 Accepted 作为真实通过。
- [x] 只有真实链路通过后切换默认；更新安装、兼容、恢复和验证文档。
- [x] 提交并推送 fork 和 Pi 的实现；整理可回馈上游的补丁说明，不自动向上游发送 PR。

## 测试与交付标准

SDK 测试通过公开接口和可控 HTTP transport，覆盖请求次数、请求字段、任务 ID 及异常结果。Pi 测试覆盖任务持久化、跨后端恢复、旧记录兼容、命令/工具共享数据和 UI 回归。实际安装产物必须可导入且不触发终端程序。

不在本轮范围：国际站产品化、多语言 UI、本地判题器、独立 npm 包发布、上游 PR 发送。协议与 schema 的变更补丁需记录，避免形成无法追踪的整套 CLI 分叉。

## 执行记录（分阶段历史）

用户已明确本轮只做无需登录的开发与验证，真实账户 Run/Submit 留作后续验收。

- Fork：[MaybeLL/leetcode-cli，pi-sdk](https://github.com/MaybeLL/leetcode-cli/tree/pi-sdk)，提交 `f19ba4aefb27914b5b5768e6b8123deda640b5a3`，已推送。
- SDK 具备独立 client 导出、startRun/startSubmit/checkJob、取消与错误契约、有限兼容轮询；保留完整用例分组、元数据和 CN 账户标识。
- 轻量 SDK 产物放在 vendor/，内部 SOURCE.json 固定 clean fork 提交；package-lock 固定完整性。安装不需要另克隆 fork，也不安装上游完整 CLI。
- Pi 通过 `PI_LEETCODE_BACKEND=sdk` 启用；默认仍 direct。恢复任务按原记录选后端，旧记录兼容。
- Fork：379 个测试通过；类型检查、CLI/SDK 构建、lint 通过（31 条既有 lint warning）。跳过安装脚本后需要单独 `npm rebuild keytar` 才能运行上游完整 CLI 回归；轻量 SDK 不依赖 keytar。
- Pi：37 个测试与类型检查通过，包含 SDK 映射、发送状态未知、跨后端恢复和查询总期限。
- 使用已安装 SDK 真实读取中国站题目 1/206/104/155，取得 Go 模板与 3/3/2/1 组示例；题号 42 搜索成功。
- SDK 导入在禁止文件写入、限制读取路径的 Node 子进程中成功，不需要用户目录访问。

- 从 `npm pack` 产物在全新临时目录安装成功；绑定 Pi 0.87.1 后，以 SDK 配置启动 RPC 宿主，扩展加载与 `/leet` 注册通过，没有调用模型或账户。
- fork 与 Pi 实现均提交推送；未向上游发送 PR。

真实判题、登录验证与默认切换未执行，不将 fixture Accepted 声称为平台通过。

### 后续登录验收更新

用户随后完成登录。SDK 身份验证和一次真实自定义输入 Run 的结果/原任务恢复查询通过；修复了带小数时间戳的运行 ID 和数组 code_output 的兼容性。当前 SDK 为 3.5.2-pi.3，fork `3f3e4ca`。详情与验证局限见 [接入验收记录](integration-status.md)。正式 Submit、完整真实错误矩阵、默认切换仍待验收。

### 完整真实验收与默认切换

后续用户授权继续执行、发现问题即修复。修复题号模糊搜索漏查后续页，以及 SDK 编译失败 null 统计字段；SDK 升级到 3.5.2-pi.4（fork 294bc86）。真实样例、WA、编译/运行失败、一次正式 Submit Accepted 65/65、停止等待与原编号恢复均通过。Pi 1.1.0 的编辑保存/重启恢复/Ctrl+R/Ctrl+H 到真实模型均已验证。42 项 Pi 测试、382 项 fork 测试、类型检查和构建通过。

默认后端现为 SDK，direct 仍可显式选择，旧任务归属规则不变。此前“未验证”和“默认 direct”的段落记录对应历史阶段，SDK 默认值以本节及 [README](../README.md#backend-selection) 为准；完整证据与剩余限制见 [接入验收记录](integration-status.md)。
