# Editor Core：状态分类、事务、历史与过期目标

## 1. 先分类，不先重写

编辑器状态分为七类：

| 类别 | 示例 | 是否持久化 | 是否进入 Undo |
|---|---|---:|---:|
| Canonical document | CourseProjectDocument | 是 | 是 |
| Binary sidecars | asset/component bytes | 是 | 是，使用 delta |
| Authoring identity | projectId/revision/location/surface/generation/owner | 否 | 否 |
| Surface selection | block/layer/path/camera selection | 否 | 通常否 |
| Draft/IME/drag | 文本、代码、表单、临时 frame | 否 | 提交后才进入 |
| Runtime/preview session | mount、会话相机、播放状态 | 否 | 否 |
| App UI | tab、dialog、path、status | 部分本地偏好 | 否 |

禁止把这七类重新塞回一个无边界大接口。

## 2. Canonical document

最终 Store 中只有一个可写：

```ts
CourseProjectDocument
```

当前阶段不立即改变 Store 形状，也不预建 selector/port 矩阵。只有已准入的用户行为或真实 consumer 被当前边界阻塞时，才在同卡抽取最窄入口并接入首个 consumer；没有明确替代目标时不创建 Port、adapter 或 facade。

当前正常生命周期并不是三个 V9 session 同时竞争：初始化、新建和打开始终恰好激活 Slide、Flow、Spatial 三者之一，切换 Surface 时另外两个置空。真实债务是“一个活动 V9 session + 可写/派生混合的 V8-shaped `state.project` + 三套互斥实现”。先增加 exactly-one-active 不变量，再把 canonical document owner 从 Surface session 中抽离。

## 3. 演化 CourseAuthoringSession

不新建长期平行 `ActiveEditor`。现有 Session 演化为稳定身份：

```ts
interface AuthoringTarget {
  projectId: string
  documentRevision: number
  sessionGeneration: number
  surfaceType: 'slide' | 'flow' | 'spatial-2d'
  surfaceId: string
  locationId: string
  ownerKey: string
  itemIds: readonly string[]
}
```

具体 `SlideSelection/FlowSelection/SpatialSelection` 留在各 Surface，不让 Core 依赖其类型。

## 4. Stale-target 合同

任何异步或延迟提交必须带创建时 target。提交前检查：

- projectId 相同；
- sessionGeneration 相同；
- location/surface/owner 仍匹配；
- expected item 仍存在；
- documentRevision 满足该 command 的并发策略。

失败时返回可识别的 stale result，不静默写到当前页面。

## 5. Transaction port

不建立 Command Bus。推荐窄接口：

```ts
commitEditorTransaction({
  label,
  target,
  build,
})
```

负责：

1. 获取 canonical document 和资源 Store；
2. 验证 target；
3. 执行 Surface/Feature 纯命令；
4. 产生 document patches/inverse patches；
5. 应用 asset/component resource changes；
6. 写一条逻辑 history；
7. 更新 revision/dirty；
8. 返回 selection hint 和 user feedback。

## 6. 复用现有 History 基础

当前 `history.ts` 已支持：

- Immer patches/inverse patches；
- `AssetFileHistoryChange`；
- `ComponentPackageHistoryChange`。

迁移目标是：

- 让它承载 V9 document；
- 让 Slide/Flow/Spatial 共用统一 Entry 语义；
- 用 resource delta 代替 Slide sidecar/component 完整 past/future 快照；
- 保持 `MAX_HISTORY_STEPS` 等现有约束。

不再创建另一套 BinaryChange 框架，除非现有结构无法表达 replace/remove；优先扩展现有类型。

## 7. 用户操作边界

- pointer move：局部临时状态；pointer up 一次提交；
- 文本/IME：composing 不提交；完成编辑形成一条记录；
- 代码：draft → validate → diff → 一次提交；
- 批量导入：一个明确用户确认动作可是一条批量历史；
- 自动恢复写盘不进入 Undo；
- 模式/Tab 切换不进入 Undo。

## 8. 按需迁移路径（非固定施工顺序）

```text
可复现行为 / 真实 consumer / 明确替代目标
→ 边界不清时才 characterization
→ 优先复用现有入口；确有阻塞时抽最窄 seam 并接入首个 consumer
→ 目标验证与一次可回退接入
→ 只有已选中的旧目标才减少 consumer，并在 deletion gate 满足后删除
```

上图是单张已准入卡可选择的路径，不要求依次建设 canonical selector、AuthoringTarget adapter 或 transaction facade，也不要求所有 session/history consumer 归零。仍有真实用途、兼容责任和 owner 的入口可以保留。

## 9. 完成标准

- canonical document 不再由当前恰好非空的 Surface session 决定；Surface session 仍保持恰好一个活动；
- 所有持久化命令写同一 V9 document；
- Surface selection 不进入 Core 具体 union；
- stale callback 测试覆盖切页/切项目；
- asset/component undo/redo 与保存重开一致；
- `state.project` 只读消费者归零后才删除。
