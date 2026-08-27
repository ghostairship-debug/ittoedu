# Course Project Validation Report V1

本文冻结 `npm run --silent validate:course-project -- <project.h5lesson>` 当前已经公开的机器可读报告。权威实现是 `scripts/validate-project.ts`；稳定诊断 target、fatal code 与 finding code ledger 的权威定义是 `src/shared/courseProjectValidationDiagnostics.ts`。CLI 只在 V9 Schema 与 archive 打开成功后调用 V9-native `collectCourseProjectHealth`，其四域实现位于 `src/shared/courseProjectHealth/`。本合同不修改 Course Project V9 或 Published Course V2 Schema；在线轻量单 HTML 只对实际发布源码中的字面量 connect API 做声明预检，动态依赖给出 warning，不承诺完整 JavaScript 静态分析或宽泛的 V9 工程健康分析。

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
- `projectHealth`: Schema 合法时提供既有结构性 guards，加上 Runtime / Interaction / Component / Controller-Media 四域 V9-native finding 与汇总；它不是宽泛的全工程健康承诺。
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

本合同只 additive 增加可选的 `target?: DiagnosticTargetV1`。target enrichment 本身不得删除或重写既有 `path`、metadata、code、message、severity，也不得重排既有 finding；新四域 finding 固定追加在原结构性 guards 之后，并作为一个新增集合按 severity / path / code / message 确定序排列。target 只在成功解析出 Schema 合法的 `CourseProjectDocument` 后生成；无法精确定位时使用 project target。

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
| `asset-kind-mismatch` | active | 已存在素材仍可能被图片、音频、视频或静态兜底字段以错误 kind 引用 |
| `asset-metadata-missing` | schema-shadowed | V9 Schema 先校验素材引用闭包 |
| `asset-reference-missing` | active | 状态 `nativeData` 覆盖与 manifest 声明的组件图片 props 不属于 Schema 直连引用闭包 |
| `asset-unused` | active | 仅在没有 Runtime/Component 可执行 consumer 时报告，避免猜测动态 `projectAssetUrl` |
| `component-asset-bytes-missing` | archive-shadowed | 组件包解析先校验 manifest 素材 |
| `component-bytes-missing` | archive-shadowed | archive 打开先要求并解析组件包 |
| `component-hash-mismatch` | archive-shadowed | archive 打开先校验组件内容哈希 |
| `component-manifest-identity-mismatch` | archive-shadowed | archive 打开先校验 manifest ID/版本 |
| `component-metadata-missing` | schema-shadowed | V9 Schema 先校验组件引用闭包 |
| `component-package-hash-missing` | active | 原始选取包 `sha256` 是区别于必填 `contentSha256` 的可选 provenance |
| `component-package-source-missing` | active | `sourceLabel` 是可选 V9 provenance |
| `component-package-unused` | active | 从四类 layer owner 与嵌套 Flow component block 推导使用情况 |
| `component-protocol` | archive-shadowed | archive 组件解析先执行 Component API 4 校验 |
| `component-thumbnail-missing` | active | `thumbnailPath` 在 V9 component metadata 中可选 |
| `controller-required-for-canvas` | active | `controls=canvas` 但没有交付时可见的全局 V9 教师控制器 |
| `controller-scene-target-missing` | active | 教师控制器 `scene.go` 的课程位置/内容目标未由 Schema 交叉校验 |
| `controller-state-target-missing` | active | 教师控制器的 Slide `targetStateId` 未由 Schema 交叉校验 |
| `controller-visible-while-disabled` | active | `controls=none` 可与交付时可见的全局控制器并存 |
| `duplicate-stable-id` | active | 不同 surface owner 间的重复 layer item ID 可由现有 guard 报告 |
| `global-interaction-state-target-partial` | active | 全局 `presentation.set` 目标可只存在于部分可能的 Slide 场景 |
| `information-release-hidden-self-trigger` | active | Slide 元素可初始隐藏且只靠点击自身显示 |
| `information-release-hidden-unreachable` | active | Slide 元素可初始隐藏且没有可达声明式显示路径 |
| `interaction-action-reference-missing` | active | `animation.completed.actionId` 未由 Schema 交叉校验 |
| `interaction-animation-self-loop` | active | 合法规则可由自己的 motion action completion 重新触发 |
| `interaction-enter-target-initially-visible` | active | 合法 `node.enter` 目标可在动作前已显示 |
| `interaction-node-type-mismatch` | active | Schema 校验 layer 存在，但不校验 Component/Video 触发器和动作的目标类型 |
| `interaction-scene-reference-missing` | active | 互动 `scene.go` 的 Slide scene 目标未由 Schema 交叉校验 |
| `interaction-state-reference-missing` | active | presentation 触发器、条件与动作的 state 引用未由 Schema 交叉校验 |
| `looping-video-ended-unreachable` | active | 循环视频无法自然到达 `video.ended` |
| `migration-marker` | schema-shadowed | 旧 frame/runtime 判别器先被 V9 Schema 拒绝 |
| `online-connect-origin-undeclared` | upstream-filtered | CLI 以 offline-portable 默认调用单 HTML preflight；online-lightweight 会阻断未精确声明的字面量 HTTPS/WSS origin |
| `online-connect-origin-unresolved` | upstream-filtered | CLI 不请求 online-lightweight preflight；该模式会 warning 无法静态确定 origin 的 connect API |
| `online-remote-asset` | upstream-filtered | CLI 以 offline-portable 默认调用单 HTML preflight |
| `online-remote-url-invalid` | upstream-filtered | CLI 不请求 online-lightweight preflight |
| `player-bundle-empty` | upstream-filtered | CLI 传入非空 sentinel bundle 并显式过滤该 code |
| `presenter-command-unhandled` | active | authored-command 模式可缺少 next/previous handler |
| `presenter-f5-browser-reserved` | active | 合法 additional binding 可使用浏览器保留的 F5 |
| `presenter-rules-bypassed` | active | scene-navigation 策略会绕过已启用 presenter.command 规则 |
| `presenter-rules-disabled` | active | presenter 输入关闭时仍可存在已启用规则 |
| `project-schema-invalid` | schema-shadowed | Schema-invalid 直接返回 unreadable，exportPreflight 为 null |
| `runtime-node-reference-missing` | active | V9 `nodeBindings` 的工程 layer-item 目标未由 Schema 校验；不推导尚未成文的 owner 可见性限制 |
| `runtime-protocol` | schema-shadowed | Runtime protocol/API 判别器先由 V9 Schema 校验 |
| `runtime-static-fallback-missing` | active | enabled V9 Runtime 可合法省略 `staticFallback` |
| `scene-id-duplicate` | active | Schema 只在单个 Slide surface 内保证 scene ID 唯一 |
| `sound-id-mismatch` | active | Schema 不要求 sound record key 等于内部 `SoundDefinition.id` |
| `static-export-info` | upstream-filtered | 当前被调用的 asset audit 没有 info 生产者 |
| `static-export-interactions-omitted` | active | 含互动的合法 V9 在 PDF/PPTX 预检中产生 |
| `static-export-preflight` | schema-shadowed | 已知无页/非法 source 输入先被 V9 Schema 拒绝；catch 仅为防御后备 |
| `static-export-warning` | archive-shadowed | 当前 asset warning 前已有 archive/source 字节门 |
| `v8-field` | schema-shadowed | strict V9 Schema 先拒绝 V8 根字段 |
| `video-click-interaction-conflict` | active | 视频内置点击区可覆盖声明式 `node.click` |

机器可读版本位于 `artifacts/ai-capabilities/diagnostics.json#/courseProjectValidation/findingCodes`。加入新的诊断域或 code 必须先有真实 producer，再更新 shared ledger、聚焦测试、本合同与 AI capability 生成物；不得用预造 ledger 冒充四域规则已经实现。

四域 collector 都只读 `CourseProjectDocument` 与 `openCourseProjectArchive` 已打开的 asset/component files，不经过 V8 `ProjectDocument` 投影：

- Runtime：global / surface / Slide scene / Spatial world carrier 的静态兜底与工程级 `nodeBindings` 稳定 ID 存在性；
- Interaction：Slide-local 与 global rules 的类型、action/state/scene 引用、动画循环、入场可见性及信息释放可达性；Flow/Spatial 仅通过真实存在的 global interaction layer 引用参与，不伪造 surface-local rule 字段；
- Component：V9 metadata provenance、缩略图以及四类 layer owner / 嵌套 Flow block 的 package usage；
- Controller-Media：混合课程位置导航、全局控制器一致性、presenter、音视频、素材 kind、状态覆盖与 manifest image prop 引用。

未迁移的旧 V8 project-health code 精确为：

```text
asset-reference-analysis-incomplete,
component-package-missing, component-version-missing,
controller-button-id-duplicate,
global-node-id-duplicate, global-visibility-scene-reference-missing,
initial-state-reference-missing,
interaction-action-id-duplicate, interaction-navigation-not-terminal,
interaction-node-reference-missing, interaction-rule-id-duplicate,
interaction-sound-reference-missing,
node-id-duplicate, scene-required, state-id-duplicate,
state-node-reference-missing, thumbnail-state-reference-missing
```

这些 code 不进入 active ledger：V9 不存在的 `scenes/globalLayer/globalRuntime` 规则被省略；重复 rule/action/button/state/layer ID、terminal navigation、直连 layer/sound/component/位置引用及状态 override owner 引用由 Schema 遮蔽；缺少组件执行上下文、组件身份、协议、hash 与文件缺失由 archive 遮蔽。Runtime/Component 的 Secret、CORS、远程脚本和通用数据流分析仍属于后续独立网络诊断；本版只在 online-lightweight package preflight 中扫描实际发布源码的 `fetch`、`WebSocket`、`EventSource`、`sendBeacon` 与 `XMLHttpRequest.open`，精确字面量核对 `network.connectOrigins`，动态、相对或词法歧义调用只给 warning。

## 5. 兼容与非承诺

- `reportVersion: 1` 下允许 additive optional finding `target`；不要求旧 consumer 使用它。
- 本合同不改变任何既有 code、severity、message、path、finding 顺序、blocking、summary 或退出码。
- 当前 CLI 不启动 Electron、不执行真实导出、不写入输入工程。
- `canExport=true` 只表示当前已接线检查未发现 error，不证明网络/CORS、像素结果、互动或全部 V9 语义正确。
- `projectHealth` 字段存在不等于 AI capability 可以宣称宽泛的 project-health；精确可达性以 code ledger 为准。
