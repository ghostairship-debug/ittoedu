# UI Composition、Workspace、Properties 与现有 DeveloperTab

## 1. 目标

UI 只组合 Feature/Surface view model 和 commands，不直接了解所有 Store 内部结构。

## 2. Workspace

最终职责：

- 根据当前 Surface/location 路由编辑器；
- 放置通用 overlay/chrome；
- 组合 Try-run；
- 协调尺寸与错误边界。

不再承担：

- 三 Surface 命令实现；
- Published producer；
- 组件包生命周期；
- 大量 selection 推导；
- Preview mount 内联状态机。

迁移前先抽 seam，不一次拆文件。

## 3. Properties

目标是编辑器路由：

```text
selected authoring address
→ Surface/Feature property view model
→ property editor
→ typed command
```

Properties 不订阅数十个原始 Store action，也不通过节点类型巨型 switch 直接修改所有领域。

## 4. 模式能力配置

建立当前事实与目标配置。稳定化只集中现有简洁/专业披露规则，不新增第三种产品模式：

```ts
interface CapabilityExposure {
  simple: 'direct' | 'more' | 'hidden'
  professional: 'direct' | 'more'
  developerTab: 'read' | 'edit' | 'none'
}
```

先集中散落条件，不急于替换所有分支。任何能力从 `hidden` 改为 `more` 属产品可发现性变化，需要 UI 验证。

## 5. DeveloperTab 保护范围

当前 DeveloperTab 已包含以下能力，稳定化只负责把它们接入相同的 target、transaction 和 history：

- Runtime；
- object JSON；
- rules JSON；
- Component Manifest/Runtime；
- schema errors；
- apply/cancel。

本轮不创建新的 Code Workspace 产品形态，不新增第三个 Toolbar 模式，也不扩建新入口。结构化 diff 等新增体验另列产品 Epic，只有 Owner 明确批准后才进入后续路线；仍不得持久化 `projectMode`。

## 6. Error Boundary 与局部故障

- Surface/editor 面板局部错误不应让整个应用白屏；
- Runtime/Component 预览错误显示可恢复状态；
- 未保存草稿和错误详情可复制；
- AppErrorBoundary 继续保留，必要时增加局部 boundary，而非全局吞错。

## 7. 样式

样式随真实 Feature 迁移；不在一个任务重写 globals.css。每次移动需证明：

- selector 作用域不变；
- 视觉无意外漂移；
- 删除旧规则前无消费者；
- 不增加大量重复 CSS。

## 8. 验收

- 简洁模式高频能力直接可达；
- 专业模式编辑能力不缩水；
- DeveloperTab 现有提交可撤销，且不丢失已有 Runtime/object/rules/component 能力；
- Properties/Workspace 不直接新增 legacy Store 消费者；
- keyboard/focus/DnD/contenteditable/IME 正常；
- UI 路由变化不破坏 Surface 体验。
