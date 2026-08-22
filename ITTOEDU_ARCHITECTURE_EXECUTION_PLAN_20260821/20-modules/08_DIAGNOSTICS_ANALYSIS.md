# 诊断、工程完整性、教学分析与视觉分析

这些能力保留，但重新分层和按需执行。

---

## 1. 三类检查

### A. Structural Integrity

面向正确性：

- Schema；
- 稳定 ID；
- 资源/组件引用；
- Runtime/Interaction 引用；
- 版本与协议；
- 必需数据；
- 保存与运行必须满足的约束。

运行时机：

- 打开；
- 代码模式应用；
- 保存前的必要快速检查；
- 导出前。

### B. Authoring Analysis

面向高级创作：

- 信息释放；
- 隐藏节点可达性；
- 视觉密度；
- 规则风险；
- 教师控制器与 presenter 建议；
- 未使用素材/组件。

运行时机：

- 专业模式打开“问题与分析”；
- 用户主动刷新；
- AI 生成项目验证。

### C. Export Preflight

面向具体导出格式：

- HTML 大小；
- 静态 fallback；
- 字体；
- Component/Runtime 捕获；
- PDF/PPTX/DOCX 降级。

仅在导出目标确定后运行。

---

## 2. 目标目录

```text
features/diagnostics/
├── index.ts
├── integrity/
├── authoring/
│   ├── informationRelease.ts
│   └── visualDensity.ts
├── export/
├── report.ts
├── selectors.ts
└── ui/
    ├── DiagnosticsPanel.tsx
    └── DiagnosticsCodeView.tsx
```

Schema 可以继续位于 shared。

---

## 3. 模式展示

### 简单模式

不显示“工程检查”概念。

在具体操作点显示：

- 当前素材缺失；
- 无法跳转；
- 无法导出；
- 代码/组件无效；
- 保存失败。

### 专业模式

“问题与分析”面板分组：

```text
错误
兼容性
互动与教学流程
视觉与内容密度
资源与组件
```

### 代码模式

显示：

- code；
- severity；
- path；
- source Feature；
- JSON；
- 定位；
- 可复制报告。

---

## 4. 性能

当前实时 `useMemo` 跟随整个 project 变化的方式应移除。

采用：

- 以 document revision 记录分析结果；
- 打开面板时计算；
- revision 未变则复用；
- 快速 integrity 可单独运行；
- visual density 等较重分析异步或延迟。

---

## 5. 结构校验复用

`validate:course-project` 与编辑器内校验应共享纯函数，但 CLI 不应依赖 Renderer UI。

可形成：

```text
shared/validation/*
features/diagnostics/*
scripts/validate-project.ts
```

---

## 6. 迁移顺序

1. 为当前检查分类；
2. 抽出纯 structural validators；
3. 保持 CLI 可用；
4. 将 authoring analyzers 留在专业能力；
5. App 移除实时 summary；
6. Toolbar 改成“问题与分析”入口；
7. 简单模式改为上下文提示；
8. 代码模式增加 JSON report；
9. 删除旧单体 ProjectHealthPanel 接线。

---

## 7. 完成标准

- 能力未丢失；
- 普通教师不必理解工程术语；
- 专业模式可主动分析；
- 代码模式可查看结构化细节；
- 导出预检按目标运行；
- App 不随每次编辑重算所有分析。
