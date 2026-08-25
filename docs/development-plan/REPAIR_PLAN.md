# 工程修复开发方案（2026-08-25）

> 方案日期：2026-08-25
> 分支：`codex/architecture-stabilization`
> 探索基线：`a7d11e9`（owner-waived engineering candidate 收口后，工作树干净）
> 范围：纯修复类工作——能力契约诚实性、语义健康检查 V9 化与 CLI 接线、examples 生成链、V8 内部投影层、工程卫生
> 边界：本方案**不含** skill 重构、黄金样例课例制作、真实课例生产、声明式数据条件/判题分支等新产品能力；这些由 Owner 另行启动。本方案不修改 V9 Schema、不创建 V10、不恢复 V8 `.h5lesson` 导入
> 状态声明：本文件只收录发现、处置方向、批次划分与准入边界，**不维护实现状态**。每项实际工作须按 Policy version 2 拆成任务卡写入 `docs/development-plan/tasks/**` 后由任务板承载状态

## 1. 结论先行

稳定化收官后，剩余的修复需求集中在五个域。当前最严重的不是编辑器行为缺陷（审计 29 项已终态处置），而是**面向外部 AI/无界面链路的契约诚实性回退**与**生成物治理缺陷**：

| 域 | 核心问题 | 严重度 | 全量估算 |
|---|---|---|---:|
| CAP 能力契约诚实性 | 能力索引声明 `project-health` 检查但 CLI 未执行；`documentation.authoring` 路由到自标"历史文档"的 V8 长文；`catalogStatus` 手写快照与生成物矛盾 | **P0**（外部 AI 被合同级假声明误导，W2"假绿"模式在契约层重演） | 0.5–1 人日（止损）|
| SEM 语义健康检查 V9 化 | `projectHealth.ts`（1216 行、47 码）与富 `exportPreflight.ts` 困在 V8 形状；GUI"工程检查"分析残缺投影（五个盲区）；V9 导出链对离线合规（外联网络）**零检查** | **P0**（安全性回退）+ **P1**（GUI 既有缺陷） | 20.5–31.5 人日（分 5 批）|
| EXA examples 生成链 | 三个示例课件全是 V8——当前编辑器打不开；`verify:release` 在 V9-only GUI 打开 V8 示例**必然失败**；`pretest:e2e` 无条件重写 13 个 tracked 文件（~4.7 MB） | **P0**（发布门禁常红 + 每次 E2E 弄脏工作树） | 6.7–7.2 人日 |
| PRJ V8 内部投影层 | 每命令 2–3 次冗余全量投影（文本输入每按键一次，估 15–60 ms/命令）；投影域校验缝隙 G-1～G-6 与 CTRL-05 同根因未闭合 | **P1**（性能税 + 回归温床） | 最小切片 4 人日；渐进退役另 24 人日（条件准入）|
| HYG 工程卫生 | Flow 拖选修复靠内联样式（回归风险）、8 处裸 `'未变化'` no-op、order 分配 O(n²)、6 分钟 Electron 用例混入 `npm test`、已退役门禁的本地残留、9 个死链转发 script | **P2** | ~2.6 人日 |

**推荐执行顺序**：第一波"契约与止血"（约 5.5–7 人日）→ 第二波"安全合规与性能"（约 8.5–9.5 人日）→ 第三波"语义主体"（约 7–10 人日）→ 第四波"合成与预检收口"（约 13.5–20 人日）→ 第五波"投影渐进退役"（条件准入）。四波合计约 34–47 人日；第五波按证据另行准入。

三个此前流传的判断在本轮探索中被**修正**，方案按修正后事实制定：

1. `verify-editor-preservation` 的 v8-only 保真门**不是"红着没人管"**——该脚本已于 2026-08-17 随 v8-base 树退役，不在任何活分支上；`logs/`、`output/editor-preservation/` 是孤儿残留，处置是清理与记录，不是修复。
2. `scripts/run-courseware-authoring.ts` **不是 V8 残骸**——它是纯 V9 读取器（对非 V9 归档显式抛错），是全仓唯一"外部 AI 在真实 Electron 里点选→编辑→保存→重开→导出四种交付物且字节可复现"的端到端证据链，必须保留；唯一问题是其 6 分钟 Electron 用例挂在 `npm test` 里。
3. examples 生成链**本来就是字节确定的**（mtime 固定、JSON 定序、vite 无 hash）——漂移不是熵，而是 pretest 无条件重写 tracked 文件把语义变更混进构建噪声，加上 3.86 MB 内嵌 player 的 HTML 把任何 player 源码改动放大成 86 行不可 review 的 diff（esbuild 全局标识符重命名）。

## 2. 探索方法与证据边界

- 三路并行源码勘察（语义诊断迁移可行性、examples 生成链全景、V8 投影消费者图谱），全部基于 `a7d11e9` 干净工作树；
- 关键论断做了独立复核：`examples/*.h5lesson` 解包确认 `schemaVersion: 8`；`validate-project.ts` 的 import 清单确认未引入 `collectProjectHealth`；`verify-editor-preservation.ts` 确认不在当前工作树；
- 字节漂移做了内存内 ZIP 条目级比对（`941e936` 前后 `.h5lesson` 唯一差异是 `defaultCollapsed: false → true` 一行）；
- 本轮未运行完整 `verify`、未打包、未修改任何产品源码；`verify:release` 的必败结论来自源码链路推导（`verify-release.ts:540-555` 打开 V8 示例 vs `courseProjectIo.ts:38-46` 拒绝非 V9），首张 EXA 任务卡应以一次真实运行留证。

## 3. CAP：能力契约诚实性

### CAP-01（P0）：`project-health` 假声明

`scripts/generate-ai-capabilities.ts:1067` 把 `'project-health'` 写入 `validation.checks`，但 `scripts/validate-project.ts` 从未 import `src/shared/projectHealth.ts`；其 `projectHealth` 字段（`validate-project.ts:670-703`）只由 V8 顶层字段、迁移标记、稳定 ID 重复、协议版本四类形式检查拼装。外部 Builder 被 skill 指向该 CLI 当唯一机器真相，"结构合法即绿"。

**准确定性**：V9 Zod schema 已承担旧分析器约 40% 的 error 级引用检查（见 SEM-B0 的 17 码清单），CLI 的 `schema.valid` 分支本就在跑，只是结果没有归入 projectHealth 通道。因此"CLI 完全没有语义检查"偏严，但契约声明与通道内容不符成立。

**处置（二选一，推荐 b）**：
- (a) 立即止损：把 `checks` 里的 `'project-health'` 改为 `'project-health-structural'` 之类的窄声明，附一行能力说明"语义分析仅 GUI 内可用"；0.25 人日。
- (b) 半真化 + 后续兑现：与 SEM-B0 同卡落地——把 schema issue 按 path 前缀映射进 projectHealth 通道后，声明即变真；1.5–2.5 人日（即 SEM-B0 本体）。

### CAP-02（P0，已于 2026-08-25 文档整合中完成）：`documentation.authoring` 路由到 V8 历史文档

`artifacts/ai-capabilities/index.json` 的 `documentation.authoring` 指向 `docs/AI_COURSEWARE_AUTHORING.md`——该文件头部自标"**状态：历史文档（2026-08-13），不是当前教师工作流**"，正文仍是 `schemaVersion: 8` 的最小结构。Builder 按索引路由会读到错误事实。`documentation.runtime`（`docs/RUNTIME_AUTHORING.md`）与 `documentation.component` 指向正常。

**处置**：改 `generate-ai-capabilities.ts` 中该字段指向当前有效入口（`.agents/skills/build-courseware-project/SKILL.md`，或后续新的 V9 authoring 事实文档）；同步重新生成能力产物。0.25 人日。

### CAP-03（P2，已于 2026-08-25 文档整合中完成）：`catalogStatus` 手写快照与生成物矛盾

`index.json` 当前为 `catalogStatus: "available"`，`.agents/skills/build-courseware-project/references/current-capabilities.md:46` 手写 `unavailable`。根因是模式性的：**手写文档不应断言可变的外部目录状态**。

**处置**：`current-capabilities.md` 该行改为"以 `index.json` 当前 `catalogStatus` 为准"，不再复制值。0.1 人日。（该文件属课件 skill 资产；本项只做单行事实纠偏，不进入 skill 重构范围。）

## 4. SEM：语义健康检查 V9 化与 CLI 接线

### 4.1 现状事实

- `src/shared/projectHealth.ts`（1216 行）输出 47 条 `project-health:*` 码（注册于 `src/shared/diagnosticCodes.ts:2-50`），输入是 **V8 `ProjectDocument`**；
- 富 `src/renderer/export/exportPreflight.ts` 承载文字/公式溢出、对比度、视觉密度、控制器遮挡、组件/运行时外联网络等 33 个 native 码，同样吃 V8 形状；
- V9 导出链 `src/renderer/export/course/buildCoursePackages.ts:28-37` 只有 4 个字节/哈希类码，**对离线交付合规（源码内 `fetch`/`XMLHttpRequest`/`WebSocket`/外链）零检查**——这是 V9 域最严重的实质性回退；
- GUI"工程检查"面板（`App.tsx:465-468`、`ProjectHealthPanel.tsx:57-68`）喂给分析器的是 **V9→V8 残缺投影**，五个盲区：
  1. `surfaceLayerItems` 完全不进投影（Slide 工程同样中招）；
  2. 多 surface 工程只分析当前 surface——面板错误数是"当前视图"属性而非工程属性；
  3. Flow/Spatial 会话投影硬编码 `interactions: []`（`editorStore.ts:1289`、`:1394`），全部 8 个交互语义码在这两种 surface 恒为零；
  4. 每场景只投影第一个 runtime（`editorStore.ts:605-627 attachProjectedRuntimes` 取 `firstRuntimeItem`），后续 runtime 的检查被静默丢弃；
  5. V9 独有结构（`locations`、`navigationGuards`、`courseState`、`flow.blocks`、`spatial.world` 等）100% 无语义检查。
- 另有重复计算缺陷：`collectProjectHealth` 在 `App.tsx:466` 与 `ProjectHealthPanel.tsx:60` 各算一遍。

### 4.2 47 码四分类（迁移依据）

- **(a) 纯 V8 语义、应显式弃用（2 码）**：`scene-required`（V9 的 Flow-only/Spatial-only 工程合法且零 scene，迁移会产生假阳性 error）、`global-visibility-scene-reference-missing`（V8 `sceneIds` 已升维为 V9 `locationIds`，语义被 `course-project-v9/schema.ts:1251-1256` 更严覆盖）。处置：移入新增 `RETIRED_PROJECT_HEALTH_CODES` 常量，`diagnostics.json` 区分 retired。
- **(b) V9 有直接对应、低成本迁移（22 码）**：交互语义 8 码（含 schema 未覆盖的 `presentation.set`/`scene.go.targetStateId` 状态引用、`scene.go` 场景引用、`animation.completed` 动作引用、控制器按钮跳转目标）、运行时与声音 3 码（含 V9 schema 真实漏洞：`media.audio.sounds` 缺 key===id 校验，迁移即修复）、组件包生命周期 4 码（`component-package-unused` 可复用 `buildPublishedCourse.ts` 的 `collectPublishedCourseComponentKeys`）、播控与控制器 6 码（V9 判定函数 `teacherControllerConsistency.ts:209 hasCourseDeliveryVisibleTeacherController` 已就绪）、素材 kind 匹配 1 码。
- **(c) 依赖有效合成，迁移需保确定性（6 码）**：`information-release-*` 2 码、`interaction-enter-target-initially-visible`、`video-click-interaction-conflict`、`looping-video-ended-unreachable`、`asset-reference-analysis-incomplete`。当前唯一 V9 合成实现在 renderer（`store/slideEditorProjection.ts:114-161`），CLI 不能 import——须新建 `src/shared/courseComposition.ts`，基于既有 `schema.ts:327 materializeNativeLayerItem` + `schema.ts:45 mergeCourseNativeData`，并以架构测试禁止其 import `src/renderer/**`。
- **(d) 已被 V9 schema/导出链覆盖、勿重写（17 码）**：`scene-id-duplicate`、`state-id-duplicate`、`interaction-navigation-not-terminal`、`interaction-node-reference-missing` 等。正确动作是在 `validate-project.ts:675-681` 追加 `schemaIssuesToHealthFindings()` 映射，把 Zod issue 按 path 前缀翻译成对应码——**这一步零新增语义逻辑，即可让 CAP-01 的声明变真**。

`exportPreflight.ts` 侧的形状无关纯函数可直接上移共享：`inspectSourceNetworkUse`（`exportPreflight.ts:127-159`，签名 `(source: string) => finding`，覆盖 4 个外联码）、颜色对比（`:74-106` → `src/shared/colorContrast.ts`）、几何（`:108-119` → `src/shared/geometry.ts`）；`analyzeTextNodeLayout`/`analyzeFormulaNodeLayout` 已在 `src/shared/`，其 `browser-canvas / deterministic-fallback` 双模式与降级（`exportPreflight.ts:371-383`、`layoutMeasure.ts:69-80`）机制已就绪，原样沿用。

### 4.3 路线裁决

- **路线 B（CLI 复用 V9→V8 投影喂旧分析器）明确否决**：CLI 会继承全部五个盲区，且 CLI 没有"当前 surface"概念、需人为选择，产出不确定；会把 `'project-health'` 从假声明变成更难发现的误导性声明（对 Flow/Spatial 恒返回空）。记录在案，防止后续被当"快赢"重提。
- **采用路线 C 起步、收敛到 A**：先抽形状无关纯函数（第一批零合成依赖、可独立回滚），最终新建 `src/shared/courseProjectHealth.ts` 由 GUI 与 CLI 共用；旧 `projectHealth.ts` 保留至 V8 链路退役（`scripts/build-incline-motion-lesson.ts:925-926` 仍消费它，该脚本按 EXA-05 退役后消费者进一步归零）。

### 4.4 批次划分与估算

| 批 | 内容 | 码位 | 合成依赖 | 估算（人日）|
|---|---|---|---|---:|
| **SEM-B0** | schema issue → projectHealth 通道映射；`diagnostics.json` 区分 retired 码；CAP-01 声明兑现 | (d) 17 码 + (a) 2 码弃用 | 无 | 1.5–2.5 |
| **SEM-B1** | 抽共享纯函数层（网络检查/对比度/几何）；接入 CLI 与 V9 导出链 `collectCoursePackageExportPreflight` | 4 个外联码等 | 无 | 2–3 |
| **SEM-B2** | 新建 `collectCourseProjectHealth` 骨架 + 全部零合成语义码，**以 CLI 接线为主战场**（Owner 裁决：工程检查主要服务 AI）；GUI 面板仅做防错误信息的最小数据源对接（−2 个投影 consumer），不投入可视化增强，`projectHealthNavigation.ts` 定位路由重写取消（原估 1–2 人日省去），面板简化或退役拆卡时单独确认 | (b) 22 码 | 无 | 5–7 |
| **SEM-B3** | 新建 `src/shared/courseComposition.ts`（V9 有效合成）+ 合成一致性契约测试（shared 合成 vs renderer 投影对同一夹具输出一致） | (c) 6 码 | 有 | 5–8 |
| **SEM-B4** | `exportPreflight` V9 化：节点级排版/对比度/画布几何按 surface 类型分派（画布几何仅 Slide 有意义；Flow 无画布、Spatial 世界语义不同）；`analyzeVisualDensity` V9 重写 | ~20 个 native 码 | 有 | 6–9 |
| 缓办 | `asset-unused` 完整引用图、`asset-reference-analysis-incomplete` 补全 | 2 码 | 有 | 不计 |

### 4.5 风险与验收规则

1. **诊断数量突增是预期行为，不是回归**：SEM-B2 后 Flow/Spatial 工程会从"0 问题"变为若干问题、多 surface 工程错误数上升。验收材料必须包含"迁移前后诊断数对照表"（一次性脚本 + 人工评审，不进 CI）。
2. **新码一律以 `warning` 落地**：`summarizeProjectHealth` 与 CLI 退出码都以 error 数为门禁，新增 error 级码可能让现有工程直接无法导出。提级为 error 是独立后续裁决，单独立卡。
3. **合成一致性是 SEM-B3 的硬门**：shared 合成与 Player/renderer 投影不一致的诊断比没有诊断更有害。
4. **报告兼容**：`ExportPreflightReport.schemaVersion` 已是 `8 | 9`；projectHealth 新结构需加版本字段，保证已落盘 JSON 报告可读。
5. 验证方式：纯函数用表驱动单测；(d) 映射对每码构造最小非法 V9 文档断言落点；(b) 每码 happy path + violation（基于 `tests/fixtures/course-project-v9/sources.ts` 构造，不必新增归档）；(c) 用现有 10 个 V9 夹具 + 稳定 JSON 快照（CLI 已有 `normalizeJson` 定序）；架构约束（shared 禁 import renderer）进 `tests/unit/architectureBaselineFixtures.test.ts`。

## 5. EXA：examples 生成链修复

### 5.1 现状事实

| 脚本 | 链路 | tracked 产物 | schemaVersion |
|---|---|---|---|
| `scripts/build-examples.ts` | **V8** | `sample-project.h5lesson`、`sample-counter.h5component`、`thumbnail.png`（回写源码目录） | 8 |
| `scripts/build-interactive-lesson.ts` | **V8** | `photosynthesis-interactive-lesson.h5lesson`、`photosynthesis-lab.h5component`、缩略图 | 8 |
| `scripts/build-render-host-benchmark.ts` | **V8** | 7 个文件，含 **3.86 MB** 内嵌 player 的 HTML、583 KB `project.json`、538 KB 现场构建的 three runtime | 8 |
| `scripts/build-component-catalog-matrix.ts` | **V9（已完成迁移，参考实现）** | 无（产物全部 ignored） | 9 |
| `scripts/build-incline-motion-lesson.ts` | **V8，孤儿**（无 npm script、无测试、无文档引用） | `incline-motion-3d-lesson.h5lesson` 等 | 8 |

关键事实：

- **`npm run verify:release` 当前必然失败**：`scripts/verify-release.ts:540-555` 在打包 GUI 里用 Ctrl+O 打开 `examples/sample-project.h5lesson`（V8），而 `courseProjectIo.ts:38-46` 对非 V9 直接拒绝。示例 V9 重建是修 bug，不是可选项。
- examples 换 V9 **不会破坏 V8 负向测试**：拒绝类测试全部在内存内合成 V8 归档（`tests/unit/projectFormatIsolation.test.ts:35-42`），不读 `examples/`。需要同步改的只有 render-host-benchmark 链的 3 处显式 V8 断言（`tests/integration/renderHostBenchmark.test.ts:175,312`、`scripts/verify-release.ts:846-880`）。
- 漂移根源不是熵：四个脚本 mtime 全部固定、JSON 由 schema 定序、sharp 本机字节稳定、vite 无 hash。真正的两个问题是 pretest 无条件重写 + 内嵌 player 的 diff 放大（esbuild 全局标识符重命名：player 依赖图任何一处变动即重排 1.85 MB bundle 的短名分配）。
- 跨机器残留风险：sharp 是平台预编译原生二进制，换机器/升级 libvips 会引发 `thumbnail.png → .h5component → .h5lesson` 三级连锁漂移——这是唯一"生成器把随环境变化的字节写进源码树"的位置。

### 5.2 tracked 策略裁决

- 选项"保持 tracked + 全字节确定"**否决**：player 侧任何改动都会重写 3.86 MB HTML，仓库已为此烧掉两张最终候选任务卡（`arch-5-final-06`、`arch-5-final-13`），成本被自身历史证伪。
- 选项"全部转 ignored + 按需生成"否决：README/USER_GUIDE/COMPONENT_AUTHORING 均承诺 `examples/` 为 checkout 即用资产，重伤新人上手。
- **采用：tracked + pretest 不再重写 + 显式 `refresh:examples` / `check:examples`（`--check` 模式照抄 `scripts/generate-contracts.ts:152-203`）**，并对 render-host-benchmark 的三个巨型产物（HTML/`project.json`/three runtime）**局部转 ignored**、测试改读 pretest 现生成路径。tracked 只留"小而语义稳定"的 `.h5lesson`/`.h5component`/`thumbnail.png`（合计约 250 KB），其漂移必然是语义漂移、值得一次 review。

### 5.3 分项处置

| 项 | 处置 | 估算（人日）|
|---|---|---:|
| **EXA-01（P0）** `build-examples.ts` → V9 工厂/归档（`createBlankCourseProject` 签名与 V8 等价、`sceneNodeToCourseLayerItem` 桥接、`createCourseProjectArchive`；参考 `build-component-catalog-matrix.ts:205-286`）；同步修 `verify-release.ts` 改用 `openDefaultCourseProject` | V9 重建 | 1.0 |
| **EXA-02（P0）** `pretest:e2e` 拆分：去掉 `build:examples`；新增 `refresh:examples` / `check:examples`，CI 跑 check、语义 diff 要求显式刷新 | 生成物治理 | 1.0 |
| **EXA-03（P0）** render-host-benchmark 三个巨型产物转 ignored，`renderHostBenchmark.test.ts` 与 E2E 改读现生成路径 | diff 放大器解绑 | 0.5 |
| **EXA-04（P1）** `build-interactive-lesson.ts` → V9 + Published Course V2（`buildPublishedCourseStandaloneHtml`，`__H5_COURSE_PAYLOAD__`）；改写 `tests/e2e/editor.spec.ts:3251-3305` 的宿主选择器 | 旗舰示例 V9 化 | 1.0 |
| **EXA-05（P1，Owner 已裁决删除，2026-08-25）** incline-motion 链退役删除（脚本 971 行 + 2 个产物 + 组件源码目录），同步 `legacy-consumers.json` 消费者减项。Owner 明确：现有课例/示例均为测试用途，无保存必要，不做任何内容迁移 | 孤儿清退 | 0.2 |
| **EXA-06（P2）** render-host-benchmark V9 + Published V2 重建（142 行手写 V8 字面量重写为 V9 形状；场景 runtime → `RuntimeLayerItem` 语义映射；两个测试文件重写） | 基准页现代化 | 2.5–3.0 |
| 收尾 | `.gitignore`、README/USER_GUIDE/COMPONENT_AUTHORING/RUNTIME_AUTHORING 引用同步、能力产物与 repo-index 重生成 | | 0.5 |
| 附带小项 | `build-component-catalog-matrix.ts:205` 补显式 `idFactory`（消除 nanoid 潜在随机）；`thumbnail.png` 改为 tracked 源资产 + check 校验（消除 sharp 跨机熵） | | 0.1 |

**明确否决的便宜路径**：保留 V8 编写代码、末尾调 `migrateProjectV8ToCourseProjectV9` 兜底——该符号是登记在案的技术债（白名单仅 `editorStore.ts` 与 `courseProjectModel.ts`），此路会让 V8 链路继续存活。

## 6. PRJ：V8 内部投影层——性能修复与渐进退役

### 6.1 现状事实

三个投影函数 `derivedV8ProjectFromBackend`（`editorStore.ts:1184`）、`derivedV8ProjectFromSpatial`（`:1249`）、`derivedV8ProjectFromFlow`（`:1357`）把 V9 文档投影成 V8 形状供旧 UI 消费。实测修正两点：不是"每次 set 全量重算"，而是 **14 个写入点覆盖了三大命令汇聚点**（`persistCandidateResult`/`persistSpatialResult`/`persistFlowResult`，合计 93 个调用，含纯选择变更）以及**文本输入每按键路径**（`updateTextEditDraft`，`:6360-6393`）；且存在成倍冗余——同一 set 内 `buildSlideCandidateUi` ×2、`buildSpatialEditorView` ×3、`flowEffectiveLayers` ×3，另有 `attachProjectedRuntimes` 的 O(scenes²×surfaces) 查找。外推中等工程（30 场景×30 节点）每命令 15–60 ms，直接构成输入延迟。

三个"死参数"实证（缓存可行性的基础）：`derivedV8ProjectFromBackend` 实际是 `(document, surfaceId) → ProjectDocument` 纯函数（`sidecar`/`edit` 参数被丢弃）；Spatial/Flow 版的 `sidecar` 以 `...(sidecar ? {} : {})` 恒空展开（`:1298`、`:1403`）。

**投影域校验缝隙（CTRL-05 的同根因剩余温床）**——强校验只有一条边 `src/player/payload.ts:22-28`，且只被 Slide 编辑态 Runtime 预览 iframe 触碰（`Workspace.tsx:2210-2232`）；统一画布试运行与四格式导出主路径均为纯 V9。缝隙按风险排序：

| 缝 | 内容 | 触发面 |
|---|---|---|
| G-1（高） | "只在 Flow/Spatial 位置可见"的全局控制器：投影 `locationIdsToSceneIds` 只映射 `slide-scene`（`editorStore.ts:826-834`），其余位置丢弃 → `sceneIds: []` → V8 `projectSchema.ts:854-860` 拒绝 | 在 Flow/Spatial 做合法编辑 → 切回 Slide → 编辑态预览起不来 |
| G-2（高） | 命名状态 override 引用投影后消失的节点（runtime 图层项被 `slideEditorProjection.ts:69-71` 丢弃，但 `:147-152` 全量搬运 overrides）→ V8 `nodeOverrides` 校验拒绝 | V9 命名状态对 runtime 项写 `{visible:false}`（V9 合法） |
| G-3（中） | 上限不对等：V9 场景/图层项/状态上限（10000/20000/1000）远宽于 V8（1000/1000/100），导入或外部工具产出的合法 V9 可越过 | 大工程 |
| G-4（中） | 缺 slide location 的场景被静默丢弃，可致 `scenes: []` → V8 `min(1)` 拒绝；多 Slide 表面工程只投影当前表面 | 结构编辑 |
| G-5（低） | `runtimeApiVersion: 2` 与 `layer: 'overlay'` 写死（`:582`、`:594`），API 3 / underlay 被静默降级 | Runtime 预览 |
| G-6（低） | V9 独有字段静默丢弃清单（underlay/overlay 区分、Flow 背景色写死等） | 投影不可当真相 |

### 6.2 处置

**PRJ-00（最小切片，第一优先）**：
- P-0 删丢弃计算：`editorStore.ts:1189` 的 `candidateViewState` 换成 `buildSlideCandidateUi`，省掉每次被丢弃的全文档 `projectEffectiveLayers`（0.5 人日，纯删除）；
- P-1 拆包装器重复调用：`spatialViewState`/`flowViewState`/`persistCandidateResult` 内复用同一次计算，×3→×1（1 人日）；
- P-2 身份级 memoize：**禁止用 `revision` 数值作缓存键**（撤销会回落复用，`editorStore.ts:3284-3285` 注释已言明），以 `session.history.present` **对象引用**为键做 size-1 缓存；纯选择命令不换文档引用，天然实现"选择变更不重投影"；引用稳定还使 8 个 `state.project` 订阅者在选择变更时不再重渲染（1.5 人日）；
- Spatial 按键路径对齐：`updateTextEditDraft` 的 Spatial 分支 draft 期间不刷新 `state.project`（0.5 人日）。
合计 **3.5 人日，预期 Slide 路径 −50%、Spatial/Flow 路径 −65% 投影成本**，不迁移任何消费者。风险控制：确认无 `state.project` 原地写入者（legacy-consumers 清单 LEG-001 已记 `persistedCompatibility: none-confirmed`）；P-2 后跑全量 `npm test` 确认无依赖"每次新对象"的断言。

**PRJ-01（G 缝隙统一封堵，0.5 人日）**：不逐条修投影，在 `Workspace.tsx:2210` 之前对投影结果做一次 `projectDocumentSchema.safeParse`，失败时降级为"该页编辑态预览暂不可用 + 具体原因"，不再把无效 payload 塞进 iframe 报通用错误。把温床从"可产生不可恢复状态"降为"有明确提示的降级状态"。G-1～G-6 的逐条根治随渐进退役批次自然消亡，不单独立卡。

**PRJ-02～05（渐进退役，条件准入）**：
- 批 1 浅字段消费者 → 窄 selector（`TopToolbar`/`SceneThumbnail`/`ElementsTab`/`DeveloperTab` + 两个 selector 的 fallback 删除；收益最高单点是列表中 N 实例的 `SceneThumbnail`）：2 人日；
- 批 2 分析器 V9 入口（`collectProjectDiagnostics`/`collectComponentPackageUsage`，做完 `AutomationTab` 完全脱离 V8）：3 人日；
- 批 3 Slide 编辑 ViewModel（`src/renderer/course/read-model/`，迁 `PropertiesTab`/`InteractionEditor`；注意 `slideInteractionView.ts` **已经输入全 V9、只是输出 V8 形状**，属"升格返回类型"而非迁移）：8 人日；
- 批 4 `Workspace` 与编辑态 Runtime 预览管线归属（LEG-002，方案 A 编辑态也走 `mountPublishedCourseTryRun` / 方案 B iframe 改喂 Published V2 payload——**Owner 裁决点**）；做完 `payload.ts:23` 的 V8 边界随之消失，全部 G 缝隙一次性关闭：10 人日。
- 依赖棘轮：复用现成 `tests/unit/architectureDependencyRatchet.test.ts` 基建（仓库无 eslint，不新建），新增"`state.project` 消费者精确白名单，每批只减不增"断言；每批 0.25 人日。

**建议永不迁移、随功能自然消亡**：`projectArchive.ts` 全家（LEG-008 retained-compatibility）、`tests/helpers/projectV8.ts`（LEG-009）、`migrateProjectV8ToCourseProjectV9`（唯一正当的 V8 schema 消费者）、`App.tsx:1386-1397` PDF source-null 分支（LEG-003 可达性未证明，随其证明一起删）。

## 7. HYG：工程卫生小项

| 项 | 事实 | 处置 | 估算（人日）|
|---|---|---|---:|
| **HYG-01（回归风险）** | Flow 拖选修复是全仓唯一用内联样式承载的 `user-select`（`FlowWorkspace.tsx:223-224`），`.flow-inline-editor` 在样式表零规则；`globals.css` 已有 6 处同类修复全部走 CSS | 下沉为 CSS 规则，对齐既有先例；保留 E2E 真实拖选断言 | 0.25 |
| **HYG-02** | 8 处裸 `'未变化'` no-op（`effectiveLayerCommands.ts:547/561/620/645`、`globalLayerCommands.ts:162/635`、`flowSharedAuthoringAdapters.ts:1013/1189`），"值未变"与"字段未接线"不可区分——审计"静默 no-op"P1 在命令层的同构残留 | 逐处改为具体原因（如"图层顺序未变化"）；确属未接线的改 `ok: false` + 字段名 | 0.5 |
| **HYG-03** | `allocateCourseLayerOrder`（`globalLayerCommands.ts:362-373`）每次全量重建 used-Set + 线性探测；批量粘贴（`spatialClipboardCommands.ts:611`）逐个调用，O(n²) | 为批量场景提供一次性分配器（复用 used Set + 游标），单次路径不动 | 0.5 |
| **HYG-04（已于 2026-08-25 文档整合中完成）** | `package.json` 里 9 个 `--prefix ../courseware-cases` 转发 script，目标仓库本机缺失。README"历史课例边界"记录的 W1-0"核心仓只保留转发命令"决定**已由 Owner 显式推翻**：既有课例开发无保存必要 | 已删除 9 个转发 script 与 README"历史课例边界"段（原文由 Git 历史保留） | 0.2 |
| **HYG-05** | `verify-editor-preservation` 已于 2026-08-17 随 v8-base 树退役（不在任何活分支），`output/editor-preservation/`（94 KB report + 6 张 PNG，未被 git 跟踪）与 `logs/z1-*.log` 是孤儿残留；最后一份留档报告状态为 PASS | 清理本地残留；在方案/计划中一句话记录"该门禁已退役，替代者为 `tests/e2e/stabilization*.spec.ts`"；**不修复、不复活** | 0.25 |
| **HYG-06** | `tests/unit/coursewareAuthoringRunner.test.ts` 第 3 个用例真实启动 Electron 两次（timeout 360s、`skipIf(!existsSync('dist-renderer/index.html'))`），挂在 `npm test`——"单测通过"信号在有/无构建产物机器上语义不同，受限环境必失败 | 拆分：①②纯函数用例留 unit；③移至 `tests/e2e/`（`pretest:e2e` 已负责构建产物）。**脚本本体 `run-courseware-authoring.ts` 保留不动**——它是纯 V9 的端到端交付验证器，`--verify-report` 防伪复核入口不得移除 | 1.0 |

## 8. 执行顺序与依赖

```text
第一波 契约与止血（约 5.5–7 人日）
  CAP-01(=SEM-B0) + CAP-02 + CAP-03 ∥ EXA-01 + EXA-02 + EXA-03 ∥ HYG-01 + HYG-04（已裁决删除）
  出口：能力索引无假声明；pretest 不再弄脏工作树；verify:release 打开示例不再必败；死链转发命令清退

第二波 安全合规与性能（约 8.5–9.5 人日）
  SEM-B1（离线合规接入 CLI 与 V9 导出链）∥ PRJ-00 + PRJ-01 ∥ HYG-05 + HYG-06 ∥ EXA-04 + EXA-05（已裁决删除）
  出口：V9 交付链有外联网络门禁；命令延迟下降 50–65%；G 缝隙用户可见后果被封堵

第三波 语义主体（约 7–10 人日）
  SEM-B2（22 码 + CLI 主接线 + GUI 最小 V9 数据源对接）∥ HYG-02 + HYG-03
  出口：CLI 接入全部零合成语义码；GUI 不再读取残缺的当前 Surface 投影，但不扩建定位路由或可视化能力

第四波 合成与预检收口（约 13.5–20 人日）
  SEM-B3（共享合成层 + 契约测试）→ SEM-B4（预检 V9 化）∥ EXA-06
  出口：validate:project 对四分类码全量接线；exportPreflight 按 surface 分派

第五波 投影渐进退役（条件准入，约 24 人日）
  PRJ-02 → PRJ-03 → PRJ-04 → PRJ-05（批 4 需 Owner 先裁决预览管线归属）
  出口：payload.ts V8 边界消失，G 缝隙根治；每批棘轮收紧
```

热点约束沿用现行规则：`editorStore.ts`（PRJ-00、SEM-B2 的 GUI 切换）与 `Workspace.tsx`（PRJ-01、PRJ-05）各自单写入者串行；contracts 目录全程只读（本方案无任何 Schema 变更）；`generate-ai-capabilities.ts` 与生成物由单一执行者一次性重生成。

## 9. 验证策略

沿用计划 13.x 的最小充分验证纪律，不新建验证平台：

- 每张卡 1–3 个 focused 检查；只有自动化不能直接观察结果时补一个最小真实行为；
- 本方案特有的真实行为门：EXA-01 完成后跑一次真实 `verify:release` 的"GUI 打开示例"段留证；SEM-B2 完成后用 `mixed.h5lesson` 夹具对比迁移前后诊断清单（预期管理表）；PRJ-00 完成后以 `ARCH_0_PERFORMANCE.md` 同方法采一组命令延迟对照（同机、同夹具）；
- 连续两次 `pretest:e2e` 后 `git status --porcelain` 必须为空——作为 EXA-02/03 的验收断言并写成检查脚本；
- 全量 `verify`、打包与性能测量仍只在阶段门或下一次固定最终候选运行。

## 10. 不应采取的路线

- 不要让 CLI 复用 V9→V8 投影喂旧分析器（SEM 路线 B，已否决并记录理由）。
- 不要追求"tracked 生成物 + 全字节确定"（EXA 选项 b，已被 `arch-5-final-06/13` 两张候选卡的历史成本证伪）。
- 不要用 `revision` 数值做投影缓存键（撤销回落复用；用 `history.present` 对象身份）。
- 不要用 `migrateProjectV8ToCourseProjectV9` 给 examples 生成器兜底续命 V8 编写路径。
- 不要复活 `verify-editor-preservation`（基线是 V8-only 入口时代的 DOM，与三 Surface 布局无可比性）。
- 不要新建 eslint、图数据库或第二套依赖检查——棘轮走现成 `architectureDependencyRatchet.test.ts`。
- 不要在缺少真实行为或 consumer 证据时大拆 `editorStore.ts`/`Workspace.tsx`/`PropertiesTab.tsx`（沿用计划禁令；PRJ 渐进批以消费者迁移为单位，不以文件拆分为单位）。
- 不要让新增语义码直接以 error 落地阻断导出；提级单独裁决。
- 不要把本方案范围外的能力（行内公式、数据条件、skill 重构）夹带进任何修复卡。

## 11. Owner 裁决记录与剩余裁决点

已裁决（2026-08-25，"应删尽删"）：

1. **EXA-05**：incline-motion 孤儿链退役删除。既有课例/示例均为测试用途，无保存必要，不做内容迁移。
2. **HYG-04**：courseware-cases 9 个转发 script 删除，W1-0"核心仓保留转发命令"决定被显式推翻；README"历史课例边界"段同步删除或缩为一句历史说明。

3. **CAP-01 修法（Owner 已确认，2026-08-25）**：不走"只改说明书措辞"的窄止损，直接在第一波以 SEM-B0 兑现——把 V9 schema 已经在做的 17 项检查结果接进 projectHealth 报告通道，声明随之变真且校验器真实变强。
4. **PRJ-05 前置——编辑态预览管线归属（Owner 已裁决选方案 A，2026-08-25）**：编辑态预览与"当前位置试运行"合并为同一套 V9 Published 宿主，编辑态增量更新协议（PlayerAuthoringPatch）移植到 Published Host。该选择保持并巩固 Runtime 级原位编辑路线：编辑态即真实 Player 合成画面，Runtime Authoring 协议（`ctx.authoring.register()` / `data-courseware-edit-key` 命中区）在唯一宿主上继续工作。注意边界：A 是管线统一，不自动引入"播放中任意瞬间捕捉状态编辑"的新能力；该类能力若需要，另行走产品准入。
5. **工程检查的消费重心（Owner 已裁决，2026-08-25）**：本产品是 AI-native 编辑器，工程/语义检查的主要消费者是 AI（CLI 与无界面链路），不是人类可视化面板。SEM-B2 范围相应调整：`collectCourseProjectHealth` 以 CLI 接线为主战场；GUI"工程检查"面板不再投入可视化增强——仅做防错误信息的最小数据源对接，`projectHealthNavigation` 定位路由重写（原估 1–2 人日）取消，面板的进一步简化或退役在拆卡时按"已有能力处置"单独确认。

默认策略（Owner 无异议即按此执行）：

6. **SEM 提级节奏**：新增语义检查一律先以 warning 上线（只提醒、不阻断导出），运行一段时间确认无误报后，再单独裁决哪些升为 error（阻断导出）；避免"昨天还能导出的工程今天突然被阻断"。
