# 媒体、AssetMeta、Sidecar 与资源历史

## 1. 三层结构

```text
V9 AssetMeta         持久化元数据和引用身份
Sidecar bytes        图片/音频/视频二进制
Surface carrier      LayerItem / FlowMediaBlock 等具体放置
```

三层必须在一个用户操作中保持一致，但不能混成一份对象。

## 2. 当前 Hash 事实

当前 AssetMeta 没有持久化 `contentHash` 字段；导入流程可在当次计算 hash 用于去重。repo-index 的源码文件 hash 与工程 AssetMeta 完全不同。

本轮默认不为跨会话去重新增 V9 字段。未来确有产品需求时，按 V9 additive optional 合同单独决策。

## 3. Media Feature Owns

- AssetMeta 创建与校验；
- sidecar file store；
- import/replace/remove plan；
- URL/blob 生命周期；
- 引用扫描；
- batch import；
- archive adapter。

不 Own Surface 的 frame、wrap、paperSpace 或 world placement。

## 4. 原子用例

例如替换图片：

```text
read stable target
→ import/validate bytes
→ create/choose AssetMeta
→ Surface command updates carrier ref
→ resource changes add/replace bytes
→ Core transaction commits one history
→ release obsolete blob URL safely
```

如果旧 asset 已无引用，清理必须使用引用分析，不能凭当前选中对象直接删除。

## 5. History

复用现有 `AssetFileHistoryChange`，目标支持：

- add；
- remove；
- replace；
- bytes clone/immutability；
- undo/redo 与 metadata patch 同步；
- history 步数裁剪。

用该结构替代 Slide candidate sidecar 完整快照，不再新增第二种资源历史。

## 6. Blob URL

当前 registry 使用 create/get/has/revoke/revokeAll/dispose 等实际接口。本轮不虚构 per-document API。若需要文档级隔离，先定义 key/ownership，再新增方法。

## 7. 保存与恢复

- Save/Recovery 均从 canonical document + 当前 sidecar 构建 snapshot；
- 保存过程中继续编辑不得误标为 clean；
- Recovery snapshot 不能引用后续可变对象；
- 打开新项目时旧 blob/runtime 资源必须释放；
- archive round-trip 是资源迁移的核心验证。

## 8. Surface-specific 媒体

- Slide/Spatial/Flow overlay：Native LayerItem 引用 AssetMeta；
- Flow 稿纸：FlowMediaBlock；
- audio 可为工程媒体设置或明确 carrier；
- 不建立“所有媒体都是图层”的错误抽象。
