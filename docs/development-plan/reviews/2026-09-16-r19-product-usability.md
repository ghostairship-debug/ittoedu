# 1.9 产品可用性改进实施结果

## 结论

[本轮方案](../R19_PRODUCT_USABILITY_IMPROVEMENT_PLAN.md)的 A–D 已实施并形成工程候选。修改针对产品预算、原生纠正、候选反馈与工作台可用性；冻结的电路课件 revision 23 没有继续返工。未提交、打标签或发布，不将本批结果自动写成整版 1.9 / Owner accepted。

## 已改变的行为

| 范围 | 当前行为 |
|---|---|
| 总预算 | 默认 20 分钟。工程生成开始前可选 20 / 40 / 60 / 120 分钟；活动原生回合可显式增加 20 分钟，累计最多 120 分钟。检查/候选等待阶段不提供延期入口；课例讨论和文件任务发起仍为默认预算。 |
| 延期一致性 | 只有成功持久化的 ACK 携带新 deadline；Main、Controller 和聊天投影同步。旧 poll、失败保存、乱序 ACK、Stop 后旧写入不能恢复或延长任务。 |
| 停滞 | 与总预算分开检测 20 分钟无有效原生活动；重复文本/usage 快照不续命。已知工具仍运行或等待用户回答时不据静默判定停滞；整体预算仍有效。重复候选和格式修复限制保留。 |
| 运行中输入 | 默认“立即引导”；Codex 使用已有 steer，Claude/OpenCode 经确认中断后同会话续接。“下一回合补充”保留为明确选项；聊天按真实 ACK/consumed 展示送达状态。 |
| 旧候选 | 最新输入先持久化；原生结束与候选检查期间收到纠正也阻止旧候选应用。中断失败、Stop、到期和迟到结果不启动新回合，不回滚此前正式提交。 |
| 静态反馈 | Component manifest 变更的 UTF-8 正文复用正式 schema；精确冻结 target 的 canonical address 明确为 Component 时，提前拒绝 native.content。live 身份、资源、编译和动态行为仍由宿主裁决。 |
| 导航与取景 | Component 源文档消歧 goToScene / nextScene。spatial.structure 的 fit-world-content 复用现有算法，在一个事务中保存目标 surface 的 home 与目标 location 镜头；不修改其他入口，不把 HUD/全局控制器纳入 world 范围。 |
| 工作台 | Shell 只组合 View、工作空间用例和文件标签 controller，桌面文档 AI 窄端口由 Host 注入。宽窗三栏、窄窗三面板切换；文档保持挂载。低频操作归入菜单，聊天输入固定可达，路径缩短显示。 |
| 切换与恢复 | 课例/工作空间切换先停止文档 AI、flush 成功后才 route/dispose；失败保留当前稿。独立课件进入工作台，大小写/斜杠不同的已开文件路径复用同一 editor。 |

Shared / Core、本地服务、前端职责保持分离。本次完成有真实消费者的工作台拆分，没有新增后端服务、第二 Store / History 或应用自建模型循环。

## 验证证据

### 工程与界面

- 三套 TypeScript：通过，见 `../../../output/r19-improvements-typecheck.log`（历史链接目标未保留）。
- Main / Renderer 构建：通过，见 `../../../output/r19-improvements-electron-build.log`（历史链接目标未保留）、`../../../output/r19-improvements-renderer-build.log`（历史链接目标未保留）。既有 Player 制品未受产品源码变更影响；真实 Published consumer 另有下述行为验证。
- ROOT 聊天检查：3 文件 60 项通过，含选定预算真实请求、权威延期展示、同一纠正消息跨回合送达、拒绝输入保留与现有聊天行为，见 `../../../output/r19-improvements-chat-tests.log`（历史链接目标未保留）。
- 工作台：最终 4 项通过，覆盖冲突保留、面板切换不卸载、独立工程入口、异形路径复用。早期 3 文件 12 项 UI 组合通过保留；后续新增回归由同源隔离工作区验证，未无意义重复整套。
- 静态预检查 28 项、Spatial 26 项通过。Spatial 检查含正式候选事务、保存重开、实际 `SpatialSurfaceHost` 内容边界。
- 新增真实 Published Component 导航用例 1 项通过：实际挂载组件调用 goToScene(Flow locationId) 返回 false；导航 guard 拒绝时不移动；解锁后 nextScene 从 Slide 到 Flow 再到 Spatial。没有用无条件成功 mock 证明目的地。
- 能力生成已完成：77 文件，索引 15,753 / 16,384 字节；生成的 spatial.structure schema 已包含 fit-world-content。

### 生命周期

独立 Astra/high 复核结束，无剩余已发现的实质阻断。针对延期持久化/旧写覆盖、取消 ACK 先后、Stop 迟到写、checking 期间纠正等反例已验证。

生命周期三文件执行结果为 164 通过、1 项旧 startup/read 计数竞态失败；修正为等待两个原生 stream 就绪后观察 read，该项及相关 Stop 检查通过。另有新预算/中断/Controller/OpenCode 9 项、Claude 2 项、adapter discovery 8 项及 idle 输入跨 Stop 回归通过。早期把 Stop 排在候选 IO 锁后的尝试已终止并修复；终止轮不计通过。原整库红轮亦未被改写成绿轮。

### 真实原生消费

只运行本次改动影响的两个通道，各一次简单任务：

| 通道 | 本次结果 | 时间 |
|---|---|---|
| Claude → 已核实 DeepSeek | 真实工具运行中纠正，同 external session 两个 run，第二回合返回新要求标记 | 16.96 秒 |
| OpenCode → Luna Fast | 真实原生取消确认，同 external session 续接，第二回合返回新要求标记 | 22.19 秒 |

完整记录见`../../../output/r19-native-steering/REPORT.md`（历史链接目标未保留）。OpenCode 的 ACP resolvedModel 仍为空；免费本机配置/原生目录验证了 Luna Fast → OpenAI provider → gpt-5.6-luna 的实际发送映射，不声称观察远端内部路由。OpenCode 初次报告的 marker 假阴性来自逐条检查 append chunk，已用原保存事件拼接修正，未再调用模型。

这两次证明中断与原生续接，任务为讨论模式，零 candidate/host commit。编辑候选不抢先的性质由宿主和 Controller 的免费竞态反例覆盖；不把零候选讨论说成实际课件编辑。Codex steer 未改，复用已有证据，没有重跑三 CLI 全矩阵。

### 实际工作台操作

使用 `agent-browser` 连接当前 Electron 构建，独立 profile / 工作空间，未调用 GUI 中的模型：

1. 从真实工作空间创建课例，打开目录中的真实 Markdown；
2. 在正文编辑器输入新段落，切到对话再回到文档；
3. 文档保存、关闭标签、从目录重新打开；界面与磁盘均保留新段落；
4. 检查 1440×960 与 760×900 窗口，聊天输入、文档/课件标签可达；窄窗新建独立课件显示真实画布；
5. 关闭本轮测试 Electron，测试文件保留供审阅。

截图：`../../../output/r19-usability-gui/before-narrow.png`（历史链接目标未保留）、`../../../output/r19-usability-gui/after-narrow-chat.png`（历史链接目标未保留）、`../../../output/r19-usability-gui/after-narrow-document.png`（历史链接目标未保留）、`../../../output/r19-usability-gui/final-wide-document.png`（历史链接目标未保留）、`../../../output/r19-usability-gui/final-narrow-standalone.png`（历史链接目标未保留）。原宽窗截图使用系统设备倍率，修复截图使用显式 CSS viewport，不能据此计算字号改善比例。

## 边界与交接

- 完成的是本轮有证据驱动的产品改进。版本 050 / 060 与独立教学行为 QA 的既定范围不因任务板清空自动完成，2.0 软件内生产 QA 未启动。
- 不承诺任意模型都能一次生成正确教学机制；静态准入、工程正确、实际机制质量和 Owner 验收分别记录。
- 本批没有再运行或手工修复冻结的电路课件，没有偷偷延长任何实际用户任务。
