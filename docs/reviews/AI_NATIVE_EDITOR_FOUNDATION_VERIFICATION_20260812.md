# AI-native 编辑器基建验证记录

> 日期：2026-08-12
>
> 对应路线：当时的多表面计划已删除；现行总纲见根目录 [COURSEWARE_DEVELOPMENT_PLAN.md](../../COURSEWARE_DEVELOPMENT_PLAN.md)
>
> 当前状态：**软件本体实现与自动化验收完成，签发为 `engineering candidate`；不是产品完成或发布签发**
>
> 范围：软件本体。未修改 `.agents/**`、创作工作流、Skills 或正式课例。

> 当前性说明：本文冻结身份断代前的 AI-native 基建批次。产品身份与 Headless 校验先以 [身份断代验证记录](PRODUCT_IDENTITY_RENAME_VERIFICATION_20260812.md) 为准；组件事实又被 [组件库收敛验证记录](COMPONENT_LIBRARY_CONSOLIDATION_VERIFICATION_20260813.md) 更新。不得把本文的九包数据或测试数字当作当前最终基线。

## 1. 结论边界

本轮解决的是 AI 理解和修改软件工程时的基础可靠性：类型/Schema 漂移、E2E 类型盲区、素材引用与撤销不一致、不可达视觉实现造成的真假入口，以及能力发现成本。它没有把 AI 模型接进编辑器，也没有恢复 Project V8 课件生成 Skill。

最终确认的实现状态：

- P0–P4 已落地并通过最终工程验证；
- P1 的两个方向均做过临时突变并被编译期合同捕获，恢复后全量类型与单元测试通过；
- P4 的确定性、过期/超限、interaction discriminator、九包校验与目录降级夹具均已通过；
- P5 只完成 RFC 与测试目录内存原型，明确停在生产实现门禁；
- 当前工作树的隐藏 Electron E2E 为 27/27：组件矩阵 2/2、编辑器 24/24、render-host 1/1；
- 即使全部工程验证通过，Pipeline 最多仍为 `engineering candidate`；Outcome 也只能是 `engineering candidate`，不是 `accepted`、发布就绪或真实课件质量结论。

## 2. P0：可恢复证据

检查点历史路径为 `artifacts/worktree-checkpoints/20260812-implementation-start/`；该临时目录不在当前工作树，证据由 Git 历史保留。当时未改变 Git 暂存区、未提交、未清理用户工作树。

| 证据 | 当前记录 |
|---|---|
| HEAD / 分支 | `e938433c271c65f501fff6e78375589a2fd337db` / `main` |
| 建立时间 | `2026-08-12T16:42:09.1451293+08:00` |
| 状态数量（排除检查点） | 228；tracked 162，untracked 66 |
| tracked patch | 10,418,024 bytes；SHA-256 `a0deb443189ec1c6b3f650299ab379d140b2ce6dc22b0fce9295bd2de55b33ad` |
| untracked ZIP | 223,323 bytes；SHA-256 `fe60be5e3f2c15a6fed556da0942cbcfb8db331fe602a802c6c76fb80ea1b000` |
| 组件 catalog | SHA-256 `407aa7311f115c80df9f37ef284302531765ccfaee197fd248e2104975063a3e`；9 个包 |
| 项目进程 | 建立检查点时无本项目 Electron/Playwright 残留 |

历史检查点中的 `component-release-status.json` 记录九个包全部为 `experimental`、维护人为 `unassigned`、许可状态为 `unknown`；该临时文件不在当前工作树，需从 Git 历史核查。两项语文标注保留许可/维护人阻断；七个视觉容器还保留素材许可与来源阻断。后续能力清单不会解除这些门禁。

## 3. P1：类型与 E2E 门禁

### 3.1 Project V8 双向一致性

[`projectSchemaTypeContract.ts`](../../src/shared/projectSchemaTypeContract.ts) 以 `z.output<typeof projectDocumentSchema>` 得到 Schema 输出，并同时断言：

1. Schema 输出可赋给 `ProjectDocument`；
2. `ProjectDocument` 可赋给 Schema 输出。

这是一份编译期专用合同，不改变运行时或 Project V8 数据。最终验证曾临时删除 Zod 根 `designTokens`，以及给 `ProjectDocument` 增加必填 `__schemaContractProbe` 字段；两次均稳定触发 [`projectSchemaTypeContract.ts`](../../src/shared/projectSchemaTypeContract.ts) 的 `TS2344` 双向合同失败。两处探针随后恢复，仓库中不保留 `__schemaContractProbe`，正式类型检查全绿。

### 3.2 E2E 类型检查

[`tsconfig.e2e.json`](../../tsconfig.e2e.json) 独立包含 `tests/e2e`、helper、Playwright 配置与所需共享/Player 声明，避免把 Playwright 全局类型污染普通 Vite/Vitest 编译上下文。`npm run typecheck` 当前顺序为普通 TypeScript、Electron TypeScript、E2E TypeScript；该命令本身不启动 Electron。

[`tests/e2e/window.d.ts`](../../tests/e2e/window.d.ts) 为页面桥、Player、场景和运行时探针提供显式 Window 类型。最终验证仍必须证明类型修复没有改变隐藏 E2E 行为。

## 4. P2：素材引用、删除与事务

### 4.1 唯一引用事实源

[`assetReferences.ts`](../../src/shared/assetReferences.ts) 返回带 `path`、scene/state/node/package 上下文与 `direct | conservative` 确定性的引用分析。覆盖：

- 基础/命名状态背景、基础节点与命名状态 `nodeOverrides`；
- 全局层、声音目录；
- 场景/全局 Runtime 的绑定、`staticFallback`、内容值与可识别源码字面量；
- 外部组件基础/状态 Props、公开 `image` 属性、有效默认值；
- 提供组件包上下文时的组件 Runtime source。

缺少组件包上下文时，删除安全路径保守标记可能引用并报告上下文不足，不会把“无法分析”错误降级为“未使用”。删除保护、工程归档校验、Project Health 与网页发布资源投影由这份引用图派生；禁用 Runtime 不进入实际网页发布投影，但仍保留作者工程数据和删除保护，两种语义分开处理。

### 4.2 素材历史事务

单项图片/视频/声音导入、只入库、图片替换和未引用素材删除均通过既有 `assetFileChanges` 历史机制提交。一个 HistoryEntry 同步保存：

- Project 引用与素材元数据；
- 新旧实际字节；
- Undo/Redo 所需 before/after 状态。

复用已有素材时，Undo 只回滚本次新增引用；替换素材时 Undo 恢复旧元数据与旧字节；未引用素材删除可以 Undo 恢复并 Redo 再删。存在 direct 或 conservative 引用时删除被阻止，并给出位置。

### 4.3 诊断

[`diagnosticCodes.ts`](../../src/shared/diagnosticCodes.ts) 是 Project Health 与 Export Preflight 的类型化 code 注册表。Project Health 新增 `asset-unused` 信息项；Export Preflight 排除逐素材噪声，只生成 `asset-unused-summary` 数量/字节聚合说明。`.h5lesson` 是否裁剪孤儿素材仍是独立兼容决策，本轮没有静默改变工程归档语义。

主要回归位于 [`assetReferences.test.ts`](../../tests/unit/assetReferences.test.ts)、[`assetTransactions.test.ts`](../../tests/unit/assetTransactions.test.ts)、[`editorStore.test.ts`](../../tests/unit/editorStore.test.ts) 与 [`projectArchive.test.ts`](../../tests/unit/projectArchive.test.ts)。最终全量命令结果见第 8 节。

## 5. P3：统一画布死实现清理

当前 `src/renderer/phaser/adapters/` 只保留 `NodeAdapter.ts` 与 `ProxyNodeAdapter.ts`。隔离 Player 继续作为编辑/播放唯一视觉真相；透明 Phaser 只负责命中、选择与几何变换。

已删除或收敛的不可达链路包括：

- Text、Formula、Image、Video、Shape、TeacherController、ExternalComponent 的编辑器侧视觉分支；
- 旧 Phaser `ComponentRegistry`，但保留 Player 和 renderer component runtime 的活注册表；
- 未渲染的 `ComponentTextEditOverlay` 与旧 Canvas 文字目标/bridge；
- 恒为 no-op 的文字 preview 链；
- 只服务旧 Video adapter 的 `videoPosterLayout`；
- 只保护上述死实现的 `componentTextEditOverlay.test.tsx`、`externalComponentNodeAdapterV4.test.ts` 与 `videoPosterLayout.test.ts`。

需要在最终隐藏 E2E 中保留的行为是：原生文字/公式双击、组件 authoring 文字、选择/拖动/缩放/旋转、多选/对齐/Undo/Redo、图片/视频/组件/全局层，以及 Player 与编辑画布视觉一致性。删除文件数或测试数本身不是验收证据。

## 6. P4：分层 AI 能力清单

[`generate-ai-capabilities.ts`](../../scripts/generate-ai-capabilities.ts) 从公开 Zod JSON Schema、协议/限制常量、互动 discriminator 注册表、类型化诊断码和受校验外部 catalog 生成：

```text
artifacts/ai-capabilities/
  index.json
  schemas/project-v8.json
  schemas/interactions.json
  schemas/runtime-api2.json
  schemas/component-api4.json
  diagnostics.json
  limits.json
  component-catalog.snapshot.json
  generation-evidence.json
```

[`index.json`](../../artifacts/ai-capabilities/index.json) 是渐进披露入口，文档审计时为 5,079 bytes，低于固定 16,384 bytes 上限。下级生成物和索引分别记录 SHA-256，避免自哈希循环；相同输入不写时间或绝对路径。命令为：

```powershell
npm run generate:ai-capabilities
npm run check:ai-capabilities
```

当前组件快照校验九个实际包字节与 catalog/manifest，并原样保留 `quality`、source、license、maintainer 与 `releaseBlockers`。catalog 缺失、不受信任或包/manifest 不匹配时，核心契约仍可生成，但组件快照和索引必须明确 `unavailable`/降级，不能伪装为可信能力。

该目录不是编辑器内 AI、自动课件生成器、工作流或 Project V8 实现 Skill。它只描述当前软件能够接受和执行的契约；不能据此绕过编排门禁，也不能把 `experimental` 组件写成稳定能力。

最终验证已覆盖两次生成字节一致、`--check` 通过、过期/超限失败、interaction discriminator 漂移失败、当前九包哈希与阻断完整，以及 catalog 缺失和哈希不匹配的降级夹具。当前 [`index.json`](../../artifacts/ai-capabilities/index.json) 为 5,079 bytes。

## 7. P5：声明式课程状态 RFC

[声明式课程状态与导航守卫 RFC](DECLARATIVE_COURSE_STATE_RFC_20260812.md) 的结论仍是“方向可行，协议未获批准”。它提出已声明 JSON 安全标量、严格比较、set/increment/delete、block-only 导航守卫、入口矩阵、capture 冻结建议与 Runtime 重定向后重检，但这些都不是当前 Project V8 能力。

测试目录原型 [`declarativeCourseStatePrototype.ts`](../../tests/prototypes/declarativeCourseStatePrototype.ts) 与 [`declarativeCourseStatePrototype.test.ts`](../../tests/unit/declarativeCourseStatePrototype.test.ts) 覆盖 attempts 原子递增、普通/强制导航入口、restart 默认值、authoring/capture 冻结提案和非法 key/type/非有限数拒绝。没有生产模块导入原型，没有修改 Project Schema、InteractionEngine、作者 UI 或导出。

仍需人类决定：Project V8 未冻结扩张还是 Project V9、capture 是否冻结、Runtime 重定向后的重检、阻断反馈、诊断/UI/导出合同，以及三个夹具能否代表真实教学需求。未批准前必须停止在 RFC。

## 8. 最终验证

以下结果来自所有并行修改收口后的当前工作树。Electron/Playwright 始终显式设置 `COURSEWARE_E2E_BACKGROUND=1`；未运行 visible 模式。

| 验证 | 最终结果 | 实际数量/耗时 | 备注 |
|---|---|---|---|
| P1-A 两次临时突变 | 通过（均按预期失败） | 2/2 | Schema→类型、类型→Schema 均触发 `TS2344`；恢复后无探针残留 |
| `npm run typecheck` | 通过 | 3 个 TypeScript 配置 | 普通、Electron、独立 E2E；不启动 Electron |
| `npm test` | 通过 | 123 个文件 / 777 项测试 | 包含 P1–P5 与编辑预览 watchdog 回归 |
| `npm run build:desktop` | 通过 | Player / Renderer / Electron | 生产构建完成，仅保留既有 chunk warning |
| `npm run verify:component-catalog` | 通过 | 9 个 Component API 4 包 | 实际哈希匹配；`experimental` 与许可/来源/维护人阻断保留 |
| `npm run check:ai-capabilities` | 通过 | 索引 5,079 bytes | 确定性、过期、降级与 16 KiB 上限有单测门禁 |
| `git diff --check` | 通过 | 不适用 | 未暂存、提交、重置或清理用户变更 |
| 隐藏 Electron E2E | 通过 | 27/27 | 组件矩阵 2/2；编辑器 24/24 + render-host 1/1 为 19.7 分钟 |

最终 E2E 的所有 BrowserWindow 都由测试断言保持隐藏、不聚焦、不进入任务栏。验证中还修正了三个不会削弱业务断言的问题：render-host 测试不再依赖未公开的全局 `Phaser`；当前位置试运行从目标 iframe 的 DOM 身份直接绑定其 `contentFrame`，不再把 Blob URL 的逐字相等误当产品合同；隐藏 Electron 中编辑动画的 Phaser tween 若长期饥饿，authoring-only wall-clock watchdog 会恢复作者稳定帧，交付 Player 的普通 `play()` 语义不变。缩放/对齐用例只扩大了局部总预算以允许清理完成，全部几何和错误数组断言保留。

## 9. 剩余风险与门禁

- 当前工作树包含大量用户既有改动，HEAD 不是完整软件状态；不得擅自 stage、commit、reset、clean 或移动文件。
- 九组件仍全部为 `experimental`，许可、素材来源和维护人阻断未解除。
- 真实教师公式任务、中文输入法、读屏、低配机器、100 卡片 UI 和干净 Windows 启动仍需人工结果验收。
- `.h5lesson` 孤儿素材裁剪、声明式 courseState、导航守卫和 capture 冻结均未作为当前能力交付。
- 工作流、Skills、Project V8 实现 Skill 和真实课例不在本轮范围；生成能力索引不能替代这些工作。

因此，完成最终工程验证后的允许签名仍是：

- Pipeline：`engineering candidate`；
- Outcome：`engineering candidate`；
- 产品/课例：未 `accepted`，未发布就绪。
