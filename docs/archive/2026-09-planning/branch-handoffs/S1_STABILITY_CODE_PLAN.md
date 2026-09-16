# S1 稳定性代码修改方案

> 状态：**改代码方案**。确认前 **禁止** 按本文件改 `src/**`。确认后按「波次」开实现卡，不要一次拆 Store。
> 输入：[S0](S0_STABILITY_EXPLORATION_PLAN.md) 方法 + [S0_HANDOFF](S0_HANDOFF.md) 探索产物
> 日期：2026-08-19

本方案只服务三类教师可见失败：**A 崩溃**、**B 内容加载不出**、**C 无法编辑**。不补功能、不解冻 V9、不把 Phaser 接回试运行、不启动 V10、不物理拆分 `editorStore.ts`（档 3 留到生命线测试先绿）。

解耦档位（S0 §6.2）：本方案落地 **档 0 已生效、档 1–2 本轮、档 3–4 禁止**。

---

## 0. 目标结构（改完后应成立，不是新框架）

```text
UI 壳（App 菜单/保存/恢复）  ← 不被画布 throw 拆掉
  → Zustand 门面（仍是 editorStore.ts）
      → persist*Result 只经 commandFailure 分类器
      → apply*Backend 仍是唯一跨表面入口
  → HostOwner（Workspace 内收口，不新开编辑器）
      → edit: Phaser | Flow 稿纸 | Spatial 世界
      → run / 整课预览: 仅 mountPublishedCourseTryRun
  → AssetOwner: sidecar 为字节真相；编辑态 blob 走 BlobUrlRegistry
  → PersistenceOwner: 只打包 selectActiveCourseProjectDocument + sidecar
```

Session 状态机（S0 §5.5）本轮 **不** 单独做成 XState。用档 2 把现有 `apply*Backend` + `canvasMode` + 挂载 key 收成可测函数即可。

---

## 1. 明确不改

- V9 字段 / 判别器 / 语义；Published / Runtime / Component 版本号。
- 重做 P1–P8、Q1–Q8、F、G 的功能行为。
- 删除 `derivedV8*`、一次性 V9-native 读模型（档 4）。
- 把 `editorStore.ts` / `Workspace.tsx` 按行数切开。
- 产品试运行改回 `SpatialSurfaceHost.fromPublishedCourse` 直挂（与 CoursePlayer 再分叉）。
- 为稳定性引入插件、Command 总线、第二套 App 壳。

---

## 2. 波次与依赖

```text
S1-A  错误分类器（档 1）     ─┐
S1-B  错误舱壁（档 1）       ─┴─ 无共同文件，可并行
         │
         ▼
S1-C  Host 重挂与 Phaser 休眠（档 2）  必须碰 Workspace；独占该文件
         │
         ▼
S1-D  持久化/选择器收口（档 1）  App recovery 依赖 + 选择器 fail-closed
         │
         ▼
S1-E  试运行工厂并入 CoursePlayer + 编辑态 blob registry（档 2）
         │
         ▼
S1-F  生命线测试门禁（没有这些，禁止档 3）
```

同一时刻只允许一张卡改 `editorStore.ts` 或 `Workspace.tsx`。S1-A 与 S1-C 不得并行抢 Store/Workspace。

---

## 3. S1-A 错误分类器（C 类优先）

### 教师应看到

点了没反应或英文 `stale-revision` 消失。过期手势被丢弃；需要知道的失败是中文，带「可重试 / 先完成文字 / 元素已锁定」之一。revision 仍不前进。

### 做法（档 1：收口写入，不搬家上帝对象）

1. 新建纯函数模块（建议 `src/renderer/store/commandFailure.ts`，不要放 shared 合同）：
   - 输入 `reason: string | undefined` + 可选 cause。
   - 输出 `{ kind: 'stale' | 'reject' | 'fault', message: string | null }`。
   - 映射至少：`stale-revision` → kind stale、message **null**（不 toast）；`locked` / `wrong-owner` / `not-slide-authoring-backend` / `not-flow-session` → 中文 reject；已是中文的 reason（含 composing）原样通过。
   - 未知 reason：fault + 中文「操作未完成，请重试」，**同时** `console.error` 保留原 reason 供诊断。
2. `persistCandidateResult` / Spatial / Flow 对应 persist、以及 Store 里其它 `errorMessage: result.reason`（HANDOFF 已列出行）全部改走分类器。
3. `kind==='stale'`：不 set errorMessage（避免英文），不推进 session。本波次 **不做** 自动重放（避免把过期拖拽打到错误物件上）。若连续手势因 stale 无反馈，S1-C 之后可加「丢弃」即可，不要静默重放变换。

### 允许改

- 新建 `src/renderer/store/commandFailure.ts`
- `src/renderer/store/editorStore.ts` **仅** persist* 失败分支与同等 `errorMessage: result.reason`（禁止顺手改 command 语义、投影、apply*Backend）
- 新建 `tests/unit/commandFailure.test.ts`
- 可在现有 `v9SlideContentCommands.test.ts` 增一条：**Store persist 后 errorMessage 不是 `stale-revision` 字符串**（若必须碰 Store 测试文件）

### 禁止

- 改 Schema、Host、Workspace、文案以外的 command 返回值形状（仍是 `ok/reason`）。
- 把 reason 改成中文散落在每个 command 文件（分类器集中映射，command 保持稳定英文码）。

### 最小验证

```text
npx vitest run tests/unit/commandFailure.test.ts
git diff --check
```

---

## 4. S1-B 错误舱壁（A 类）

### 教师应看到

属性栏或试运行子树炸掉时：**菜单、保存、课程树仍在**，只有坏掉的舱显示「这块出了问题，可重试」，不是整窗「重新载入编辑器」。

### 做法

1. 把 `AppErrorBoundary` 抽成可复用（标题/重试回调可注入）。根上仍包 App。
2. 再包三层（不要超过这三层，避免满屏套娃）：
   - Workspace 画布（含 Phaser/稿纸/世界）
   - 当前位置试运行 / 整课预览 overlay
   - 右侧栏（Properties + 图层）
3. 舱壁 catch 时：`reportDiagnostic`；**不** clear Zustand 文档；重试 = `setState({error:null})` 而不是 `location.reload`（根 boundary 仍可 reload）。
4. Phaser 同步 throw 仍可能打穿 React；舱壁管的是 React 渲染。Host 挂载失败已有 feedback，不要改成 throw。

### 允许改

- `src/renderer/ui/AppErrorBoundary.tsx`
- `src/renderer/main.tsx`（仅若导出变了）
- `src/renderer/App.tsx`（只加包裹，不改保存逻辑）
- `src/renderer/ui/Workspace.tsx` **只加包裹**，禁止改挂载 key / Phaser 生命周期（那是 S1-C）
- `src/renderer/ui/RightSidebar.tsx` 或 App 里侧栏 JSX
- `tests/unit/appErrorBoundary.test.tsx` 增：子树 throw 时仍能看到外层角色（例如保存区 / 应用壳）

### 禁止

- 改 command、Schema、Player。
- 用 boundary 吞掉本应让教师看见的试运行 `onError`。

### 最小验证

```text
npx vitest run tests/unit/appErrorBoundary.test.tsx
git diff --check
```

---

## 5. S1-C Host 重挂与 Phaser 休眠（A/B）

### 教师应看到

试运行不再「改一个字就整页重载播放器」。切回编辑后演示页仍能立刻点选。低配上减少双 WebGL 抢上下文导致的整窗死掉。

### 做法（档 2：已有 `beginSerializedSessionMount` 当唯一 Host 入口）

1. **挂载 key 不含 revision。**
   Slide 现有 `tryRunMountKey` 去掉 `revision`。改为 `courseId + sidecar 文件 id 集合 + component 包 id 集合`。location 继续走已有 `session.goToLocation`。
2. **Flow / Spatial 与 Slide 对齐。**
   二者 `useEffect(..., [session, ...])` 会在每次 persist 换新 session 对象时拆掉 CoursePlayer。改成与 Slide 相同的 mountKey + `goToLocation(locationId)`。`canvasMode` 切走 run 时 destroy，与现在一样。
3. **Phaser 在 run 时休眠，不销毁。**
   `canvasMode==='run'`：`game.loop.sleep()`（或 scene pause）并忽略指针；回到 edit：`wake()` 且 `scale.refresh()`。destroy **仍只**在 `SlideLocationWorkspace` 卸载（离开 Slide 表面）时发生。不要为了省 GPU 在每次 run 时 destroy+create（那是更重的闪白）。
4. **`enqueueSerial` 的 destroy 失败写诊断**，仍不抛到 React。可给 `enqueueSerial` 可选 `onError`；默认诊断 `source:'renderer'`。取消中的 factory 失败仍可静默（避免已离开试运行还弹错）。
5. `waitForHostLayout` 超时：`onError` 人话「舞台尚未就绪，请再开一次试运行」，不要 0×0 硬挂。

### 允许改

- `src/renderer/ui/Workspace.tsx`（挂载 key、三表面 try-run effect、Phaser sleep/wake）
- `src/renderer/ui/serializedSessionMount.ts`（destroy 诊断，行为保持串行）
- `src/renderer/ui/coursePlayerTryRun.ts`（layout 超时错误）
- `src/renderer/phaser/createEditorGame.ts` 仅当需要暴露 sleep/wake 包装
- `tests/unit/slidePreviewRebuildKey.test.ts` 或新建 `tests/unit/tryRunMountKey.test.ts`
- `tests/unit/serializedSessionMount.test.ts`

### 禁止

- 改 `mountSpatialLocationTryRun` 产品语义冒充「修空白」（那是 S1-E）。
- 把 Phaser PlayerApp 接进 run。
- 为了休眠去改命中算法 / 教师控制器。

### 最小验证

```text
npx vitest run tests/unit/serializedSessionMount.test.ts tests/unit/tryRunLocationMode.test.ts
git diff --check
```

若新建 mountKey 纯函数测，一并跑。

---

## 6. S1-D 持久化与选择器收口（B/C）

### 教师应看到

自动恢复副本跟正在编的课走；没有活课时界面是空引导而不是一页「旧投影幻灯」。保存失败仍中文（已有 DesktopOperationError，不回退）。

### 做法

1. App 恢复 `useEffect` 依赖改为 **V9** `document.id` + `document.revision` + sidecar 指纹 + packages + dirty + path。删除以 `state.project` 当调度源。快照内容保持 `selectActiveCourseProjectDocument` + `selectMediaAssetFiles`（已正确）。
2. `selectActiveScene` / `selectEditingNodes` / `selectSlideSceneList`：存在任一活 session 时 **禁止** 回落到 `state.project`。无 session 返回空场景 / 空节点，不要用过期 V8 填画布。
3. `selectMediaAssets` 同样：有活 session 只用 present.assets，不要 `?? state.project.assets`。
4. 导出路径（App 里 `preview?.project ?? state.project`）本波次只改 **会写出错误课的** 那几处为 `selectActiveCourseProjectDocument`；PPT 光栅若仍要 V8 形状，必须从 **当前 present 现算** `derivedV8*`，禁止用 store 里可能滞后的 `state.project`。若导出函数签名迫使大改，停手写 HANDOFF，不要顺手重写导出器。

### 允许改

- `src/renderer/App.tsx`（recovery 依赖、导出读源若能最小改）
- `src/renderer/store/editorStore.ts` **仅** 上述 selector（S1-A 若未合入则等 A，禁止同一 PR 混分类器与 selector 除非单卡串行）
- 对应 selector 单测（`tests/unit/editorStore.test.ts` 或新建窄文件）

### 禁止

- 删除 `derivedV8ProjectFrom*`。
- 改 `loadProject` 测试 helper 行为以外的生产打开路径（生产已是 `loadCourseProject`）。

### 最小验证

```text
npx vitest run tests/unit/recoveryWriteCoordinator.test.ts tests/unit/projectHealth.test.ts
git diff --check
```

另加 selector 测：仅 spatialSession 时 `selectActiveScene` 不得读到上一份 Slide 的 `state.project.scenes`。

---

## 7. S1-E 试运行工厂并入 + 编辑态 blob（B）

### 教师应看到

测试里绿的 Spatial 视频路径与课堂上当前位置试运行是同一套 CoursePlayer。编辑态缩略图/稿纸图不因为组件重挂提前 revoke 而空白。

### 做法

1. `mountSpatialLocationTryRun` / `mountFlowLocationTryRun` 改为 **调用** `mountPublishedCourseTryRun`（或共享同一 `createPublishedCourseSession` + mount）。保留函数名给测试 import。Q5 对 `SpatialSurfaceHost` 的 HTML video 修补必须仍由 Published 宿主覆盖；若发现 CoursePlayer 路径缺 video，**只补 Published 适配器**，不要再维护第二条 Host 接线。
2. Workspace 对这两个函数的 re-export 可留，避免测碎。
3. 编辑态 `URL.createObjectURL`：Workspace Spatial 媒体、FlowWorkspace、MediaTab、SceneThumbnail 改为注入或使用单一 `BlobUrlRegistry` 实例（可挂在 Store 外的模块单例，随 `loadCourseProject` / 关闭课 `revokeAll`）。导出器（pptx/renderSceneImages）可暂留本地 create/revoke（短生命周期）。

### 允许改

- `src/renderer/ui/spatialLocationTryRun.ts`
- `src/renderer/ui/flowLocationTryRun.ts`
- `src/renderer/ui/coursePlayerTryRun.ts`（仅抽共享 mount，若需要）
- `src/renderer/project/blobUrlRegistry.ts` 调用点：上述 UI + 打开/关闭课
- `src/renderer/store/editorStore.ts` **仅** 若必须在 load/close 调 `revokeAll`（极小）
- 现有 `spatialLocationTryRun.test.ts` / `flowUnifiedLayerEntry.test.tsx` 应变为仍通过

### 禁止

- 改 Component API、新建第二 registry。
- 为 blob 改 V9 assets schema。

### 最小验证

```text
npx vitest run tests/unit/spatialLocationTryRun.test.ts tests/unit/flowUnifiedLayerEntry.test.tsx
git diff --check
```

---

## 8. S1-F 生命线测试门禁

没有下列测试，禁止任何「拆 editorStore / Workspace」的后续卡。

| 测 | 断言 | 建议文件 |
|---|---|---|
| 互斥 session | 打开 Spatial 后 `slideBackend===null`；再切 Slide 后 `spatialSession===null` | 扩现有 product integration |
| 切换失败不半毁 | composing 时 activate 被拒，原 session 指针不变 | `courseLocationCommands` / store |
| stale | persist 后 revision 不变且 errorMessage 无 `stale-revision` | 接 S1-A |
| 打开损坏包 | `openDefaultCourseProject` throw UserFacingError，测里不渲染 App 也能过 | 已有 archive 测则锁断言 |
| 恢复不覆盖官方 | `shouldOfferCourseProjectRecovery` 官方更新 → ignore-stale-official | 已有则保持 |
| 试运行失败回编辑 | mock mount reject → feedback error；`canvasMode` 切回 edit 不抛 | Workspace 窄测或 host 测 |
| StrictMode 串行 | destroy 次数 ≥ factory 次数 | 已有 serializedSessionMount |
| mountKey | revision+1 不改变 key；换 sidecar id 改变 key | 新纯函数测 |
| 舱壁 | 画布子树 throw，壳上仍有「保存」或顶栏角色 | S1-B |

默认仍 **禁止** 实现卡跑 `npm test` / e2e / `build:desktop`。S1-F 只跑上表文件。全量仍归日后的稳定性收口（类 T6），不在中间波次。

---

## 9. 建议实现顺序与停手

1. 合入 S1-A → 教师侧英文 stale 先消失（最大 C 类感知）。
2. 合入 S1-B → 局部 throw 不再整窗死。
3. 合入 S1-C → 闪白/双 GPU。
4. 合入 S1-D → 恢复与画布读错课。
5. 合入 S1-E → 消灭测试/产品 Host 分叉 + 编辑图空白。
6. S1-F 把护栏锁上。

停手：

- 为实现某条去改 V9 判别器。
- 为实现某条把 Phaser 接回试运行。
- S1-C 若发现 sleep API 在当前 Phaser 版本不存在：用 `scene.sys.game.loop.sleep` 的等价物；没有则 **暂停 RAF 的最小包装**，不要升级 Phaser 大版本。
- 导出改读源导致 typecheck 扩散出任务允许文件：停，HANDOFF，下一张卡扩名单。

---

## 10. 成功标准（实现完成后）

- A：子树崩溃有舱壁；根 boundary 仍是最后手段；诊断仍写入。
- B：产品与测试试运行同一 CoursePlayer 工厂；编辑态媒体 URL 不提前 revoke；恢复调度跟 V9 revision。
- C：教师不再看到 `stale-revision` / `locked` 英文码；失败不丢课、不推进 revision。
- 内核文件仍巨大，但 **第二写入者** 减少：错误只经分类器、Host key 只经纯函数、字节只经 sidecar+registry。
- 没有声称 Editor 1.0 `accepted`。

档 3（物理拆分 Store/Workspace）只有在 S1-F 绿、且功能卡能在不改 `apply*Backend` 的情况下完成时才允许另写 S2。
