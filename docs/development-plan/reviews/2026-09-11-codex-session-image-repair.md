# 2026-09-11 原生 CLI 会话、图片传输与受阻答复修复记录

> 后续证据边界：2026-09-11晚间Owner在Luna/medium与slide-heavy中的换图仍失败，并确认场景树漏显与默认范围缺陷。本文下述通过仅对应下午Astra与所述夹具、配置和行为，不能外推普通换图全面可用。新失败事实和待实施修改方案见[三层执行方案](../AI_COMMON_TASK_EXECUTION_PLAN.md)；原样本与原检查结果保留。

本记录对应用户实际使用中的两次 Codex 失败、同类 OpenCode 失败及源码修复。当前 Codex 真实图片生成、文件导入和宿主替换已通过，保存、撤销、重做、重新打开及离线 HTML 呈现复验完成；OpenCode 被独立复现的原生 API 连接故障阻断。两处检查脚本错误及更早修复复测失败保留在下文，不表示 1.8/S3 完成或已发布。原始失败均无宿主提交回执，不能视为课件已修改。

## 1. 原始证据与定位边界

时间均为本机北京时间 2026-09-11。

| 运行 | 用户目标 | 已观察事实 |
| --- | --- | --- |
| 13:10:08 失败；应用会话 `80ef4957-101e-4a83-8a3c-c34333128da6` | 将选中图片替换为卡通小狗 | 错误为 `failed to read session metadata … rollout … is empty`；原生会话 `01a08edf-82c4-7230-9d73-abe0fae0134c` 的 rollout 文件检查时仍为 0 字节。应用仅保存一条失败终态事件。 |
| 13:12:57 失败；应用会话 `455e970b-56d9-4ef8-a11f-84b52c453fc2` | 将选中形状替换为卡通小狗图片 | 原生会话 `01a08ee1-15c7-7162-8fa8-bf6b338faa83` 的图片生成事件已完成并带有 `savedPath`；完成事件约 1.86 MB，包含 Base64 图片。随后应用报告 `output-limit` 并中断，尚未提交替换。 |
| 13:08 OpenCode；应用会话 `cc389cfe-ab68-4ed8-9b45-a8305028c732` | “帮我把这张图片变成一个卡通小狗的形象” | 实际配置 `openai/gpt-5.6-luna-fast`、`medium`、`orchestrator`。三个原生回合中提交两个被拒候选：空 steps、自造 `semantic-redraw`；最后以答复结束，任务未完成。不是五次宿主重试。 |

应用记录位于 `%APPDATA%/ittoedu-courseware-editor-v8-rebuild/local-agent/v2/<workspace-key>/<应用会话ID>.json`；原生记录位于 `%USERPROFILE%/.codex/sessions/2026/09/11/`，文件名包含上述原生会话 ID。

第一项原始应用记录未保留失败 RPC 名称，不能仅凭阶段文案断言模型尚未启动。14:03 的真实复测证明只捕获空 rollout 后等待通知仍不够：出现“未取得 Codex 本回合实际模型/强度”。14:05 用安装版 Codex 0.154.0 记录原生协议，确认 `thread/start` 已返回实际 `gpt-6-astra/medium`，`turn/start` 已成功，紧接的 `thread/read` 因 rollout 为空失败；同配置回合未发 `thread/settings/updated`，不能要求未改变的配置必须再产生变更通知。本次消除该冗余确认路径，不宣称已查明原生日志为空的所有原因。

第二项与 Codex adapter 原有单行 1 MiB 限制及中断时间相符，属于宿主传输限制，并非已证实的模型 token 输出耗尽。该次原生 `turn_context` 明确记录 `approval_policy=never`、`sandbox_policy.type=danger-full-access`；本次没有收紧 CLI 权限。此证据只代表该次 Codex 运行，不外推三 CLI 全部能力已验证。

OpenCode 原始任务把课件能力目录误当作原生工具全集，再受“必须给候选”和拒绝后继续给候选的提示影响，明确构造非法操作以获取诊断。原始日志与当前同目录 `opencode mcp list` 仅确认 `websearch`、`context7`、`grep_app`，没有可用图片生成连接；不能将未连接能力说成编辑器拒绝了工具权限，也不能承诺提示修复会凭空新增图片生成服务。

## 2. 本次实现

- [Codex adapter](../../../src/main/localAgent/codexAppServer.ts)：同一原生会话的已确认配置与本轮请求匹配时，让 `turn/start` 继承该配置，并在成功 ACK 后发布实际配置，不再读空 rollout 或等待无必要的变更通知。模型或显式强度变化时仍要求匹配的新原生元数据/通知，不能用请求值或目录默认值充当实际配置。该查询遇到特定空 rollout 时等待原生 settings；其他 RPC 错误保留方法名并失败，不重复发起回合。传输改为单消息 32 MiB 上限，取消长会话累计 8 MiB 限制；有原生保存路径的图片生成事件在展示记录中保留路径及元数据，不重复持久化 Base64。
- [共用图片指导](../../../src/shared/courseAgentSkills.ts)与[生成提示](../../../src/main/localAgent/profile.ts)：根据显示区域和宽高比选择尺寸，小插图通常长边 512–1024 像素；交付前检查实际像素和字节，必要时优化生成副本。小插图争取 100–300 KB、背景争取 500 KB 以内，清晰度优先；保留透明度，不覆盖用户原图，不编造工具尺寸参数。这是 Agent 执行指导，本次已取得一例实际压缩效果证据，并非强制图片编码管线。
- 通过现有能力生成入口同步内置资源与 `course-build`、`pro-editing`、`visual-craft` 技能。生成工具不支持尺寸参数时，不能保证上游直接返回小图，需按指导优化交付副本。
- [任务提示](../../../src/main/localAgent/profile.ts)区分课件接口和 CLI 原生工具；允许按实际可用能力取得素材，禁止自造像素变换操作。确实受阻的 reply-or-edit 任务可诚实答复结束，保留未完成状态，不强迫提交空候选或非法诊断候选。[宿主反馈](../../../src/main/localAgent/harness.ts)明确 rejected 不等于提交，只在存在合法修正办法时继续候选。未新增通用 Agent 平台、模型循环、图片服务或权限覆盖。
- 14:12 真实 Codex 复测已完成图片生成、检查和优化，原生正常图片事件未再被截断，但最终因“素材导入只收 Base64、提示要求文件引用”答复受阻，零提交。这暴露了 Codex 结构化结果通道的实际文件摄取缺口，不能把原方案中的文件引用指导当成已实现能力。本次在现有 [CandidateStaging](../../../src/main/localAgent/candidateStaging.ts) 补上仅供 `asset.media.import.input.base64` 的 strict `{$candidateFile:"resources/..."}` 投影；宿主验证当前身份与本轮真实文件后展开为原工具字符串，读后重验任务。成功原生回合的文件保留到候选读取，随后清理；同一候选复用已读取字节。旧字符串兼容，V9/Published 与正式媒体工具 Schema 不变。合同见[媒体候选补充](../roadmap/1.8/IMPLEMENTATION_CONTRACT.md#1-用户工作流与应用策略)。
- 真实 0.154.0 图片通知使用 `type=imageGeneration`；展示 trace 的 Base64 去重同时兼容该分支和旧 `kind=image_gen.generation`。14:12 复测时前者仍有冗余编码，后续补正并分别验证，两者仍保留原生保存路径与元数据。

## 3. 已执行检查

以下是修复当轮已执行的结果，本次补文档未重复运行：

| 检查 | 结果与覆盖边界 |
| --- | --- |
| `npx vitest run tests/unit/codexAppServer.test.ts -t "Codex native subprocess failure and configuration boundaries\|uses effective settings"` | 17 项通过，41 项未选中。覆盖空元数据后配置确认、只发送一次 `turn/start`、约 1.86 MB 图片事件及累计超过旧阈值的传输、超大单消息失败等。测试通过实际子进程管道模拟原生协议，不是安装版 Codex 的真实模型调用。 |
| `npx vitest run tests/unit/generationCapabilityWorkspace.test.ts tests/unit/coursewareSkillsContract.test.ts -t "loads identical skill guidance\|reads exact staged image\|directly supplies complete title"` | 3 项通过，23 项未选中。覆盖共用技能、暂存资源读取路径和初始提示预算；不证明生成图片的实际清晰度与体积。 |
| `npm run generate:ai-capabilities`、`npm run build:electron` | 能力资源已生成，最终 Electron 编译通过；未自动重启运行中的编辑器。 |
| 14:11 Codex 具名协议检查 | 16 项通过，44 项未选中；覆盖新建/恢复会话同配置无通知且不读日志、模型/强度变更仍需实际确认、空/旧元数据后的 settings、两回合身份隔离、正常图片与过大单帧。新测试的完成事件独立于 `thread/read`，不再把测试替身的时序误当原生要求。 |
| 受阻答复及宿主反馈具名单元检查 | 新增“拒绝后诚实答复结束”与真实回执续轮共 2 项通过；相关相对编辑、提示和配置等此前 11 项具名检查通过。替身验证，不代表真实 OpenCode 已生成图片。 |
| 图片文件候选与生命周期 | 9 项通过：真实文件展开、同候选复用、原始 trace 不膨胀、缺失/穿越/绝对路径/额外字段/超量/目录链接拒绝、读取时 Stop 不复活任务，以及旧脚本 Base64 输入继续兼容。文件本身读取不算宿主提交。 |
| 提示预算与改动后检查 | 文字/图片选区的 edit/plan 共 4 个具名用例通过，每项核三 CLI 的完整初始提示 ≤12 KiB；压缩的是重复叙述，图片尺寸细则由本轮 visual-craft 按需提供。更新后的答复、相对编辑、回执、修复、恢复与共用技能 9 项具名检查通过；两个图片协议变体通过。 |
| 具名真实 Electron 失败注入 | `S3 聊天失败注入：一次修复、无进展停止、取消与人工撤销后旧结果零写入`：候选文件生命周期改动后复验 1 项通过（1.3 分钟）。含另存隔离与无页面异常；原生 CLI 为协议替身，不算真实模型调用。 |
| 最终代码与制品检查 | `tsc --noEmit`、`build:electron`、`build:renderer` 通过；能力资源按当前语义重新生成。Player 源码未改，复用已有构建；未运行完整 CLI 矩阵，未重启用户编辑器。 |

14:13 的真实 OpenCode 图片复验停在原生 provider 连接阶段，返回 `Cannot connect to API`，没有候选、宿主提交或模型 token 输出。原生主请求重试与自动标题请求同样失败。14:41 使用原始 cwd、OpenCode 1.18.26、`openai/gpt-5.6-luna-fast/medium` 做一次绕过编辑器 ACP 的“只回复 OK”原生控制调用，207.976 秒后自然失败、exit 1，同错误且无文本/工具/tokens。这证明连接阻断可独立于图片和候选输入复现；具体网络/代理/服务原因尚未确认，未更换模型/认证/代理。该次失败与原 13:08 的提示/非法候选问题分列。净化证据：`output/playwright/r18-session-image-repair-20260911/opencode-native-control-result.json`。

## 4. Codex 真实图片替换证据

14:35–14:41，固定 Codex 0.154.0、`gpt-6-astra/medium`，在独立生产构建 profile 中通过真实 UI 发送“帮我将这个形状替换为卡通小狗图片”。使用真实原生图片生成，候选为文件导入、Native image 创建和 `selection.replace` 三步骤，宿主正式提交 revision 0→1。

- 应用会话 `2824b55f-59bf-4c09-a76e-19f2f18cd520`，原生会话 `01a08f2d-fd24-7223-aed5-e63e8cab2347`；一个原生回合、一次提交、0 次格式修复，无用户干预。
- 原图文件 1,234,850 字节；交付 WebP **512×512、23,586 字节**，显示 frame 保持 x=460、y=260、220×220，标题和对象数量不变。实际查看原尺寸图片及编辑器截图，边缘、眼睛和嘴部清楚，完整小狗未裁切。该素材无透明通道；不把这次验证外推为所有透明图片质量证明。
- 实际图片事件携带 1,646,468 字节 Base64，被正常接收；持久化 trace 保留文件路径、长度与元数据，没有重复 Base64。正常图片返回后仍完成候选与宿主提交。
- 点击到宿主完成约 352 秒；其中原生打开约 10.9 秒，接受回合到候选解析约 334 秒，候选解析到提交记录约 0.17 秒。此处仅修复可完成性，没有宣称整体提速，也不能由这些阶段把原生等待细分为模型、网络和队列时间。
- 保存的 `.h5lesson` 解析确认图片、frame 和原有标题正确；真实 UI 撤销后对象恢复、资源表为空。验证脚本把 archive 返回的无原型空资源对象与 `{}` 做严格原型比较，导致脚本在正确撤销之后中止；属于探针错误，已改为检查资源项数量，复用该次小图另跑后续行为，不重新付费生成图片。

证据目录：`output/playwright/r18-session-image-repair-20260911/codex-2026-09-11T06-35-12-657Z/`，包含原生/宿主记录、`image-metrics.json`、`applied.h5lesson`、`undone.h5lesson`、`delivered.webp` 和 `applied.png`。所有课件操作均在测试工程副本中，未修改用户正在编辑的课件。

14:43–14:55，复用上述 23,586 字节图片，在另一独立 profile 中补验同类替换及后续行为，没有重新调用图片生成：

- 应用会话 `687bf20d-c864-43e6-956f-ed3f32e38f1b`，原生会话 `01a08f35-71f6-78b0-9958-78934ab920c9`；两个原生回合、一次正式提交、0 次格式修复。第二回合由提交后的显式 observe 发起，取得已提交事实后正常结束。点击到任务完成约 397 秒；任务提示含复验要求，不能与上一例直接比较速度。
- 通过真实 UI 保存、撤销、重做，再逐次解析归档：撤销恢复原形状且清除本次资源；重做恢复同一图片内容和素材；标题、位置、尺寸、对象数量正确。
- 第一次重开后的脚本仍等待“图层”面板节点，而产品默认已切回“属性”，因此等待超时；当时 UI 已显示打开成功和两个节点。这是第二处检查脚本错误。修正为先切图层后，使用独立短探针打开已经保存的重做结果，通过节点及实际画面检查，无需再次请求模型或生成图片。
- 用正式 `buildPublishedCourseStandaloneHtml` 构建导出物，真实 Chromium 在 offline 状态从本地 HTML 加载。实际查看重开编辑器及离线 Player 截图：标题保留、小狗清楚且未裁切、位置尺寸符合原 frame；两者无页面异常。本项验证导出器结果及离线呈现，不另宣称导出菜单交互已复验。

补验证据目录：`output/playwright/r18-session-image-repair-20260911/codex-2026-09-11T06-43-19-342Z/`，包含 `result.json`、三次保存归档、`reopened.png`、`lesson.html`、`offline-player.png` 及两条原生配置确认记录。最终代码和构建已就绪，用户正在运行的编辑器未被重启；本次未提交 Git 或发布新版本。

## 5. 剩余验证与归期

- 当前 Codex 原生启动、图片返回、小图文件导入、宿主指定对象替换及保存/撤销/重做/重开/离线呈现已取得实际证据。不得把这些成功外推为 1.8 整体或三 CLI 全部完成。
- 当前 OpenCode：提示及诚实受阻逻辑的聚焦检查通过；原生服务连接恢复后仍需补同配置目标复验，不能将本次连接失败算作提示修复的成功证据。
- Claude/OpenCode 源码仍有较小输出上限；本轮未复现同类真实故障，未修改这两条传输链。只有实际当前课件任务受阻时补对应修复及证据，不外推全部 CLI 已修复。
- 任务预算及候选边界继续遵循[架构合同](../ARCHITECTURE_CONTRACT.md#7-原生cli编辑器连接暂存与会话边界)。后续长任务和恢复归 1.9，软件内全链条及三 CLI 核心课件场景验收归 2.0，具体范围见[开发计划](../AI_ASSISTANT_DELIVERY_PLAN.md#21-能力缺口的归期与验收判据)。
