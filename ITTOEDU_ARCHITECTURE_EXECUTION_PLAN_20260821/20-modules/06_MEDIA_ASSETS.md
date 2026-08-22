# 素材与二进制 Sidecar

---

## 1. 数据区分

### Metadata

保存在 `CourseProjectDocument.assets`：

- id；
- kind；
- filename；
- mimeType；
- byteLength；
- dimensions/duration；
- content hash；
-其他可序列化元数据。

### Bytes

保存在 `CourseAssetSidecar`：

```text
assetId/path → Uint8Array
```

### Runtime URL

只在当前 Renderer/Player 会话存在：

```text
assetId → blob URL
```

不得持久化 blob URL。

---

## 2. 目标模块

```text
features/media/
├── index.ts
├── assetRegistry.ts
├── import/
├── commands.ts
├── selectors.ts
├── blobUrlRegistry.ts
├── historyDelta.ts
└── ui/
```

---

## 3. 导入流程

```text
选择文件
→ 读取 bytes/hash/metadata
→ 检查重复
→ 生成 AssetMeta
→ 当前 Surface placement command
→ 一次 transaction 同时写 document + sidecar
```

批量导入中：

- 每个失败项单独报告；
- 成功项可以提交；
- 重复内容复用 asset；
- 不因一个文件失败回滚所有成功项，除非操作语义要求原子批次。

---

## 4. 替换

替换素材必须区分：

- 替换当前实例引用；
- 替换整个 asset 内容；
- 新增 asset 并修改引用。

默认采用“新增 + 修改当前引用”，避免影响其他实例。专业模式可提供全局替换。

---

## 5. History

Document patch 与 sidecar delta 同事务。

Undo：

- 恢复引用；
- 恢复或删除 bytes；
- 释放不再使用的 blob URL；
- 保持 asset ID 规则明确。

---

## 6. 垃圾回收

不在每次编辑后自动删未引用素材。

提供：

- 专业模式素材管理；
- 按需扫描；
- 显式清理；
- 删除前分析 Component/Runtime/Export 引用。

---

## 7. Blob URL 生命周期

集中 registry：

```text
get(assetId)
release(assetId)
releaseAllForDocument(documentId)
```

禁止 UI 组件各自创建且不 revoke。

---

## 8. 与 Component 的二进制区分

媒体 sidecar 与 component package files 可以共享事务接口，但不应混为同一种业务对象：

- Asset 是课程素材；
- Component package 是可执行包。

---

## 9. 完成标准

- Document 与 bytes 始终一致；
- save/reopen 后引用完整；
- Undo/Redo 恢复 bytes；
- 三 Surface 共用导入核心；
- blob URL 不泄漏；
- Store 不保存多份 sidecar past/future 全快照。
