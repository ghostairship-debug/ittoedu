# Course Project Validation Report V1

本文冻结 `npm run --silent validate:course-project -- <project.h5lesson>` 当前已经公开的机器可读报告。权威实现是 `scripts/validate-project.ts`；稳定诊断 target、fatal code 与 finding code ledger 的权威定义是 `src/shared/courseProjectValidationDiagnostics.ts`。本合同不修改 Course Project V9 或 Published Course V2 Schema，也不承诺完整的 V9 工程健康分析。

## 1. 版本与顶层形状

`reportVersion` 固定为 `1`。顶层恰有以下 13 个字段：

```text
reportVersion, status, input, measurement, schema,
project, projectHealth, exportPreflight, protocols,
stableIds, migrationMarkers, summary, fatal
```

字段语义：

- `status`: `valid | invalid | unreadable`。
- `input`: `{ filename }`，只包含输入文件名，不暴露绝对路径。
- `measurement`: `{ mode, note }`，说明浏览器 Canvas 或确定性 Node 后备测量。
- `schema`: `{ valid, schemaVersion, issues }`；每个 issue 为 `{ path, code, message }`，其中 `code` 来自当前 Zod issue code，不另造第二套枚举。
- `project`: Schema 合法时提供工程 ID、标题及 location/surface/asset/component 数量。
- `projectHealth`: Schema 合法时提供当前已接线的结构性 finding 与汇总；它不是宽泛的全工程健康承诺。
- `exportPreflight`: Schema 合法时固定包含 `single-html`、`web-package`、`pdf`、`pptx` 四个目标报告。
- `protocols`: Schema 合法时报告当前 project/published/runtime/component/interaction 版本。
- `stableIds`: Schema 合法时报告现有 stable-ID guard 的结果。
- `migrationMarkers`: Schema 合法时报告现有迁移标记 guard 的结果。
- `summary`: `{ error, warning, info, total, canExport }`。
- `fatal`: 不可读时提供 `{ code, title, message, suggestion? }`，否则为 `null`。

序列化会递归按稳定字符串顺序排列对象键并追加单个换行；finding、Schema issue 和其他数组的既有顺序保持不变。

## 2. Schema-invalid 与退出码

Schema-invalid V9 必须满足以下全部条件：

- `status === "unreadable"`；
- 进程退出码为 `2`；
- `schema.valid === false`，`schema.schemaVersion === 9`，并保留 Zod issues 的原始 `path/code/message`；
- `project`、`projectHealth`、`exportPreflight`、`protocols`、`stableIds`、`migrationMarkers` 六个语义分区全部为 `null`；
- `summary` 为 `error=0, warning=0, info=0, total=0, canExport=false`；
- `fatal.code === "schema-invalid"`；
- 不解析 `DiagnosticTargetV1`，Schema issue 与 fatal 均没有 `target`。

退出码合同：

- `0`: 报告可读且 `summary.canExport === true`；
- `1`: 报告可读但当前已接线 finding 含 error；
- `2`: usage、输入、版本、archive、Schema 或校验执行失败导致 `unreadable`。

fatal code 固定为：

```text
archive-invalid, input-unreadable, schema-invalid,
unsupported-project-version, usage-error, validation-failed
```

## 3. Finding 与 DiagnosticTargetV1

V1 finding 的既有字段保持不变：

```text
severity, code, message, path?, surfaceId?, layerItemId?
```

本合同只 additive 增加可选的 `target?: DiagnosticTargetV1`。不得删除或重写既有 `path`、metadata、code、message、severity，也不得改变 finding 数量或顺序。target 只在成功解析出 Schema 合法的 `CourseProjectDocument` 后生成；无法精确定位时使用 project target。

所有 target 都包含：

```json
{ "version": 1, "projectId": "stable-project-id", "kind": "..." }
```

`kind` 与额外稳定身份如下：

| kind | 额外字段 |
| --- | --- |
| `project` | 无 |
| `asset` | `assetId` |
| `component-package` | `packageId`, `packageVersion` |
| `location` | `locationId` |
| `surface` | `surfaceId` |
| `scene` | `surfaceId`, `sceneId` |
| `flow-block` | `surfaceId`, `blockId` |
| `layer-item` | `owner`, `layerItemId`，并按 owner 带 `surfaceId` / `sceneId` |

`layer-item.owner` 为 `global | surface | scene | world`。target 不持久化数组下标、DOM id、hitId 或绝对路径；resolver 只把 path 下标当作读取当前 Schema 合法文档的瞬时线索。stable ID 冲突导致 metadata 定位歧义时不得猜测，必须回退 project target。

## 4. Finding code ledger

状态定义：

- `active`: 存在当前 Schema 合法 archive 可到达的生产路径；
- `schema-shadowed`: 已有 code 保留兼容，但已知输入会先被 Course Project V9 Schema 拒绝；
- `archive-shadowed`: 已有 code 保留兼容，但已知输入会先被 archive/component 完整性检查拒绝；
- `upstream-filtered`: 上游定义了 code，但 CLI 的当前调用模式不会把它传入报告。

| code | 状态 | 当前事实 |
| --- | --- | --- |
| `asset-byte-length-mismatch` | archive-shadowed | archive 打开先校验素材字节长度 |
| `asset-bytes-missing` | archive-shadowed | archive 打开先要求全部声明素材字节 |
| `asset-metadata-missing` | schema-shadowed | V9 Schema 先校验素材引用闭包 |
| `component-asset-bytes-missing` | archive-shadowed | 组件包解析先校验 manifest 素材 |
| `component-bytes-missing` | archive-shadowed | archive 打开先要求并解析组件包 |
| `component-hash-mismatch` | archive-shadowed | archive 打开先校验组件内容哈希 |
| `component-manifest-identity-mismatch` | archive-shadowed | archive 打开先校验 manifest ID/版本 |
| `component-metadata-missing` | schema-shadowed | V9 Schema 先校验组件引用闭包 |
| `component-protocol` | archive-shadowed | archive 组件解析先执行 Component API 4 校验 |
| `duplicate-stable-id` | active | 不同 surface owner 间的重复 layer item ID 可由现有 guard 报告 |
| `migration-marker` | schema-shadowed | 旧 frame/runtime 判别器先被 V9 Schema 拒绝 |
| `online-remote-asset` | upstream-filtered | CLI 以 offline-portable 默认调用单 HTML preflight |
| `online-remote-url-invalid` | upstream-filtered | CLI 不请求 online-lightweight preflight |
| `player-bundle-empty` | upstream-filtered | CLI 传入非空 sentinel bundle 并显式过滤该 code |
| `project-schema-invalid` | schema-shadowed | Schema-invalid 直接返回 unreadable，exportPreflight 为 null |
| `runtime-protocol` | schema-shadowed | Runtime protocol/API 判别器先由 V9 Schema 校验 |
| `static-export-info` | upstream-filtered | 当前被调用的 asset audit 没有 info 生产者 |
| `static-export-interactions-omitted` | active | 含互动的合法 V9 在 PDF/PPTX 预检中产生 |
| `static-export-preflight` | schema-shadowed | 已知无页/非法 source 输入先被 V9 Schema 拒绝；catch 仅为防御后备 |
| `static-export-warning` | archive-shadowed | 当前 asset warning 前已有 archive/source 字节门 |
| `v8-field` | schema-shadowed | strict V9 Schema 先拒绝 V8 根字段 |

机器可读版本位于 `artifacts/ai-capabilities/diagnostics.json#/courseProjectValidation/findingCodes`。加入新的诊断域或 code 必须先有真实 producer，再更新 shared ledger、聚焦测试、本合同与 AI capability 生成物；不得用预造 ledger 冒充四域规则已经实现。

## 5. 兼容与非承诺

- `reportVersion: 1` 下允许 additive optional finding `target`；不要求旧 consumer 使用它。
- 本合同不改变任何既有 code、severity、message、path、finding 顺序、blocking、summary 或退出码。
- 当前 CLI 不启动 Electron、不执行真实导出、不写入输入工程。
- `canExport=true` 只表示当前已接线检查未发现 error，不证明网络/CORS、像素结果、互动或全部 V9 语义正确。
- `projectHealth` 字段存在不等于 AI capability 可以宣称宽泛的 project-health；精确可达性以 code ledger 为准。
