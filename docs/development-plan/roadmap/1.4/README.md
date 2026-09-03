# 1.4：Authoring Tools 与 Builder V2

## 结果与边界

产品提供一套以 canonical target 为唯一地址、以 revision 和统一 receipt 为提交边界的正式 Authoring Tools，覆盖演示页、Flow 正文、Spatial camera / path / relation，以及课程 global / background / network。Builder V2 只经产品 Facade 调用这些工具，不直接展开内部模块。

代码工具和 Builder V2 的 Component / Runtime escape hatch 必须等待三个动态载体硬门全部闭合：注册身份、动态资产 Published 闭包、生命周期失败隔离与可见 fallback。任何门未过都不得用人工 review 或配置开关绕过。

发布制品只有源码 tag，不发布 HTML 或安装器。

## 任务 DAG

| Task ID | 结果 | Dependencies | Optional | Write locks | Acceptance |
| --- | --- | --- | --- | --- | --- |
| `r14-000-target-wire` | `AuthoringToolTargetWireV1` 无损表达 update target，并为 create 提供独立 scope | `r11-062-owner-release` | 否 | `contracts-schema` | 现有 `CourseAuthoringTarget` 的全部字段逐字段 serialize/parse/serialize 后不变；update 缺任一 canonical 字段即拒绝；create-scope 不含伪造 `itemId`/`authoringAddress`；错误定位到字段且零写入；基础 target wire 不等待 Table/Chart/Recipe 完整版本 |
| `r14-001-tool-receipt` | 统一工具回执、revision / stale、history 与 resource transaction | `r14-000-target-wire` | 否 | `contracts-schema`, `editor-store-history` | 成功回执包含 tool、canonical target、before / after revision、创建 / 修改身份、diagnostics；预期 revision 不匹配返回 stale 且零写入；一个工具调用只产生一个可 Undo 事务；资源与文档提交同成同败 |
| `r14-010-component-registry-identity` | 硬门 1：Component Registry 区分工程、package、version、source 与 content identity | `r14-000-target-wire` | 否 | `contracts-schema` | 同 package 不同工程 / version / source / content 同时注册时互不覆盖；更新只失效精确旧身份；保存重开与 Published 构建解析到同一身份；碰撞被拒绝并产生定位诊断 |
| `r14-011-dynamic-asset-closure` | 硬门 2：Runtime / Component 的 direct project asset 引用进入 Published asset closure | `r14-000-target-wire` | 否 | `published-producer` | Component 与 Runtime 各自直接引用工程图片、字体和媒体后，Published manifest / 单 HTML 均包含且能离线读取；缺失资产使 preflight 失败并列出 origin；未引用资产不被误带入 |
| `r14-012-lifecycle-visible-failure` | 硬门 3：动态实例异常时销毁或隔离旧实例并显示静态 fallback / 可见错误 | `r14-000-target-wire` | 否 | `published-producer` | mount、update、unmount、timeout 四类失败各自触发旧实例销毁或隔离；失败后不再接收输入 / 计时 / 网络回调；画布与 Player 显示静态 fallback 或可见错误；切换到健康实例不复活旧状态 |
| `r14-020-slide-tools` | 正式工具覆盖演示页 Native 对象、页面、状态与声明式互动写入 | `r14-000-target-wire`, `r14-001-tool-receipt` | 否 | `editor-store-history`, `workspace-properties` | 通过工具创建 / 更新 / 删除页面与 Native 内容并设置状态 / 互动；回执落点与 UI 选择一致；stale 调用零写入；每次调用可 Undo；保存重开、Player 与 HTML 使用提交结果 |
| `r14-021-flow-tools` | 正式工具覆盖 Flow 正文结构和内嵌内容 | `r14-000-target-wire`, `r14-001-tool-receipt` | 否 | `editor-store-history`, `workspace-properties` | 通过工具插入、更新、移动、删除 Flow block 与内嵌对象；canonical location 不因前置插入而漂移；错误 target 和 stale revision 均零写入；保存重开与 Player 顺序一致 |
| `r14-022-spatial-tools` | 正式工具覆盖 Spatial object、camera、path 与 relation | `r14-000-target-wire`, `r14-001-tool-receipt` | 否 | `editor-store-history`, `workspace-properties` | 通过工具创建对象、设置 camera、编辑 path / relation；非法引用和环路按合同拒绝；一次调用一个历史事务；保存重开后稳定身份、几何和关系不变；Player 可完成路径导航 |
| `r14-023-course-global-tools` | 正式工具覆盖 course global、background 与 network | `r14-000-target-wire`, `r14-001-tool-receipt` | 否 | `editor-store-history`, `workspace-properties` | 通过工具修改全局资源 / 设置、各 owner 背景和课程网络；回执报告实际 owner；跨层误写被拒绝；网络边和端点保持稳定身份；Undo / Redo、保存重开与 Player 解析一致 |
| `r14-030-dynamic-code-tools` | 在三个硬门通过后开放 Component / Runtime 源码与配置工具 | `r14-000-target-wire`, `r14-001-tool-receipt`, `r14-010-component-registry-identity`, `r14-011-dynamic-asset-closure`, `r14-012-lifecycle-visible-failure` | 否 | `contracts-schema`, `published-producer` | 工具写入精确 registry identity 并返回 origin / revision；资产闭包和真实宿主 smoke 失败时 registry 与工程零改动；成功载体在编辑器、Player、单 HTML 同时运行；工具不暴露 Provider secret、原始 Electron Main、任意 OS 或未批准宿主 API |
| `r14-040-builder-v2` | Builder V2 通过稳定 Facade 组合三 Surface、Recipe 与动态载体工具 | `r12-060-release`, `r13-060-release`, `r14-020-slide-tools`, `r14-021-flow-tools`, `r14-022-spatial-tools`, `r14-023-course-global-tools`, `r14-030-dynamic-code-tools` | 否 | `generated-index` | 同一已确认 teaching plan/presentation script 可生成含三 Surface、已交付 Native/Recipe 和一个动态载体的 V9 工程；Builder 只导入公开 Facade；每步留 receipt；失败步骤不留下半成品；输出通过产品校验、保存重开、Player 和 HTML |
| `r14-041-builder-v1-compat` | Builder V1 在迁移窗口继续工作且不形成第二条写入路径 | `r14-040-builder-v2` | 否 | `generated-index` | 既有 V1 固定课例仍经兼容适配层构建成功；V1 与 V2 最终都调用相同产品 Facade / command；V1 不静态导入内部路径或重新 spread 模块；弃用提示可定位但不阻塞构建 |
| `r14-050-weak-model-vertical` | 用受限策划输入完成 Builder V2 端到端弱模型 / 低信息垂直验证 | `r14-040-builder-v2`, `r14-041-builder-v1-compat` | 否 | `generated-index` | 固定输入只提供确认后的两份 Markdown；构建产物含三 Surface、Native 互动和动态载体；产品校验、保存重开、Player、单 HTML、诊断全部通过；失败时能由 receipt 定位到唯一工具调用，不靠人工改 JSON 收尾 |
| `r14-060-release` | 固定课例通过三 Surface、动态载体和 Builder 人工闭环并发布 1.4 源码 tag | `r14-050-weak-model-vertical` | 否 | `none` | Owner 在固定课例编辑三 Surface 与 Component/Runtime，执行保存重开、Undo/Redo、Player、单 HTML 和故障 fallback；把 target/receipt/stale/单事务与 Builder 行为晋升到保全矩阵，证明 tool catalog 单一、Builder 只经 Facade、dynamic correctness gate 只约束 dynamic lane、无 raw Store deep import 后签署 `accepted` 并发布源码 tag |

并行 frontier：三个动态硬门与四组 Surface / course 工具可在共同合同落定后按写锁并行；`r14-030-dynamic-code-tools` 是代码工具和动态 escape hatch 的唯一前门，不能被 Builder 任务反向绕过。

## 接口与数据合同

`AuthoringToolTargetWireV1` 必须完整包含：

```text
projectId
documentRevision
revisionPolicy
sessionGeneration
surfaceType
surfaceId
locationId
stateId
owner
ownerKey
itemId
authoringAddress
```

- update 工具无损携带全部字段；create 工具使用独立 create-scope，声明父 scope、插入位置和 revision 前提，不伪造尚不存在的身份。
- 所有变更工具使用同一 receipt envelope：请求身份、canonical target、before / after revision、影响身份、resource transaction、diagnostics、stale / failure 分类。
- receipt 是可审计回执而不是第二份工程状态；权威状态仍是 V9 project + editor command/history。
- Component registry key 必须能区分 project、package、version、source identity 和 content identity。Runtime / Component 的 direct project asset 统一进入 Published asset graph。
- Builder V2 暴露版本化 Facade；课例模块不得静态导入仓库内部路径。V1 兼容层只做输入适配，不复制命令实现。

## 精确验证入口

实现任务应在以下现有测试文件中增加明确用例，并按最小相关集合执行：

```text
npm run test:product -- tests/unit/courseAuthoringTarget.test.ts tests/unit/courseAuthoringSession.test.ts tests/unit/editorTransaction.test.ts
npm run test:product -- tests/unit/flowEditorCommands.test.ts tests/unit/spatialEditorCommands.test.ts tests/unit/courseLogicAuthoringCommands.test.ts
npm run test:product -- tests/unit/componentAuthoringTargetRegistry.test.ts tests/unit/componentLifecycleGuard.test.ts tests/unit/assetReferences.test.ts
npm run test:product -- tests/integration/publishedPhaserComponentSlideHostIntegration.test.ts tests/integration/publishedRuntimeSlideHostIntegration.test.ts tests/integration/publishedRuntimeFlowHostIntegration.test.ts
npm run test:product -- tests/unit/coursewareCaseBuilder.test.ts tests/unit/coursewareAuthoringRunner.test.ts tests/unit/coursewareSkillsContract.test.ts
npm run test:e2e -- tests/e2e/stabilizationFlowAuthoring.spec.ts tests/e2e/stabilizationOwnershipController.spec.ts
```

版本候选再执行总路线的统一验证与发布门。三个动态载体硬门必须各有故障注入证据，单纯 schema / mock 通过不足以开放代码工具。
