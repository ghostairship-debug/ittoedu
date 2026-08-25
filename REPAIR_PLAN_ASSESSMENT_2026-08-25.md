# REPAIR 任务评估报告

- 评估日期：2026-08-25
- 评估对象：[`docs/development-plan/REPAIR_PLAN.md`](docs/development-plan/REPAIR_PLAN.md)
- 产品源码基线：`a7d11e9`
- 文档快照：2026-08-25 整合后的 REPAIR 计划
- 评估方式：源码、Schema、真实 consumer、测试与交付脚本只读交叉核对
- 最终结论：**不通过执行准入，必须先重写计划再派工**
- 结果等级：`discovery candidate`，不是 `implementation candidate`

## 1. 执行摘要

REPAIR 计划识别出的主要问题域大体成立：Project Health 语义不足、V8 投影仍被编辑器消费、示例与发布门仍依赖 V8、若干投影存在重复计算。这些方向值得继续处理。

但当前计划还不能直接进入实现，原因不是文档措辞，而是任务本体存在以下问题：

1. 一条 P0 路线按现有控制流不可达；
2. 一条性能方案的缓存键会跨表面或位置复用错误结果；
3. PRJ-05 的宿主统一方案遗漏作者代码与 `desktopAPI` 的执行隔离；
4. 多个真实用户行为缺陷未进入计划；
5. EXA 任务低估了 V8 行为 oracle 和 CI consumer 的迁移范围；
6. SEM-B4、PRJ-04、PRJ-05 等批次大于 Policy v2 可审阅任务边界；
7. HYG 中混入没有用户风险、没有复现或仅属于本机清理的项目。

因此，当前计划适合作为问题发现底稿，不适合作为 Integrator 直接派工的执行计划。

## 2. 准入判断

| 维度 | 判断 | 说明 |
|---|---|---|
| 问题域覆盖 | 基本通过 | SEM、EXA、PRJ 三个主要问题域真实存在 |
| 源码事实准确性 | 部分通过 | 多处把有损 bridge 当成事实源，或把不可达分支当成真实能力 |
| 用户风险优先级 | 不通过 | 漏掉执行隔离和直接用户行为 bug，同时抬高若干静态诊断与 hygiene 项 |
| 任务边界 | 不通过 | 多张候选任务包含多个用户行为、多个 owner 和多个验证上限 |
| 依赖闭环 | 不通过 | B0、B2、B3、GUI、EXA 与 PRJ-05 的前置合同没有闭合 |
| 估算可信度 | 不通过 | 多个估算遗漏真实 consumer、行为 oracle 或协议设计 |
| 验证设计 | 部分通过 | 有 focused test 方向，但部分出口无法证明计划宣称的用户结果 |
| 可直接派工 | **不通过** | 应先修计划、建立基线和首波任务卡 |

## 3. 阻断级发现

### F-01：Published 作者代码执行隔离被遗漏

**等级：P0 / S2 安全架构阻断**

当前编辑预览使用 `sandbox="allow-scripts"` 的 opaque-origin iframe，但 Published try-run 直接挂载到编辑器主 renderer：

- [`src/renderer/ui/Workspace.tsx`](src/renderer/ui/Workspace.tsx)
- [`src/renderer/ui/coursePlayerTryRun.ts`](src/renderer/ui/coursePlayerTryRun.ts)

Runtime 与 Component 会通过 `new Function` 执行作者提供的代码：

- [`src/player/RuntimeRegistry.ts`](src/player/RuntimeRegistry.ts)
- [`src/player/ComponentRegistry.ts`](src/player/ComponentRegistry.ts)

同一编辑器 renderer 又通过 preload 暴露保存、打开、导出与恢复等 `desktopAPI`：

- [`src/preload/index.ts`](src/preload/index.ts)
- [`src/shared/ipcTypes.ts`](src/shared/ipcTypes.ts)

这意味着当前 try-run 已存在同 renderer 暴露面；若按 PRJ-05 方案 A 将 Published host 直接扩为常驻编辑宿主，会进一步扩大触发面。

必须先完成：

1. 把 Published try-run/authoring host 放进无 preload、无 `desktopAPI` 的独立 sandbox；
2. 定义窄的 V9 authoring target/patch 协议；
3. 使用 `CourseAuthoringScopeToken + authoringAddress` 定位修改目标；
4. 验证作者代码看不到 `desktopAPI` 且不能调用主 renderer IPC；
5. 完成隔离后再讨论宿主统一。

本发现来自源码执行路径推断；出于数据安全，没有运行破坏性 exploit。

### F-02：CAP-01 / SEM-B0 实现路径不可达

**等级：P0 / 诚实性与报告合同阻断**

[`scripts/validate-project.ts`](scripts/validate-project.ts) 在调用归档 opener 时已经执行严格 Schema 与归档检查：

- Schema-invalid 工程会提前返回 `status: unreadable`；
- 此时 `projectHealth` 为 `null`，CLI 退出码为 2；
- 能进入成功分支的工程必然已经 Schema-valid，此时 `schema.issues` 必为空。

所以计划提出的“在成功分支追加 `schemaIssuesToHealthFindings`，零新语义逻辑映射 17 个 code”不会产生有效 Project Health 结果。

而且 Schema 内部交互校验会把多个内部问题折叠为顶层 `custom` issue，只留下粗粒度数组 path 和 message。仅靠 path 无法稳定恢复 `ruleId`、`actionId` 或具体诊断码。

正确前置应是：

1. 立即把能力声明收窄为 `project-health-structural` 或 `schema-and-structural-health`；
2. 明确 Schema-invalid 属于 unreadable/exit 2，还是 diagnosed error/exit 1；
3. 若改变公共 JSON 语义，升级外层 `reportVersion`；
4. 建立 Schema rule-code ledger；
5. 再决定是否需要把 Schema issues 投影到统一诊断通道。

### F-03：AI consumer 缺少稳定 Diagnostic Target

**等级：P0 / B2 前置合同**

当前 `CourseProjectValidationFinding` 主要只有 `path`、`surfaceId`、`layerItemId`，而多数 producer 并不填稳定定位字段。数组下标 path 在重排后失效，无法支撑 AI 确定性修复。

V9 诊断至少需要一个版本化 target union，按诊断域携带：

- `locationId`
- `surfaceId` / `surfaceType`
- `owner`
- `sceneId` / `stateId`
- `blockId` / `cameraFrameId`
- `ruleId` / `actionId`
- `assetId` / `packageId` / `soundId`
- `authoringAddress`
- `field`
- `projectRevision` 或等价的 stale guard

Schema-invalid 情况只能保留 raw path 与 stable rule code，并明确 target 是 best-effort；Schema-valid 的语义诊断必须优先使用 ID-based target。

### F-04：PRJ-00 memoization 键设计不成立

**等级：P1 / 数据一致性风险**

仅按 `history.present` 对象身份缓存不足以描述投影输入：

- Slide 还依赖当前 `surfaceId`；
- Spatial 依赖 location、surface、scope 和 edit draft；
- Flow 依赖 location 与 authoring scope；
- 同一 document 可在不同合法 context 下产生不同结果。

建议拆为：

- `PRJ-00A`：删除或复用已确认的重复计算，纯机械切片；
- `PRJ-00B`：context-aware size-1 cache，加多 Slide surface、Flow/Spatial location/scope、Spatial draft 特征测试。

现有性能基线只覆盖小夹具的 transform/undo/redo，没有投影专项 15–60ms 或 50–65% 数据。计划中的数字只能作为待测目标，不能作为既有证据。

## 4. 计划遗漏的真实修复项

| 建议任务 | 风险 | 真实行为 | 建议验证 |
|---|---|---|---|
| SEC-01 Published 作者代码隔离 | P0 / S2 | 作者 Runtime/Component 与主 renderer `desktopAPI` 同处一个执行上下文 | 无 preload host；作者代码不可见 `desktopAPI`；IPC 拒绝测试 |
| UI-01 Slide surface owner 选择 | P0 / S1 | 选择 `surfaceLayerItems` 后被强制切成 scene scope，Properties/canvas 丢失目标 | NodesTab → Properties/canvas 同一 `authoringAddress`；一次 canonical 写入；undo/save-reopen |
| EXP-01 preflight/producer parity | P1 / S1 | preflight 对缺资产元数据静默跳过，producer 随后抛错，形成 `canExport=true` 假绿 | `canExport=true` 后 builder 不因确定性源/资源前提失败 |
| CMP-01 Flow/Spatial 组件删除 | P1 / S1 | 删除走刻意 no-op commit，却提示“已删除”并返回 true | 全工程 V9 usage guard；Flow/Spatial 删除；undo/save-reopen |
| NAV-01 location-addressed Slide 导航 | P2 / S1 | 两个 Slide surface 合法复用 `sceneId` 时，总是选择第一个 surface | 两个 location 同 sceneId；按 locationId 激活正确 surface |
| PKG-01 asset-rich package closure | P2 / S1 | 现有 web package 测试没有 project assets/components | data URL、相对 URL、bytes/MIME、未引用排除、组件资产闭包 |
| PUB-01 Published consumer parse | P2 / S1 | producer 会 parse，Player consumer 入口只 clone | 手改或第三方坏 payload 在 consumer 边界明确失败 |

### 4.1 Slide surface owner 缺陷

统一图层投影能够正确产生 `owner: surface`，`CourseAuthoringScopeToken` 与 `authoringAddress` 也已经存在；但 [`src/renderer/store/editorStore.ts`](src/renderer/store/editorStore.ts) 的 Slide 选择路径把所有非 global owner 折叠为 scene。

结果是 NodesTab 能显示 surface shared row，点击后该 item 却从当前 editing nodes 消失，Properties 与 canvas 无法解析目标。这是直接用户行为 bug，优先级高于 CSS hygiene 和无基准的批量排序优化。

### 4.2 Flow/Spatial 组件删除假成功

组件删除仍使用 V8 usage 视图判断引用；非 Slide 分支随后执行 no-op commit，但界面仍报告成功。现有测试主要覆盖默认 Slide，没有覆盖 Flow/Spatial 的删除、撤销与重开。

### 4.3 Package preflight 假绿

[`src/renderer/export/course/buildCoursePackages.ts`](src/renderer/export/course/buildCoursePackages.ts) 在缺少资产元数据时会继续执行；[`src/renderer/export/course/buildPublishedCourse.ts`](src/renderer/export/course/buildPublishedCourse.ts) 则会对缺元数据、缺 bytes、长度不一致和 Component identity/asset closure 抛错。

应建立不变量：对静态可判定的源与资源前置条件，preflight 的 `canExport=true` 必须意味着 builder 不再因此失败。

## 5. 各候选任务处置

| 候选项 | 处置 | 主要修订 |
|---|---|---|
| CAP-01 | 重写 | 收窄能力声明；区分代码存在与运行时可达能力 |
| SEM-B0 | 重开 Owner 决策 | 先定 report/exit code/rule-code ledger，不能在成功分支直接映射 |
| SEM-B1 | 保留但降级、缩窄 | 改为 P1 静态源码政策诊断；只抽网络 checker；HTTP 与 WebSocket 分别验证 |
| SEM-B2 | 拆分 | 先 Diagnostic Target，再按 Runtime、Interaction、Component、Controller/Media 拆卡 |
| SEM-B3 | 保留但重写 oracle | 不能以有损 V9→V8 bridge 为事实源；需 authoring projection、shared materialization、Published Player 三方对拍 |
| SEM-B4 | 大幅拆分 | 先做有既有证据的 Slide parity；Flow/Spatial 新启发式等待复现后准入 |
| EXA-01 | 保留并扩范围 | 不只是换 V9 opener；需重写 controller、DOM、navigation 与 Published V2 verifier；估算 2–4 日 |
| EXA-02 | 保留并补 CI consumer | 增加 workflow output、path scope、job 与 required-check 考量；check 应在 temp/in-memory 比较 |
| EXA-03 | 重写 | 现有 ignore 方案会破坏 fresh checkout `npm test`；生成到临时目录或只忽略真正 build output |
| EXA-04 | 保留并重估 | 旧测试依赖 V8 canvas、global 与导航 helper，必须重写行为 oracle；估算 1.5–3 日 |
| EXA-05 | 可执行但降为 P2 | 删除已确认 orphan；属于清理，不是发布功能修复 |
| EXA-06 | 保留并补 consumer | 除两份测试，还必须迁移 `verify-release.ts` 的 V8 schema/runtime/CSP 断言 |
| PRJ-00 | 拆成 A/B | 先安全去重，后 context-aware cache；先测量再声称收益 |
| PRJ-01 | 收窄 | `safeParse` 只覆盖非法 V8 形状 G1–G3；G5/G6 是合法但有损投影，无法被 parse 发现 |
| PRJ-02 | 拆分 | 直接 UI consumer 当前为 10 个；`SceneThumbnail` 不是浅 selector，应单拆 |
| PRJ-03 | 补 consumer 与 owner | 加入 `ComponentsTab`；先建设共享 V9 component usage collector，避免重复实现 |
| PRJ-04 | 拆成多个用户行为 | 至少拆全课设置、canonical layer 属性、Interaction UI 复用/退役 |
| PRJ-05 | 停止按现方案施工 | Owner A 只决定方向，不等于协议与安全宿主已经设计；先做隔离和 V9 authoring protocol |
| HYG-01 | 删除，除非出现复现 | inline `userSelect` 本身不是用户缺陷 |
| HYG-02 | 删除 blanket 任务 | “未变化”分支多数是合法 unchanged guard；只修可复现的虚假成功 |
| HYG-03 | 先 characterization | O(k*n)/O(n²) 事实存在，但无用户阈值或 benchmark，不应直接实现 |
| HYG-04 | 视为整合治理项 | 只在绑定新的 product commit 后复用证据，不作为独立产品修复 |
| HYG-05 | 从路线移除 | 属于本机 ignored output/log 清理，且是破坏性操作，不计入产品人日 |
| HYG-06 | 保留 | 把真实 Electron 双启动测试迁入 E2E，unit 保留纯函数测试 |

## 6. 关键事实修正

### 6.1 “V9 离线安全零防护”不准确

当前导出与预览已有多层运行时保护：

- web package CSP；
- single HTML CSP；
- Electron preview session 的 HTTP/HTTPS/WS/WSS 阻断；
- file:// 真实浏览器 smoke。

真实缺口是 V9 package preflight 缺少与 V8 一致的静态源码诊断，以及某些 authoring/try-run 执行上下文的隔离问题。静态正则扫描只能作为政策诊断，不能宣称为离线安全证明。

### 6.2 `slideEditorProjection` 不是唯一 V9 合成事实源

它是有损的 V9→V8 bridge，会丢失部分 Runtime 与共享 ownership。真实合成逻辑同时存在于：

- authoring effective layer projection；
- renderer Slide view；
- Published Player Slide adapter；
- shared Schema/materialization primitives。

新建仅供 CLI diagnostics 使用的第四套 `courseComposition` 会增加事实源。若要抽 shared composition，必须迁移至少一个真实 renderer/Player consumer，并建立 base/named state、Native/Runtime/Component、visible/order/props 的三方合同测试。

### 6.3 Flow/Spatial interaction 盲区描述不准确

Flow/Spatial Schema 本来没有 local interactions，只有 Slide scene interactions 与 project `globalInteractions`。旧 V8 analyzer 对 synthetic scene 与 projected globals 的处理可能同时造成漏诊和假阳性，因此迁移后的诊断数量不保证只上升。

验收应比较每个 code 的 `added / removed / changed`，而不是使用“总数只会上升”的假设。

### 6.4 “V9 独有结构 100% 无检查”过度陈述

Schema 已覆盖 locations、courseState、navigationGuards、Flow block 引用、Spatial world/path/relation/semanticZoom、surface/asset/component 引用。真实缺口是 post-load Project Health、启发式 warning、Runtime/Component 生命周期和交付 preflight，不应重写 Schema 已经保证的结构完整性。

## 7. 推荐执行顺序

### Gate 0：建立可引用基线

1. 提交文档整合、当前能力索引与评估报告；
2. 记录 product commit；
3. 由新的 product commit 绑定验证证据；
4. 使用 Policy version 2 创建首波任务卡，不再从阶段标题直接派工。

### Wave 0：安全与直接用户行为

1. SEC-01 Published 作者代码隔离；
2. UI-01 Slide surface owner 选择；
3. CMP-01 Flow/Spatial 组件删除假成功；
4. EXP-01 preflight/producer parity。

### Wave 1：诚实能力与诊断合同

1. 收窄 `project-health` 能力声明；
2. Report/Diagnostic Target V2；
3. schema-invalid report/exit code 决策；
4. 逐码 ledger：legacy code、V9 rule、severity、target、consumer、测试。

### Wave 2：示例与真实发布门

1. EXA-02/03 fresh-checkout 生成与 CI check；
2. EXA-01 V9/Published release sample；
3. EXA-04/06 行为 oracle 与 consumer 迁移；
4. asset-rich package closure 与 Published consumer parse。

### Wave 3：V9 全工程诊断

1. Runtime；
2. Interaction；
3. Component usage/lifecycle；
4. Controller/Media；
5. GUI read model 与最小稳定定位。

### Wave 4：合成与旧投影退出

1. canonical per-location/per-state materialization；
2. Slide 有证据的排版/几何 parity；
3. PRJ-00 去重与有基准的缓存；
4. PRJ-02～05 按用户行为纵切；
5. Flow/Spatial 新启发式只在可复现风险出现后准入。

## 8. 建议首波任务卡

首波只建议创建以下小卡，不建议直接创建 B2/B4/PRJ-05 大卡：

1. `repair-sec-01-published-author-code-isolation`
2. `repair-ui-01-slide-surface-owner-selection`
3. `repair-component-01-flow-spatial-delete`
4. `repair-export-01-preflight-producer-parity`
5. `repair-cap-01-honest-project-health-capability`
6. `repair-sem-00-diagnostic-target-contract`
7. `repair-exa-02-fresh-checkout-generation-check`

每张卡必须单独记录 Risk tier、Task class、Necessity/skip condition、Complexity delta、Validation ceiling/budget、Evidence reuse 和 Invalidating paths。

## 9. 验证证据

审计期间执行了以下只读或无产品写入的 focused validation：

- 编辑器 ownership、hit、authoringAddress、controller、Published host、health panel/navigation：21 个 test 文件，155 tests 通过；
- Project Health、validator、package preflight、effective layer、Flow view：6 个 test 文件，30 tests 通过；
- package/published/export preflight：两组 focused suites，分别 17 tests 与 18 tests 通过；
- `mixed.h5lesson` 的 V9 validator：Schema valid，3 surfaces / 3 locations，当前 Project Health 与四类 preflight 均为空；
- 构造 enabled、无 `staticFallback` 的 schema-valid Runtime：validator 仍返回 `health.items=[]`；
- 把 `startLocationId` 改为不存在：返回 `unreadable`、`projectHealth=null`，证实 B0 成功分支映射不可行；
- 构造两个 Slide surface 复用同一 `sceneId`：Schema 通过，但激活第二个 location 仍选择第一个 surface。

文档整合生成物检查：

- `npm run check:ai-capabilities`：通过；
- `npm run check:task-board`：通过；
- `npm run repo:index:check`：通过，667 inputs / 667 files / 6832 symbols / 16820 edges。

未执行完整 E2E 与 `verify-release`。原因是审计时工作树包含大规模文档整合，且现有 E2E 前置会重写 tracked examples；这也正是 EXA-02/03 需要修复的风险之一。

自动化通过只能证明现有行为仍被测试保护，不能证明 REPAIR 方案正确，也不能把 outcome 提升为 `accepted`。

## 10. 最终建议

不要按当前 `REPAIR_PLAN.md` 创建实现大卡。先把本报告中的阻断、遗漏项、任务拆分和执行顺序合入 REPAIR 计划，然后只创建首波小卡。

新的 REPAIR 计划达到以下条件后，才建议开放实现：

- [ ] PRJ-05 明确 sandbox/no-preload 安全边界；
- [ ] CAP-01/B0 的 report 与 exit-code 路径可达；
- [ ] Diagnostic Target 合同能为 AI 提供稳定 ID-based target；
- [ ] PRJ-00 cache key 覆盖完整 context；
- [ ] Slide surface owner、组件删除假成功、preflight 假绿进入首波；
- [ ] EXA-02/03 能在 fresh checkout 运行；
- [ ] SEM-B4、PRJ-04、PRJ-05 拆到一张卡一个用户行为；
- [ ] HYG 项有复现、consumer 或量化阈值，否则删除/延期；
- [ ] 任务板、验证证据与 product commit 已绑定。

在这些条件满足前，本计划的正确状态应是：**已完成发现，尚未获准实施。**
