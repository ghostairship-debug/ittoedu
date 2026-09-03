# Course Project V9 兼容性与演进策略

> 本文档规范 Course Project V9 的版本演进规则、格式兼容边界与向后兼容承诺。
> 权威类型定义以 `src/shared/contracts/course-project-v9/` 与 `src/shared/contracts/published-course-v2/` 为准；当前仍存在的旧路径 re-export 桩只是 1.1 迁移中间态，真实 consumer 清零后必须删除，不形成长期兼容路径。
>
> **软冻结（2026-08-19）**：Course Project V9 作者工程合同已软冻结。已有字段、判别器和语义不得改；只允许声明过的可选增量字段，以及 Owner 逐项批准并在本文登记的窄联合类型例外。不承诺旧编辑器打开含新键或新分支的课。本冻结不等于 Editor 1.0 已发布。Published Course V2、Runtime、Component 不在本次冻结范围内。

---

## 1. 核心协议与版本基线

当前产品的协议版本基线如下：

| 协议域 | 当前版本 | 权威常量 / 判别器 | 演进规则 |
|---|---|---|---|
| **Course Project** | Schema 9 | `COURSE_PROJECT_SCHEMA_VERSION = 9` | **已软冻结**：已有字段锁死；允许 additive 可选字段及本文登记的 Table/Chart strict discriminator 窄例外 |
| **Published Course** | Version 2 | `PUBLISHED_COURSE_VERSION = 2` | Table/Chart 使用匹配 strict 分支窄扩展，并与匹配 Player 成对交付 |
| **Runtime Protocol** | API 2 / 3 | `runtimeApiVersion: 2 \| 3` | 支持 canvas-runtime 2 与 surface-runtime 3 |
| **Component Protocol** | API 4 | `apiVersion: 4` | 独立升级组件规范 |

### 关于历史常量说明
- 1.1 执行前若 `src/shared/constants.ts` 中仍存在 `PROJECT_SCHEMA_VERSION = 8`，它只是待清零的历史 V8 遗留形状常量，**不是当前工程版本**。当前工程格式唯一真相为 `COURSE_PROJECT_SCHEMA_VERSION = 9`；1.1 完成时可执行代码、测试、脚本、示例、fixture、artifacts 与正式生成制品中不得再保留该旧格式常量或 consumer。
- 产品 `package.json` 版本为 `1.0.0`；V9 Schema 软冻结不等于产品发布。教师 `accepted` 前，**不得宣称 Editor 1.0 已发布**。

---

## 2. 工程打开与导入策略

- **唯一可打开格式**：仅支持打开 `schemaVersion: 9` 的 Course Project 工程。
- **废弃 V8 导入**：不打开、不导入旧版 V8 `.h5lesson` 工程文件。密封导入器与迁移 UI 已从主流程移除。
- **工程校验判别**：
  - `schemaVersion === 9`：合法 V9 工程。
  - `schemaVersion` 为非 9 的其他整数：判定为 `unsupported`。
  - 缺失 `schemaVersion` 或 JSON 结构损坏：判定为 `corrupted`。
- **新建工程**：空白工程直接构造 V9 数据模型，禁止调用 V8 迁移函数。
- **1.1 清零不是迁移支持**：1.1 删除可执行范围中的 V8 模型、Schema、archive、Player/Export payload、fixture 和测试工具链，但不恢复 V8 打开或导入。每个受支持行为必须先迁移到等价 V9/Published consumer，任何中间提交不得以删入口、删测试、删导出、静态化动态内容或 silent fallback 换取清零。

---

## 3. V9 软冻结承诺（Additive Policy）

本产品对内使用；即使日后对外，也按联网、持续更新分发，不要求用户长期停留在旧安装上。因此 **不承诺旧编辑器打开含更新可选键的新课**。顶层仍是 `.strict()`：新键必须先写进 Schema 再落文件，禁止用 `.passthrough()` / `z.unknown()` 偷加。

当前编辑器对 Course Project V9 的承诺：

1. **向后兼容（硬要求）**：必须读取所有在软冻结时点及之后仍合法的 V9 工程。缺可选字段时用已文档化的缺省（例如 Spatial/Flow 缺 `backgroundColor` 视为 `#ffffff`）。
2. **已有合同锁死**：不得修改已有字段的命名、类型、判别器和语义；不得重新解释 location、图层 owner、统一图层顺序、presentation state、稳定 ID。
3. **不得静默丢弃字段**：读写与序列化必须完整保留已有合法字段。
4. **允许增量可选字段（Additive）**：
   - 仅允许新增非破坏性可选字段，并写明缺省。
   - 已落地的例子：`SpatialSurfaceDocument.backgroundColor?` 与 `FlowSurfaceDocument.backgroundColor?`，缺省视为 `#ffffff`。
   - 已落地的例子：`TextRunStyle.fontFamily?` 与 `TextRunStyle.fontSize?`，缺省时不覆盖宿主文字样式。
   - 已落地的例子：Flow heading / paragraph / quote 块的 `textAlign?` 与 `lineSpacing?`，缺省时沿用默认段落对齐与行距。
   - 已落地的例子：`FlowMediaBlock.wrap?` 与 `FlowComponentBlock.wrap?`，缺省时表示不绕排（`none`）。
   - 已落地的例子：`LayerItemBase.paperSpace?` 与 `PublishedLayerItemBase.paperSpace?`，缺省时为视口坐标定位（`viewport`）。
   - 已落地的例子：`GlobalLayerEntry.plane?`，缺省按 3.2 节的冻结 legacy global 顺序解析为 `underlay` / `overlay`。
   - additive 仍是合同变更：单独提交、更新 `artifacts/contracts/`，不得混进教师手感/UI 提交。
5. **不承诺旧二进制前向兼容**：含新可选键的课，未更新的编辑器可以因 `.strict()` 拒收。用户应更新到当前版本。
6. **产品约定不是 Schema 收紧**：例如编辑器把 `startLocationId` 同步为大纲第一页，不得改成 Schema 新不变量去卡旧课。
7. **窄联合类型例外必须逐项登记**：新增 discriminator 不是普通 additive 字段；只有本文记录的 Owner 决定才可实施，且必须保持旧 V9 可读、新分支 strict、旧 reader fail loud、作者与 Published 有效域闭合。一次例外不授权未来其它 discriminator。

### 3.1 2026-08-28 Owner 批准的 Interaction 窄扩展

产品 Owner 明确批准在现有 Interaction Protocol V1 联合类型中增加三个严格分支：条件 `course-state.exists`、`course-state.compare`，以及动作 `course-state.set`。这次扩展不改写任何已有字段、判别器或语义，也不改变 `schemaVersion: 9`、Published Course V2、Runtime API 2/3 或 Component API 4；未使用新分支的既有 V9 工程行为不变。

该决定是软冻结后的显式合同例外，不构成以后任意扩展判别器的通行授权。含新分支的工程会被不了解这些判别器的旧编辑器按严格 Schema 拒绝；这是已披露的前向兼容结果，用户须使用当前编辑器打开。increment/delete、表达式、工作流引擎与判题结果自动桥仍不在本次批准范围内。

### 3.2 2026-09-01 Owner 批准的全局平面窄扩展

产品 Owner 明确批准为 `globalLayerItems` 增加可选 `plane: 'underlay' | 'overlay'`，Published Course V2 增加对等可选字段。该字段把 global owner 与相对页面内容的视觉平面分开：有效顺序固定为 global Underlay → 当前 surface/scene/world 内容 → global Overlay；`order` 不再作为 global 与本地内容之间的比较键，跨 owner 的相同 `order` 合法。

缺字段的旧 V9 / Published V2 保持可读，并使用冻结兼容规则：教师控制器固定为 Overlay；存在全局控制器时，按旧 global `order + layerItemId` 排在控制器之前的项解析为 Underlay，控制器及其后的项解析为 Overlay；不存在控制器时解析为 Overlay。该缺省不读取本地内容的最小 `order`，因此后续新增、删除或重排页面内容不会翻转 global 平面。新的作者命令与 Published producer 应物化显式 plane；教师控制器显式 Underlay 必须拒绝。

这是软冻结后的显式合同例外，不改变 `schemaVersion: 9` 或 `formatVersion: 2`，不授权为 surface/scene/world 项增加同名字段，也不引入全局项与本地项逐项交错排序。

### 3.3 2026-09-02 Owner 批准的 Table/Chart strict discriminator 窄扩展

产品 Owner 明确批准在 Course Project V9 的 `NativeElementContent` 严格联合类型中增加 `nativeType: 'table'` 与 `nativeType: 'chart'` 两个新分支，并在 Published Course V2 增加语义对等的严格分支。作者工程继续使用 `schemaVersion: 9`，发布继续使用 `formatVersion: 2`；不为这两个能力创建 V10 或 Published V3。

该例外必须同时满足：

1. 不修改既有六种 Native 的字段、判别器、缺省或语义；所有既有合法 V9 工程继续读取且行为不变。
2. Table/Chart 各自使用可完整表达数据、样式和稳定子项 ID 的 `.strict()` Schema，不使用 `.passthrough()`、`z.unknown()`、任意 JSON bag 或 Shape/截图替代作者真相。
3. Table/Chart 不加入 legacy `SceneNode` / `SCENE_NODE_TYPES`。V9 Native data materializer、presentation `nativeData` override 校验与生成合同必须脱离旧 Scene Schema，同时保持既有 presentation override 合并语义不变。
4. 含新分支的工程由不了解该分支的旧编辑器明确拒绝；不得静默丢字段、跳过元素、改写为旧类型或覆盖原工程。旧编辑器前向不兼容是已披露结果，用户须使用匹配版本。
5. Published V2 payload 与匹配 Player 成对交付；旧 V2 reader/Player 遇到新分支必须明确失败，不承诺前向兼容，也不得静默隐藏或仅以无提示静态占位冒充支持。
6. 作者 UI、Authoring Tools、保存重开、Preview、Published Player、HTML 和适用导出必须形成有效域闭环；静态格式不能完整表达时必须给出可见诊断或明确降级，不能丢数据。
7. Course Project Schema、Published Schema、类型、生成合同、兼容政策和旧 reader 反例必须作为可整体审阅的合同变更交付；Table 与 Chart 的产品实现可分片，但任何分片不得提前宣称完整可用。

本节只批准 Table/Chart 两个明确分支，不构成新增其它 Native、Interaction、Surface 或 Published discriminator 的通行授权。

---

## 4. V10 大版本迁移边界

任何无法通过 V9 增量表达的破坏性数据模型变更，必须进入 Course Project V10，不得在 V9 内破坏现有语义。包括但不限于：

- 引入无法由现存三种 surface（`slide`、`flow`、`spatial-2d`）表达的全新表面范式。
- 改变 Location、Layer Owner 归属逻辑或重新定义图层统一排序算法。
- 改变 Presentation State 覆写（`layerItemOverrides`）合并规则。
- 改变稳定标识（`layerItemId` / authoringAddress）生命周期定义。
- 引入必须持久化至工程文件的完整协同模型或强制时间轴模型。
- 删除或重解释现有必填字段。

1.1 对 V8 可执行残留的清零只是删除不受支持的旧实现并迁移现有 consumer，不改变 V9 wire；Table/Chart 则由 3.3 节的明确窄例外覆盖。两者都不是创建 V10 的理由。

> 注：Editor 1.0 不承诺读取未来的 V10+ 工程。
