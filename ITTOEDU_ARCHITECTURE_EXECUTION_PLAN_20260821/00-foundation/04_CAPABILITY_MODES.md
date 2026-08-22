# 简单、专业与代码模式的能力架构

---

## 1. 核心定义

三种模式是**同一编辑器能力内核的三种视图**，不是三个产品分支。

```ts
type EditorMode = 'simple' | 'professional' | 'code'
```

该模式属于本地 UI 偏好，不进入 Course Project V9 persisted Schema。

---

## 2. 能力暴露矩阵

| 能力 | 简单模式 | 专业模式 | 代码模式 |
|---|---|---|---|
| 高频文本、图片、视频、图形 | 直接 | 直接 | 结构化查看 |
| Slide/Flow/Spatial | 直接 | 直接 | 结构化查看 |
| 常用属性 | 直接 | 直接 | JSON |
| 高级属性 | 折叠/更多 | 直接 | JSON |
| 常用动画 | 模板 | 完整配置 | 规则 JSON |
| 互动规则 | 常用入口 | 完整可视化 | JSON |
| 组件使用 | 推荐/已安装 | 完整目录与管理 | Manifest/Props |
| Runtime | 不默认显示 | 高级入口 | JS |
| Component Runtime | 不默认显示 | 高级入口 | JS |
| 诊断 | 操作点提示 | 完整面板 | 结构化报告 |
| 导出预检 | 自动提示 | 完整详情 | JSON |
| 全局层/控制器 | 简化入口 | 完整管理 | 数据结构 |

---

## 3. 模式不得改变的内容

无论模式如何：

- 读取同一个 `CourseProjectDocument`；
- 调用同一个 command；
- 进入同一 history；
- 使用同一 selection identity；
- 保存同一工程；
- 预览和导出同一 Published producer；
- 使用同一校验器。

---

## 4. 能力配置实现

可以维护一个简单常量：

```ts
export const editorModeCapabilities = {
  simple: {
    showAdvancedProperties: false,
    showFullInteractionEditor: false,
    showComponentCatalogDetails: false,
    showCodeWorkspace: false,
  },
  professional: {
    showAdvancedProperties: true,
    showFullInteractionEditor: true,
    showComponentCatalogDetails: true,
    showCodeWorkspace: false,
  },
  code: {
    showAdvancedProperties: true,
    showFullInteractionEditor: true,
    showComponentCatalogDetails: true,
    showCodeWorkspace: true,
  },
} as const
```

这只是 UI 可见性配置，不是权限框架，不应扩展成复杂策略系统。

---

## 5. 代码模式安全写入

代码模式流程：

```text
读取 canonical selector
→ 生成可编辑草稿
→ 用户修改
→ Schema/语法/协议校验
→ 计算 Diff
→ 调用统一 command
→ 进入统一 history
```

禁止：

- 直接 `setState` 覆盖 Store；
- 绕过 Schema；
- 修改 derived projection；
- 单独维护 code-mode document；
- 在文本输入过程中持续写 canonical document。

---

## 6. 模式切换

切换模式时保留：

- 当前 Surface；
- location；
- selection；
- viewport；
- 未提交草稿应提示或显式保留。

切换模式不应：

- 重建工程；
- 创建新 session；
- 清空 history；
- 重新挂载 Player；
- 改变 persisted 数据。

---

## 7. 实施顺序

1. 先建立统一 Feature API；
2. 将散落的 `editorMode ===` 判断收口到 UI 组合层；
3. 保留现有简单/专业模式；
4. 将 DeveloperTab 逐步升级为代码模式工作区；
5. 最后移除模式间重复命令与表单逻辑。
