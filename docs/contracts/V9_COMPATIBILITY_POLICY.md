# Course Project V9 兼容性与演进策略

> 本文档规范 Course Project V9 的版本演进规则、格式兼容边界与向后兼容承诺。
> 权威类型定义以 `src/shared/contracts/course-project-v9/` 与 `src/shared/contracts/published-course-v2/`（旧路径保留 re-export 桩）为准。
>
> **软冻结（2026-08-19）**：Course Project V9 作者工程合同已软冻结。已有字段、判别器和语义不得改；允许声明过的可选增量字段。不承诺旧编辑器打开含新键的课。本冻结不等于 Editor 1.0 已发布。Published Course V2、Runtime、Component 不在本次冻结范围内。

---

## 1. 核心协议与版本基线

当前产品的协议版本基线如下：

| 协议域 | 当前版本 | 权威常量 / 判别器 | 演进规则 |
|---|---|---|---|
| **Course Project** | Schema 9 | `COURSE_PROJECT_SCHEMA_VERSION = 9` | **已软冻结**：已有字段锁死；仅允许 additive 可选字段 |
| **Published Course** | Version 2 | `PUBLISHED_COURSE_VERSION = 2` | 独立升级发布格式（本次未冻） |
| **Runtime Protocol** | API 2 / 3 | `runtimeApiVersion: 2 \| 3` | 支持 canvas-runtime 2 与 surface-runtime 3 |
| **Component Protocol** | API 4 | `apiVersion: 4` | 独立升级组件规范 |

### 关于历史常量说明
- `src/shared/constants.ts` 中的 `PROJECT_SCHEMA_VERSION = 8` 是历史 V8 遗留形状常量，**不是当前工程版本**。当前工程格式唯一真相为 `COURSE_PROJECT_SCHEMA_VERSION = 9`。
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
   - additive 仍是合同变更：单独提交、更新 `artifacts/contracts/`，不得混进教师手感/UI 提交。
5. **不承诺旧二进制前向兼容**：含新可选键的课，未更新的编辑器可以因 `.strict()` 拒收。用户应更新到当前版本。
6. **产品约定不是 Schema 收紧**：例如编辑器把 `startLocationId` 同步为大纲第一页，不得改成 Schema 新不变量去卡旧课。

### 3.1 2026-08-28 Owner 批准的 Interaction 窄扩展

产品 Owner 明确批准在现有 Interaction Protocol V1 联合类型中增加三个严格分支：条件 `course-state.exists`、`course-state.compare`，以及动作 `course-state.set`。这次扩展不改写任何已有字段、判别器或语义，也不改变 `schemaVersion: 9`、Published Course V2、Runtime API 2/3 或 Component API 4；未使用新分支的既有 V9 工程行为不变。

该决定是软冻结后的显式合同例外，不构成以后任意扩展判别器的通行授权。含新分支的工程会被不了解这些判别器的旧编辑器按严格 Schema 拒绝；这是已披露的前向兼容结果，用户须使用当前编辑器打开。increment/delete、表达式、工作流引擎与判题结果自动桥仍不在本次批准范围内。

---

## 4. V10 大版本迁移边界

任何无法通过 V9 增量表达的破坏性数据模型变更，必须进入 Course Project V10，不得在 V9 内破坏现有语义。包括但不限于：

- 引入无法由现存三种 surface（`slide`、`flow`、`spatial-2d`）表达的全新表面范式。
- 改变 Location、Layer Owner 归属逻辑或重新定义图层统一排序算法。
- 改变 Presentation State 覆写（`layerItemOverrides`）合并规则。
- 改变稳定标识（`layerItemId` / authoringAddress）生命周期定义。
- 引入必须持久化至工程文件的完整协同模型或强制时间轴模型。
- 删除或重解释现有必填字段。

> 注：Editor 1.0 不承诺读取未来的 V10+ 工程。
