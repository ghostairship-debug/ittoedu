# 模块地图、Owner 与跨切用例

## 1. 模块 Owner

| 模块 | Owns | 不 Own |
|---|---|---|
| Shared Contracts/Domain | V9/Published/Component/Runtime/Interaction 类型与纯规则 | Renderer 状态、UI、文件系统 |
| Editor Core | canonical port、authoring identity、transaction/history、typed selectors | 具体 Surface selection、Feature UI |
| App Composition | 项目生命周期、跨 Feature use case、路由、错误反馈 | Surface 内部模型、格式实现 |
| Slide | Scene/Layer placement、Phaser 编辑生命周期、Slide selection | Catalog、通用包生命周期 |
| Flow | FlowBlock、稿纸布局、overlay placement、Flow selection | 把普通 block 变成通用图层 |
| Spatial | World item、camera/path/relation、Spatial selection | Player 会话相机写回工程 |
| Components | Catalog、package、props、authoring validation | Surface carrier/placement |
| Media | AssetMeta、sidecar bytes、引用与导入计划 | Surface 具体布局 |
| Runtime | Runtime definition、draft、validator、host contract | Player 反写作者文档 |
| Interactions | Rule、template、validator、authoring UI | Surface 私有布局 |
| Global Layers | global/surface effective ownership/order | 复制教师控制器到每个 Surface |
| Teacher Controller | 控制器作者与运行行为 | 独立持久化副本 |
| Preview | session build、mount/destroy/generation、fit | Export 格式实现 |
| Export | Published/static plan 到具体格式 | 修改作者 Store |
| Diagnostics | structural/authoring/export report | 每次键入全量分析 |
| Main/Preload | 文件、窗口、IPC、安全边界 | 作者业务模型 |
| Repo Knowledge | 开发索引与 Context Pack | 产品运行时依赖 |

## 2. 必须登记的跨切 Owner

- Published V2 producer：单一串行 owner；
- project save/recovery：App/Persistence owner；
- component/media placement：App use-case + Surface command；
- global/effective layer：Global Layers owner；
- teacher controller：Teacher Controller owner；
- IPC channel parity 与 trust/path/hash：Main/Preload owner；
- generated repo-index：ARCH 阶段整合者；
- `Workspace.tsx` / `PropertiesTab.tsx` 接线：单一 integrator。

## 3. 跨切用例规则

跨域操作不通过模块互相深层 import 完成。用例层组合：

```text
validate package/media
→ Surface-specific placement command
→ Core transaction
→ App feedback
```

如果用例需要 document + asset/component bytes 同时变更，必须是一条原子逻辑历史。

## 4. Owner 变更

Owner 不是目录名自动决定的。每次职责迁移要记录：

- 旧 owner；
- 新 owner；
- 公共入口；
- consumers；
- rollback；
- Legacy 删除阶段。
