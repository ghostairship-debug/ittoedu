# 2026-10-27 下一阶段开发结果

状态：正式开发进行中；本文件是本批唯一结果入口。基线为 `4c34d90c`，接手时无 tracked 修改，原有三个未跟踪项保留。未提交、推送或发布。

## 已验证的产品增量

### 委派来源与交付

- 完整冷态 GLX 沿既有正式投影与 Source loader 准备依赖。逻辑 aggregate 同时占目录祖先时，物化到空闲 `index*.json`，原 `source#project:` 身份不变；具体资源/依赖地址保持。
- 冻结来源提前拒绝重复与文件/目录祖先冲突，避免落盘到一半才失败。
- 原生委派的本次输入与声明输出冲突时，将来源整体放入明确的输入目录，子作者得到真实物理路径。未生成的旧输入不能冒名新产物；明确复制的同字节交付仍有效，正常续接沿用原副本和 child identity。
- 验证：`delegationMaterialization20261027`、`delegationSourcePreparation20261019`、`taskInputsAndArtifactGroup20261019` 与 `g20ExternalMcpService` 四文件 **53/53 通过**。新冷态完整投影用例包含实际落盘、完整字节比较与封存读取；这不是一次真实模型子作者创作。
- 保留边界：续接时重新将历史输入地址声明为新输出、且不重新提供 sources 的特殊情形尚未扩大处理；未宣称所有恢复场景均已消除输入/产物混淆。

### MCP 工具错误恢复

- 未知工具名及 `tools.load` 的 unavailable 项会返回当前授权 catalog 中相关真实工具名和完整参数 schema，并指明协议 `tools/list`。
- 没有执行猜测别名，没有另建工具注册表；workspace/read-only 两种实际 MCP 连接验证恢复信息没有越出目录，且未知调用没有触发实际工具执行。
- 同批维护了旧测试的显式 workspace 权限与图片资源 owner fixture，使断言继续验证本来的边界；未改变产品默认权限。
- 尚未重跑真实 ACP 模型误用 `text.read` 的原反例，服务端与 MCP 传输验证不冒充客户端最终表现。

### Source 沙箱坐标修复

- 真实生产 UI 暴露 `clientMatrix` 在压缩分块后跨 realm 执行时 `g is not defined`。根因为用 `Function.name` 拼接依赖绑定，不能代表消费模块的词法导入别名。
- 改为闭合 factory 显式接收既有纯几何函数，宿主与沙箱仍复用同一算法；未改变作者 Source 或 formal frame。
- 实际 esbuild 压缩/分块、独立 realm、父缩放/子旋转测试 **1/1 通过**。生产 sources/player/renderer 已重建。真实 UI 从重复 prepare、零 mount、报错，恢复为一次 module import、一次 mount、三次可信点击计数，错误列表为空。
- 新 UI 用例继续发现：Source 内嵌原生文字的真实双击进入父容器，未打开文字编辑器。此接力断点正在单独修复，完整 B3 生命周期验收尚未签收。

## 完整 Pi AgentSession 实验

使用原机 `@earendil-works/pi-coding-agent` 1.4.0 的完整 `createAgentSession`、`ModelRuntime`、原生 `SessionManager`。领域工具走现有 MCP/Gateway；模型循环、重试、压缩及唯一会话历史留在 Pi。代码位于 `scripts/experiments/pi-domain-*.mjs`，没有替换产品默认 Engine。

- 精确复用已有 TeamoRouter / `deepseek-flash` 授权；实际 `/models` 确认该 alias。没有复制订阅凭据、调用其他开发 Agent 或修改模型路线。
- 真实 UI 先人工修改保留区，再点选唯一目标；零模型 preflight 通过。
- 首次真实模型已生成工具调用，但自定义模型缺少 SDK 必填 cost 元数据，原生会话以 `tiers` 错误结束，零领域写入。补齐 SDK 兼容占位并保留 `moneyCost=unmeasured`；零占位不代表实际免费或供应商价格。adapter 同时直接传播 native error/aborted 状态。
- 修正后两轮真实修改通过：第一轮 **36,357 ms**，原生 JSONL idle reopen 后第二轮 **21,824 ms**；每轮均为 `workbench.state → read → text.replace → file.save`。8 个实际 provider 请求的工具 schema 与实际 catalog 一致。
- 重开同一 native session 时恢复 10 条消息与 4 条工具结果，没有重放原写入；两轮均改变磁盘归档并正式保存。
- 独立 profile 冷开为 revision 3、dirty=false；目标正文、人工保留区和全部无关作者字段均正确。已人工查看冷开截图，文字可读无遮挡。域撤权得到确认。
- 6 个适配器针对性用例通过；覆盖稳定 ticket、未知结果携原 ticket、停止派发与有界清理。真实压缩、长任务崩溃恢复和重建宿主授权未由这次短链证明。

关键证据：`output/next-execution-20261027/pi-ui/run-4RT21H/`；首次失败保留于 `run-RErVi8/`；Source 运行增量证据 `output/next-execution-20261027/source-ui/run-mUupgo/`。

## 实际 UI 与当前验证边界

- `a05AuthorSource20261014` 实际界面回归通过：Source 深改、普通文字编辑、Undo/Redo、保存与独立冷开。修正了旧测试的热点 label 和 textarea/value 假设，维护测试不计作产品 Bug 修复。
- `npm run typecheck` 在上述集成状态通过；后续新增修复继续按影响补验证，不宣称全仓所有历史测试通过。
- 下一步：完成 Source 内嵌原生文字命中/编辑的同一 owner 接力；复用市场作品 pre-T3 存档完成真实 Pi 局部修改、UI 同步与离线导出；再按真实失败推进。

## 未完成事项

1. **技术/验证进行中**：Source 原生子文字接力及完整生命周期 UI；完整市场作品返修与导出。
2. **已知证据缺口**：B3.1 历史“95小时”未对上同次采用输入；不加全局宽度补丁，不将旧问题写成已根治。后续需要来源 border-box → assembly → Native draft → 正式渲染的首差异。
3. **产品决策尚未提出变更**：Pi/ACP 如何进入默认会话内核须依据更完整实测判断；本批仅保留可撤回实验入口。
4. **连接限制**：DevSpace 三次打开工作区均内部错误，RDC 主通道可用；子 Agent 远程调用曾持续挂起，改为本地镜像并行、主 Agent 集中远程集成。旧用户窗口未结束。
