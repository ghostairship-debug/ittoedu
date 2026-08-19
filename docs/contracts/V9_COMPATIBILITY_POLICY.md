# Course Project V9 兼容性与演进策略

> 本文档规范 Course Project V9 的版本演进规则、格式兼容边界与向后兼容承诺。
> 权威类型定义以 `src/shared/contracts/course-project-v9/` 与 `src/shared/contracts/published-course-v2/`（旧路径保留 re-export 桩）为准。

---

## 1. 核心协议与版本基线

当前产品的协议版本基线如下：

| 协议域 | 当前版本 | 权威常量 / 判别器 | 演进规则 |
|---|---|---|---|
| **Course Project** | Schema 9 | `COURSE_PROJECT_SCHEMA_VERSION = 9` | 1.0 之后仅允许增量添加（additive） |
| **Published Course** | Version 2 | `PUBLISHED_COURSE_VERSION = 2` | 独立升级发布格式 |
| **Runtime Protocol** | API 2 / 3 | `runtimeApiVersion: 2 \| 3` | 支持 canvas-runtime 2 与 surface-runtime 3 |
| **Component Protocol** | API 4 | `apiVersion: 4` | 独立升级组件规范 |

### 关于历史常量说明
- `src/shared/constants.ts` 中的 `PROJECT_SCHEMA_VERSION = 8` 是历史 V8 遗留形状常量，**不是当前工程版本**。当前工程格式唯一真相为 `COURSE_PROJECT_SCHEMA_VERSION = 9`。
- 产品 `package.json` 版本为 `1.0.0`；在完成合同冻结与教师验收前，**不得宣称 Editor 1.0 已发布**。

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

## 3. V9 增量演进承诺（Additive Policy）

在 Editor 1.0 冻结及后续 1.x / 2.x 生命周期中，对 Course Project V9 做出以下兼容承诺：

1. **完全向后兼容**：必须能够读取所有合法生成的 V9 工程。
2. **禁止破坏性变更**：不得修改已有字段的命名、类型与判别器语义。
3. **不得静默丢弃字段**：工程读写、序列化与反序列化过程必须完整保留已有合法字段。
4. **允许增量可选字段（Additive）**：
   - 允许新增非破坏性可选字段。
   - 例如：`SpatialSurfaceDocument.backgroundColor?` 与 `FlowSurfaceDocument.backgroundColor?`，缺省时一律由引擎与编辑器视作白底（`#ffffff`）。
   - 例如：`TextRunStyle.fontFamily?` 与 `TextRunStyle.fontSize?`，缺省时不覆盖宿主文字样式。
   - 例如：Flow heading / paragraph / quote 块的 `textAlign?` 与 `lineSpacing?`，缺省时沿用默认段落对齐与行距。
   - 例如：`FlowMediaBlock.wrap?` 与 `FlowComponentBlock.wrap?`，缺省时表示不绕排（`none`）。
   - 例如：`LayerItemBase.paperSpace?` 与 `PublishedLayerItemBase.paperSpace?`，缺省时为视口坐标定位（`viewport`）。
5. **合同严格性**：核心 Schema 禁止使用 `.passthrough()` 或 `z.unknown()` 弱化类型校验。

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
