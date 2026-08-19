# S0 稳定性第一方案：如何探索代码、设计架构、解耦模块

> 状态：**第一方案（方法）**。探索产物见 [S0_HANDOFF.md](S0_HANDOFF.md)。改代码方案见 [S1_STABILITY_CODE_PLAN.md](S1_STABILITY_CODE_PLAN.md)。本文件仍不授权改 `src/**`。
> 总纲：[COURSEWARE_DEVELOPMENT_PLAN.md](../../../COURSEWARE_DEVELOPMENT_PLAN.md) 12.12
> 日期：2026-08-19

本文件回答三件事：

1. **怎么读代码**，才能定位崩溃、空白、无法编辑，而不是再猜功能缺口。
2. **怎么设计架构**，才能把「进程还在、课还能打开、当前页还能编」从功能开发里抽成稳定内核。
3. **怎么解耦**，才能让以后的功能补丁不再反复打穿同一批热点文件。

它不回答「先改哪个函数、拆成哪几个文件」。那是 S1。

---

## 0. 本方案改变什么、不改变什么

### 改变（相对 12.10）

- 暂停新的教师可见功能车道（不再新开类似 P / Q / F / G 的补丁卡去碰内核文件）。
- 把「时好时坏」从「1.0 之后再拆 Store / Workspace」提升为**当前最高优先级**，但当前只做方法和边界，不动刀。
- 稳定性按**故障域**治理，不按功能点治理。Q0 已经证明：同一症状可以来自 scope、revision、双宿主接线三条完全不同的链；继续按功能点打补丁会继续回退。

### 不改变

- Course Project V9 软冻结。不改已有字段、判别器、语义。不启动 V10。
- 不新增 `projectMode` / 四模式持久化字段。
- 试运行 / 整课预览主路径仍是 CoursePlayer + Published V2；Phaser 只服务 Slide **编辑**命中。
- 不重做已合入的 T0–T6、P1–P8、Q1–Q8、F1–F3、G0–G3。
- 不引入可见 AI、审批流、Hash、Evidence。
- 不为解耦而先造插件框架、Command 总线或第二套编辑器。

### 与 Q0 的分工

[Q0_DIAGNOSIS.md](Q0_DIAGNOSIS.md) 定位的是**当时一批教师可见功能缺陷**的接线原因，并明确「全量会话重挂治理、拆 Store / Workspace」不在那一轮。
本方案接手 Q0 明确放下的那一层：**会话生命周期、双真相、错误边界、热点碰撞**。Q1–Q8 的行为不得作为本方案的「重做清单」。

---

## 1. 教师可见稳定性失败，先分成三类

后续所有探索都必须先把一次复现归入下面一类。不允许用「编辑器坏了」当描述。

| 类别 | 教师看到的 | 本产品里的真实含义 | 不是 |
|---|---|---|---|
| **A. 进程/界面崩溃** | 白屏、整窗报错、需要「重新载入」、窗口消失 | React 未捕获、渲染进程 gone、Phaser/GPU 把 renderer 打死、主进程未捕获 | 某按钮没接线 |
| **B. 内容加载不出来** | 打开后空白、图/视频/组件/讲义不出现、试运行转圈或空壳 | 资源 sidecar 与文档引用不一致、blob URL 已撤销、宿主挂载失败被吞掉、双路径只接了一条 | 「还没做这个功能」 |
| **C. 无法编辑** | 点了没反应、拖不动、输入被拒、切页后锁死、英文 `stale-revision` | 写错 session、写错 scope、过期 revision、edit/run 重挂把作者画布卸掉、投影与 V9 分叉 | 缺一个属性栏控件 |

高可用性在本产品中的最低标准（桌面编辑器，不是服务器 SLA）：

1. **进程仍在**：主进程与渲染进程不因为局部宿主失败而退出。
2. **课仍在**：当前 V9 文档与 sidecar 不丢失；崩溃后恢复副本仍可打开。
3. **当前页仍可编**：至少一种表面的编辑态能选中、能写入、能撤销；失败必须是可理解的中文拒绝，不能是静默 no-op。
4. **失败可分类**：每次失败都有故障域、是否可恢复、是否已写入诊断日志。
5. **局部失败局部死**：试运行挂了不得拆掉编辑画布；导出失败不得改写 session；一张表面的 Phaser 失败不得拆掉整棵 App。

达不到这五条，不算「先把稳定性做好」。功能完整度不在本方案验收里。

---

## 2. 探索起步已经成立的源码事实

这些是读入口链与热点文件后的**观察**，用来约束探索路径。它们不是重构清单。

### 2.1 入口与热点

```text
src/main/index.ts
  → createWindow / ipc / projectPersistence / diagnosticLog
  → src/preload/index.ts
  → src/renderer/main.tsx          AppErrorBoundary × 1，包住整棵 App
  → src/renderer/App.tsx           ~1.9k 行：打开保存恢复导出 + 整课预览挂载
  → src/renderer/store/editorStore.ts   ~9.7k 行：V9 session + V8 形状投影 + 全部 command 入口
  → src/renderer/ui/Workspace.tsx  ~4.0k 行：Slide/Flow/Spatial 三宿主 + edit/run 切换 + Phaser
```

`PROJECT_COGNITION_INDEX.md` 第 9 节已经把上述文件标成高风险。高风险在这里的含义是：**几乎所有功能卡最终都要改它们，所以稳定性没有模块边界。**

### 2.2 运行时有两套（有时三套）世界

合同边界见 [EDITOR_1_0_ARCHITECTURE_BOUNDARY.md](../../contracts/EDITOR_1_0_ARCHITECTURE_BOUNDARY.md)，这是对的，必须保持：

- 编辑：Slide → Phaser；Flow / Spatial → 各自 DOM 容器。
- 试运行 / 整课预览：CoursePlayer + `SlidePublishedAdapter` / `FlowSurfaceHost` / `SpatialSurfaceHost`。

稳定性问题出在**切换这两套世界时没有单一所有者**：

- `Workspace` 用 `spatialSession` / `flowSession` / 默认 Slide 三选一切换整棵子树。
- 跨表面 `activateCourseLocation` 会 `applyFlowBackend` / `applySpatialBackend` / `applyV9Backend`，等于拆掉当前作者 session 再新建。
- Slide 编辑还残留 iframe Runtime Preview（`runtimePreviewLifecycle`）与 CoursePlayer 试运行两套；`tryRunMountKey` 随 revision 变化会重挂。
- 当前位置试运行至少有三条工厂：`mountPublishedCourseTryRun`、`mountSpatialLocationTryRun`、`mountFlowLocationTryRun`。Q0 已记录过 Spatial 两条宿主接线不一致导致「有时能看见」。

已有的正确缝：`beginSerializedSessionMount`、`RecoveryWriteCoordinator`、`authoringReadiness`。它们只覆盖了部分挂载，没有覆盖「谁才是当前唯一活 session」。

### 2.3 工程真相名义上唯一，内存里仍是双真相

- 可保存真相：`CourseProjectDocument`（各 `*Session.history.present`）。
- UI 仍大量读：`state.project`（V8 形状 `ProjectDocument`），由 `derivedV8ProjectFromBackend` / `FromSpatial` / `FromFlow` 生成。
- 资源字节：`slideCandidateSidecar.files` 与遗留 `assetFiles` 并存；选择器已偏向 sidecar，但 Store 仍双向投影。
- `loadProject()` 仍走 `migrateProjectV8ToCourseProjectV9`；空白工程应直接构造 V9，这条迁移链只应作为内部适配，不能再当第二条打开语义。
- 命名层仍是重建期遗物：`slideCandidateSnapshot`、`slideCandidateSidecar`、`injectV9SlideCandidateBackend`。T3 已去掉双后端，但候选语义还在字段名里，探索时不要被名字骗成「还有 V8 可写后端」。

`selectActiveCourseProjectDocument` 的优先级是 `spatialSession ?? flowSession ?? slideBackend`。三者在 `apply*Backend` 时互斥清空，这是隐藏的编排规则，目前没有独立模块把它说清楚。

### 2.4 失败处理不是一个系统

| 机制 | 位置 | 实际效果 |
|---|---|---|
| `AppErrorBoundary` | `main.tsx` 只包一层 | 任何子树未捕获 → 整窗崩溃页，只能 reload |
| `errorMessage` toast | Store + App | command `ok: false` 时常把 **英文 reason**（如 `stale-revision`）直接写出 |
| `UserFacingError` | 打开/保存/组件导入 | 有标题和建议，但 command / 宿主路径基本不用 |
| 空 `catch {}` | Player 宿主、try-run、公式、视频、导航 | 失败变成「没反应」或空白 |
| `enqueueSerial(..., () => undefined)` | 挂载链 | 挂载错误被吞，调用方不一定进入 `onError` |
| `diagnosticLog` + `reportDiagnostic` | 主进程 / renderer | 有日志，没有故障域、没有与 session generation 关联，也没有回归断言 |

结果：同一类失败有时崩溃、有时 toast、有时什么都不发生。教师感知就是「时好时坏」。

### 2.5 为什么补丁会回退

不是因为工人不遵守任务卡，而是任务卡的执行模型会**系统性地**制造回退：

1. **文件防火墙**把一次修复限制在 1–3 个文件，真实故障链穿过 Store → Workspace → Host → Producer。
2. **最小验证**只跑 1–2 个 Vitest 文件；没有「打开–切表面–试运行–回编辑–保存–重开」的稳定性套件。
3. **禁止中间任务跑全量**（对合同车道合理）让生命周期回归从未成为门禁。
4. **热点文件并发**：`editorStore.ts` / `Workspace.tsx` / 三个 Host 是所有车道的交汇点。G 车道一天内多次合入 Flow，与 Q 刚合入的宿主接线抢同一条生命线。
5. 总纲 12.10 仍写「不为时好时坏单开稳定性史诗」。功能卡会继续往热点里塞行为，稳定性没有否决权。

已有单测里，`serializedSessionMount`、`recoveryWriteCoordinator`、`appErrorBoundary`、`authoringReadiness` 证明**局部缝是可测的**。缺的是把这些缝连成一条「会话仍活着」的契约。

---

## 3. 高可用性内核 vs 功能壳

探索和架构设计都必须先画这条线。内核未稳，禁止把壳的需求写进稳定性改动。

### 3.1 稳定性内核（本阶段唯一服务对象）

| 内核职责 | 今天主要落点 | 教师可感知后果 |
|---|---|---|
| 进程存活 | `src/main/index.ts`、`diagnosticLog`、`AppErrorBoundary` | 崩溃 / 白屏 |
| 打开 / 保存 / 恢复 | `courseProjectArchive`、`projectPersistence`、`recoveryWriteCoordinator`、App 启动 effect | 丢课、打不开 |
| 唯一活文档 | 三个 `*Session.history.present` + sidecar | 保存的不是正在编的 |
| 位置与表面切换 | `activateCourseLocation`、`apply*Backend` | 切页后空白或锁死 |
| 编辑/试运行宿主生命周期 | Workspace + `beginSerializedSessionMount` + 三个 Host + Phaser `createEditorGame` | 空画布、重叠 Player、GPU 泄漏 |
| 一次操作一次 revision | command `expectedRevision` / history | 点了没反应 |
| 资源与组件字节 | sidecar、blob URL registry、component packages | 图文不显示 |
| 错误分类与恢复动作 | 散落 | 英文报错 / 静默失败 |

### 3.2 功能壳（本阶段只当负载，不当目标）

属性栏字段、绕排、字体、工具条、图层树文案、导出格式细节、组件目录是否存在——都可以在内核上复现「会不会把 session 打挂」，但**不得**在 S0/S1 里以功能补全为验收。

探索时如果一条路径既是内核又是功能（例如插入视频），只记录它对 sidecar / revision / 宿主挂载的影响，不记录「视频控件够不够用」。

---

## 4. 探索方法（怎么读代码）

探索是只读的。允许加临时诊断日志或探针脚本，但那些属于取证，必须可丢弃，不能混进产品行为。

### 4.1 原则

1. **从故障域走进去，不要从目录树走进去。** 禁止「先把 `src/renderer` 读一遍」。
2. **一次只追一条生命线。** 例如「打开 V9 zip → 出现可编辑 Slide」。中途看到字体或 wrap，记到附录，不跟过去。
3. **以源码和可复现运行为准。** 任务卡、HANDOFF、Q0 只作线索。索引与源码冲突时改认知，不改事实。
4. **已有缝优先。** 先找 `RecoveryWriteCoordinator`、`beginSerializedSessionMount`、`SlideBackend`、`read-model`、command `ok/reason`。不要假设需要新框架。
5. **双路径必须成对列出。** 发现一条「编辑怎么画图」，必须立刻问「试运行怎么画图、保存怎么写盘、重开怎么读回」。缺一条就记为双路径债。
6. **空 catch 视为缺陷线索，不是风格。** 记录文件、被吞掉的失败会落成 A/B/C 哪一类。
7. **子代理探索用 inherit / composer-2.5-fast，禁止 Gemini 3.7。** 同一路径最多读一次。

### 4.2 五步探索协议

对 **A/B/C 每一类**各走一遍下面五步。三类可以并行，但每条线要有独立笔记，禁止合并成一张「大重构脑图」。

#### 步骤 E1 — 生命线清单（半天级，只读）

为每个内核场景写出**唯一**调用链，格式固定：

```text
触发（菜单/快捷键/切页/切 edit↔run）
  → Store action 或 command
  → session / revision / sidecar 如何变
  → 哪个 Host mount 或 destroy
  → UI 读的是 V9 present 还是 derivedV8 project
  → 失败时：throw / result.ok / catch 空 / toast / boundary
```

最低限度必须覆盖的生命线：

1. 启动 → 读恢复副本 → 决定 offer / 静默清理 → 空白课可编
2. 打开合法 V9 zip → 三种起始表面（Slide / Flow / Spatial）→ 画布非空
3. 打开损坏 / 非 9 / 缺 sidecar 字节 → 中文拒绝，进程仍在
4. Mixed 课：Slide → Flow → Spatial → 再回 Slide（编辑态）
5. 编辑态 → 当前位置试运行 → 再回编辑态（同表面、跨表面各一次）
6. 整课预览打开 / 关闭 / 连续开关
7. 插入图或视频（只看 sidecar + revision，不看功能）→ 撤销 → 保存 → 重开
8. 文字正在输入时切页 / 切表面（composing 拒绝路径）
9. command 带过期 `expectedRevision`
10. Renderer 抛未捕获错误（boundary）以及 `render-process-gone`

每条生命线产出一张表：涉及文件、可变状态、现有测试、已知空 catch。**不要**在这一步提议拆文件。

#### 步骤 E2 — 所有权矩阵（只读）

对内核里每一种可变状态，填且只填一个「写所有者」：

| 状态 | 只应被谁写入 | 今天实际写入点（可多个，这就是债） | 只应被谁读取 |
|---|---|---|---|
| `CourseProjectDocument` | command 结果落到 session.present | `apply*Backend`、部分 App 保存回调、derived 回写 | 投影 / 导出 / 保存 |
| `revision` | 成功 command | 多处 persist*Result | 所有写路径的 stale 检查 |
| sidecar bytes | media command | Store 与 V8 `assetFiles` 投影 | 画布 / 宿主 / 保存 |
| blob URL | 单一 registry | 多处 create/revoke | 编辑 DOM / 试运行 |
| 活着的 Host | 单一 SessionOwner | Workspace 三子树 + App 整课预览链 | 该表面 UI |
| `canvasMode` | 教师切换 + 导航策略 | `apply*Backend` 默认值、P2 补丁 | Workspace 挂载选择 |
| `editingScope` | 左栏 / 明确入口 | 选择控制器、命中测试副作用（Q1 已压，仍要核对） | command 守卫 |
| Phaser game | Slide 编辑 Host | `createEditorGame` / `destroy` | 命中与变换 |
| 诊断 | diagnostic 管道 | console.error 与空 catch | 开发者 / 后续门禁 |

规则：矩阵里「今天实际写入点」多于一个，就记为**所有权分裂**。S1 只能通过收口所有权来改，不允许再加第四个写入点「暂时修一下」。

#### 步骤 E3 — 双路径与双真相清单（只读）

用搜索而不是通读。建议起点（不是完整命令，探索时按需收窄）：

- `derivedV8ProjectFrom*`、`state.project`、`loadProject(`
- `slideCandidate*`、`assetFiles`、`slideCandidateSidecar`
- `applyV9Backend` / `applyFlowBackend` / `applySpatialBackend`
- `mountPublishedCourseTryRun` / `mountSpatialLocationTryRun` / `mountFlowLocationTryRun`
- `createEditorGame` / `PlayerApp` / `createPublishedCourseSession`
- `catch {` / `catch {` 空体、`enqueueSerial` 的吞错
- `expectedRevision` / `stale-revision` / `errorMessage: result.reason`
- `ErrorBoundary`（预期只有 App 一层）

每一对双路径写成：

```text
意图：教师要看到 X
路径 1：…
路径 2：…
何时走 1 / 何时走 2：…
不一致时教师看到：A / B / C
```

Q0 的 Spatial 试运行 URL 就是这种条目的范例。本步骤要穷尽内核相关的对，而不是再扫功能。

#### 步骤 E4 — 动态取证（可运行，不改产品行为）

静态清单不够时才做。允许：

- 用现有 V9 夹具 `tests/fixtures/course-project-v9` 走 E1 的生命线。
- 在诊断通道加**临时**字段：`sessionKind`、`locationId`、`revision`、`canvasMode`、`mountGeneration`、`commandReason`。
- 读已有 `editor-diagnostics.jsonl`，看崩溃是否已有主进程记录。

禁止：

- 为了「方便看」改 command 语义或 UI。
- 用 Playwright 全量当探索工具（那是门禁，不是探索）。
- 把探针留在主干。

取证问题只有四个：这次失败是所有权分裂、竞态、被吞错误，还是双路径漂移？答不上来就还没找够，不要开始设计拆分。

#### 步骤 E5 — 不变量目录（设计输入，仍不改代码）

把「违反就会出现 A/B/C」写成可判定句子。下面是**候选**，E1–E4 必须证实或改写它们，不能直接当 S1 任务。

候选不变量：

1. 任意时刻至多一个活的作者 session：`slideBackend` / `flowSession` / `spatialSession` 只有一个非空。
2. `selectActiveCourseProjectDocument()` 非空当且仅当那个活 session 非空；UI 持久化读取不得回落到过期的 `state.project`。
3. sidecar 的每个被引用 `assetId` 要么有字节，要么走明确的缺失占位，不得空 src 静默失败。
4. 同一 DOM 容器同一时刻只有一个 Host；新 Host `onReady` 之前必须 `destroy` 旧 Host。
5. `canvasMode === 'edit'` 时 CoursePlayer 试运行未挂载；`=== 'run'` 时 Phaser 不接收写入手势。
6. 失败的 command 不推进 revision；过期 revision 不覆盖 present；教师看到中文、可重试，而不是英文 reason。
7. React 子树失败不得拆掉文件生命周期（打开/保存/恢复仍可用）。
8. 导出 / 预览构建失败不得 `set()` 进作者 session。
9. StrictMode 双调用不得出现两个 Phaser game 或两个 Player。
10. 恢复副本的 identity 检查失败时，不得静默覆盖官方文件。

每一条不变量要标注：现在有没有测试、测试测的是函数还是生命线。

### 4.3 探索时明确不要读的东西

- `docs/reviews/**`、旧 V8 重建任务、donor `CourseStudioApp`：只在需要对照历史行为时打开，不当目标架构。
- `dist-*`、`output/`、生成的 `course.html`。
- 功能壳的属性栏大文件（`PropertiesTab.tsx` 等），除非生命线证明它在写 session。
- 为「完整符号图」去扫 `repo-index`；索引缺失时以源码为准，本阶段不重建知识图谱。

### 4.4 探索产物（S1 的输入包）

S0 完成的标志不是想法，而是这五份笔记（可放在后续 `S0_HANDOFF.md`，仍不改 `src`）：

1. **生命线表**（E1）
2. **所有权矩阵**（E2）
3. **双路径债清单**（E3）
4. **取证记录**（E4，可为空，但要写「为何静态已足够」）
5. **不变量目录**（E5，每条带证实/推翻）

没有这五份，禁止写 S1，禁止拆 `editorStore.ts`。

---

## 5. 架构设计方法（怎么从探索结果得到目标结构）

架构设计在探索产物齐了之后做，仍然**先出结构决策，再出文件方案**。S1 才把决策落成允许修改的文件列表。

### 5.1 设计顺序（必须按此，禁止跳步）

```text
故障域
  → 所有权（谁写、谁读、谁销毁）
  → 不变量（违反即 A/B/C）
  → 缝（已有模块能否承载这些所有权）
  → 才允许谈拆文件 / 加模块
```

禁止的设计顺序：

- 先按目录切 `store/` `workspace/` `player/`。
- 先上 EventBus / DI / 插件。
- 先消灭所有 `derivedV8*`（那是读模型迁移，属于壳与长期项，只能在内核所有权收口之后做）。
- 先统一三种表面的视觉实现。

### 5.2 目标结构用所有权模块说话，不用类名说话

内核在概念上应变成下面六块。它们是**职责**，不是现在就要新建的六个文件夹。

```text
                    ┌─ ErrorOwner ─ 分类 / 中文 / 是否可恢复 / 诊断
ProcessOwner ───────┤
                    └─ 主进程存活、渲染进程 gone、单例窗

PersistenceOwner ──── 打开 / 保存 / 恢复 / 最近文件
        │
DocumentOwner ─────── 唯一 CourseProjectDocument + revision
        │
AssetOwner ────────── sidecar 字节、blob URL、组件包字节
        │
SessionOwner ──────── 互斥的 Slide|Flow|Spatial 活 session
        │              位置切换、canvasMode、scope、composing
        │
HostOwner ─────────── Phaser | Flow 编辑容器 | Spatial 编辑容器
                      CoursePlayer 试运行 | 整课预览
                      mount generation、destroy、StrictMode
        │
CommandOwner ──────── 一次用户操作 → 一个结果；stale 重试策略
                      不把 reason 字符串泄漏给教师
```

今天这六块几乎都挤在 `editorStore.ts` + `Workspace.tsx` + `App.tsx`。架构设计的任务是：**指出每块的现有承载者，以及「第二个写入者」必须退出**。不是先把 9.7k 行按行号切开。

### 5.3 用缝，不要用新世界

设计时对每一块问三问：

1. **已有模块是否已经是这块的核？**
   例如 Command 已在 `src/renderer/course/*Commands.ts`；Host 已有三个 SurfaceHost；恢复已有 `RecoveryWriteCoordinator`；Slide 后端已有 `slideBackendPort.ts`。
2. **Store 能否降级成门面？**
   即 UI 仍 `useEditorStore`，但写入只通过 Document/Session/Command 三个入口。门面可以暂时仍是一个文件。
3. **投影能否继续存在？**
   可以。`derivedV8*` 和 `read-model` 是读适配。架构上只要禁止「从投影写回 V9」和「UI 在活 session 存在时读过期 `state.project`」。一次性删除投影不是稳定性必要条件。

只有三问都答「现有缝扛不住」时，S1 才允许新增一个模块。新增模块必须能对着 E5 某条不变量写出测试。

### 5.4 故障隔离（高可用的架构含义）

按舱壁设计错误边界，而不是再包一层全局 try/catch。

目标舱壁（设计约束，S1 再落到组件）：

| 舱壁 | 失败时仍必须可用 |
|---|---|
| 单张表面的编辑 Host（含 Phaser） | 其它表面、左栏课程树、保存 |
| 当前位置试运行 Host | 同一表面的编辑态（切回 edit 必须能回到 Phaser/稿纸/世界） |
| 整课预览 overlay | 底下编辑 session 未销毁 |
| 导出 / 预检 | 文档 revision 不变 |
| 组件 Runtime 执行 | Native 图文仍可编 |
| 属性栏 / 工具条 React 树 | Workspace 画布与 Store 文档 |

当前唯一 `AppErrorBoundary` 违反舱壁：任何 UI 抛错都变成整窗 A 类失败。架构上要的是**多层边界 + 内核状态在边界外**，不是更漂亮的崩溃页。

### 5.5 Session 编排是稳定性的中轴

Q0 / P2 已经证明：跨表面跳转会拆后端、默认打回 `edit`、重挂 Player。架构设计必须单独给出 **SessionOwner 的状态机**，至少包括：

```text
Idle（无课）
  → DocumentLoaded（有 present + sidecar，尚无 Host）
  → Authoring(surface, location, scope)     Host = 编辑宿主
  → TryRun(surface, location)               Host = CoursePlayer；作者 session 仍在内存
  → FullPreview                             额外 overlay Host；作者 session 仍在内存
  → SwitchingLocation                       同表面：只改 location；跨表面：串行 destroy→open
  → Recovering / Failed(recoverable|fatal)
```

设计规则：

- **试运行不是另一种 backend。** `apply*Backend` 不应当是切 `canvasMode` 的实现。P2 是补丁；状态机要让「run 时只改 Published location」成为唯一合法转移。
- **跨表面切换是事务。** 失败则回到切换前的 Authoring/TryRun，不得停在「session 已空、Host 已毁」。
- **composing 是硬锁。** 已有拒绝字符串，应升为状态机守卫，而不是各 action 自行 if。
- **generation** 与 **revision** 分开：generation 管 Host 实例，revision 管文档。不要用 revision 当挂载 key 去拆仍在编辑的 Phaser（`tryRunMountKey` 含 revision 是探索时必须核实的风险）。

把状态机画清楚之前，禁止讨论「Workspace 拆成三个文件」。

### 5.6 错误模型是架构，不是文案

设计一个内核统一的结果类型（概念上，不规定 API 名）：

```text
成功：推进 revision，清错误
拒绝：不推进 revision，教师可读中文，可指出「切换范围 / 重试 / 保存」
过期：不推进；策略只有两种——丢弃这次手势，或对最新 present 重放；禁止当错误 toast 堆叠
故障：进诊断；按舱壁降级（占位、只读、保存仍可用）
致命：boundary；保留恢复副本；提供重载
```

`UserFacingError` 与 `DesktopOperationError` 已经覆盖持久化。Command 与 Host 必须并入同一分类，而不是继续 `errorMessage: result.reason`。S1 可以逐步替换，S0 只要求分类表与现有 reason 字符串的映射。

### 5.7 明确非目标架构

- 不把三种表面合成一个渲染器。
- 不把 Phaser 接回试运行来「减少双路径」——那是用更大耦合换局部绿。
- 不引入持久化 `projectMode`。
- 不把 `globalLayerItems` 迁到 V10 统一图层模型。
- 不把 Store 换成 Redux/XState 作为前提。状态机可以是纯函数模块，由现有 Zustand 调用。
- 不把「删掉所有 V8 形状类型」当作稳定性里程碑。

---

## 6. 模块解耦方法（怎么拆耦合，而不是怎么拆文件）

解耦的度量：**以后一张功能卡不再需要同时改 DocumentOwner、HostOwner 和 App 生命周期。**
不是文件行数变少。

### 6.1 先认已经解耦的，再认假解耦

已经相对健康、解耦时应**保持并让内核依赖它们**的：

- `src/shared/contracts/**` 与 Schema（冻结，稳定性只消费）
- `src/renderer/course/*Commands.ts`、`*EditorView.ts`（命令与只读投影）
- `slideBackendPort.ts`（Slide 写入端口）
- `src/player/surfaces/**`（运行宿主）
- `recoveryWriteCoordinator.ts`、`serializedSessionMount.ts`
- `read-model/`（T5：UI 读投影的方向是对的）

假解耦、探索时不要被目录名安慰的：

- `editorStore.ts` 再 import 上述模块，然后在同一文件里做 `apply*Backend`、V8 投影、toast、history、媒体、课程树。模块在磁盘上分开，运行时仍是一个上帝对象。
- `Workspace.tsx` 里三个 `*LocationWorkspace`：表面 UI 分开了，挂载策略、try-run key、错误反馈仍复制粘贴。
- 工人协议的文件防火墙：磁盘解耦假象，故障链仍耦合。

### 6.2 解耦的合法手法（S1 选用，S0 只排序）

按侵入性从低到高。S1 必须优先用更低的一档，只要能收口 E2 的「第二写入者」。

**档 0 — 冻结热点，不拆代码**
内核文件列出「稳定性锁」。功能卡不得改这些文件，除非 S 车道明确授权。这是组织解耦，往往比先重构更有效。

**档 1 — 收口写入，不搬家**
例如：禁止新代码读取过期 `state.project`；所有 command 失败走同一 mapper；`apply*Backend` 成为 SessionOwner 的唯一入口。文件可以仍巨大。

**档 2 — 把已有纯函数变成唯一入口**
Session 状态机、Host `SessionHandle`、错误分类表、blob registry——先让 Store/Workspace **调用**它们，再考虑搬家。

**档 3 — 物理拆分上帝文件**
仅当档 1–2 的入口已经稳定、并且 E1 生命线测试能在拆分前后对照时进行。拆分按所有权模块切，不按「每 500 行一个文件」。

**档 4 — 替换读模型**
V9-native 读模型替换 `derivedV8*`。这是长期项，能降低耦合，但不修复 A 类崩溃。不要当 S 车道第一刀。

禁止当作第一刀的手法：重写 Workspace、同时拆 Store 与三个 Host、引入新的编辑器壳、把 command 再包一层 framework。

### 6.3 依赖方向（解耦完成后应成立）

```text
UI（App 壳、侧栏、工具条）
  → Session 门面（今天的 Zustand，明天仍可以是它）
    → CommandOwner → DocumentOwner + AssetOwner
    → HostOwner（订阅 session，不写 document）
      → Phaser / Flow 编辑 / Spatial 编辑 / CoursePlayer
PersistenceOwner ↔ DocumentOwner
ErrorOwner ← 上述所有人  （单向汇报，不反向改文档）
Player 导出 / Published producer
  → 只读 Document + Asset   （禁止写 session）
```

任何 `player/**` import `editorStore`、任何 Host 直接 `set()` Zustand、任何 UI 直接 mutate `history.present`，都记为反向依赖，必须在双路径清单里出现。

### 6.4 测试解耦：没有生命线测试，代码解耦会回退

功能单测锁的是 command 纯函数，所以功能能绿、生命线能红。稳定性解耦必须补**少量**生命线测试，而不是恢复「每张卡跑 npm test」。

S1 设计测试时只允许这几类（此处仍是方法，不写具体 describe）：

1. Session 互斥：打开 Spatial 后 `slideBackend === null`，再切 Slide 后 `spatialSession === null`。
2. Host 串行：StrictMode 下 destroy 次数 ≥ mount 次数。
3. 过期 revision：第二次结果不覆盖第一次 present。
4. 试运行失败：`canvasMode` 切回 edit 后编辑 Host 仍在。
5. 打开损坏包：进程不抛到 boundary。
6. 恢复副本：offer / 清理分支不覆盖官方 zip。

这些测试是解耦的护栏。没有它们，档 3 的物理拆分禁止开始。

### 6.5 组织解耦（与代码同等重要）

若只改代码结构、仍按 02_WORKER 的「1–2 个文件 + 1–2 个单测」往内核里塞功能，回退会重来。

S 车道规则（第一方案就生效，等总纲 12.11 确认）：

1. **内核文件默认冻结。** 未列出的功能卡碰到它们必须停。
2. **同时只允许一条 S 卡改同一内核文件。** 不再用防火墙把一条生命线拆成五张互不相见的卡。
3. **S 卡的最小验证必须包含至少一条生命线测试或明确的宿主销毁断言**，而不是再测一个 wrap CSS。
4. 功能车道（未来若恢复）禁止以「顺手修 stale-revision toast」为名改 SessionOwner。
5. 父代理合入 S 之前，对照 E5 不变量：有一条被破坏则拒合。

内核文件候选（E2 之后可修订，S0 先锁这份，避免探索期间继续被功能卡打穿）：

- `src/renderer/store/editorStore.ts`
- `src/renderer/App.tsx`
- `src/renderer/ui/Workspace.tsx`
- `src/renderer/ui/serializedSessionMount.ts`
- `src/renderer/ui/coursePlayerTryRun.ts`
- `src/renderer/ui/spatialLocationTryRun.ts`
- `src/renderer/ui/flowLocationTryRun.ts`
- `src/renderer/phaser/createEditorGame.ts`
- `src/player/surfaces/**` 的 mount/destroy 路径
- `src/renderer/project/recoveryWriteCoordinator.ts`
- `src/renderer/project/courseProjectArchive.ts`
- `src/main/projectPersistence.ts`、`src/main/ipc.ts`
- `src/renderer/ui/AppErrorBoundary.tsx`

---

## 7. 本环节交付与停手

### 7.1 本环节（S0）交付

- 本文件。
- 总纲 12.11 与任务索引中的「暂停功能、先做稳定性方法」指针。
- **不**交付源码修改，**不**交付 S1 任务卡，**不**交付「把 editorStore 拆成 N 个文件」的清单。

### 7.2 下一步（确认本方案之后）

1. 按第 4 节跑 E1–E5，写出 `S0_HANDOFF.md`（五份探索产物）。
2. 基于 HANDOFF 写 **S1：改代码方案**（档位选择、状态机、舱壁、允许文件、生命线测试、停手条件）。
3. 只有 S1 被确认后才开实现卡（建议仍由父代理切卡，禁止在未确认状态机前物理拆分上帝文件）。

### 7.3 停手条件（探索阶段）

- 发现必须改 V9 判别器才能消除 A/B/C → 停，写进 HANDOFF，不要偷偷解冻。
- 发现必须把 Phaser 接回试运行 → 停。那是功能回退，不是稳定性。
- 探索变成通读 Properties / 导出 PPTX → 停，回到生命线表。
- 有人提交功能补丁改内核文件 → 拒合，直到 S 车道明确授权。

---

## 8. 成功标准（第一方案自身）

本方案成功，当且仅当：

1. 任何人（含第三方工人）读完后知道：**先探生命线，再写所有权，再谈拆分**。
2. A/B/C 三类失败有定义，不会再和「功能没做完」混为一谈。
3. 六块内核所有权、Session 状态机、错误分类、依赖方向已经成为 S1 的强制输入。
4. 内核文件已冻结，功能回退的组织原因被点名，而不是只骂实现质量。
5. 仓库里没有借本方案之手上的产品代码改动。

教师是否觉得「已经稳定」是 S1 实现与真人复核的事，不是本文件的验收。
