# Runtime、互动规则与自动化编辑

---

## 1. 边界

### Runtime

负责：

- Runtime 文档；
- source；
- content；
- asset bindings；
- node bindings；
- static fallback；
- 代码校验和运行协议。

### Interactions

负责：

- trigger；
- condition；
- action；
- rule scope；
- stable IDs；
- 运行时事件连接。

### Automation UI

只是互动规则的可视化编辑器，不拥有第二套规则模型。

---

## 2. 目标目录

```text
features/runtime/
├── index.ts
├── model.ts
├── commands.ts
├── validation.ts
├── selectors.ts
└── ui/

features/interactions/
├── index.ts
├── model.ts
├── commands.ts
├── selectors.ts
├── diagnostics.ts
└── ui/
```

---

## 3. 三模式

### 简单模式

- 进入动画模板；
- 点击显示/隐藏；
- 播放媒体；
- 常用跳转；
- 模板生成标准 InteractionRule。

### 专业模式

- 完整“当—如果—就”；
- 多动作；
- 全局与场景；
- Runtime/Component event；
- presenter command；
- 规则排序、复制与诊断。

### 代码模式

- Rule JSON；
- Runtime JS；
- Runtime content JSON；
- Schema/语法校验；
- Diff；
- 统一 command 应用。

---

## 4. 写入规则

所有入口最终调用：

```text
interaction command
runtime command
```

禁止：

- 简单模式写简化私有字段；
- 专业模式直接 mutate scene；
- 代码模式直接覆盖 Store；
- DeveloperTab 维护独立 Runtime 副本；
- Automation UI 内部生成不稳定 ID。

---

## 5. 诊断

互动诊断分两类：

### 硬错误

- 引用不存在节点；
- 引用不存在状态；
- 导航动作位置非法；
- action ID 重复；
- Runtime binding 缺失。

### 建议

- 自循环；
- 初始可见与入场冲突；
- 可能不可达；
- presenter 策略不匹配。

硬错误可阻止应用或导出；建议只在专业/代码模式展示。

---

## 6. Player

Player 只读取 Published Interaction/Runtime 输入：

- 事件总线；
- 课程状态；
- Runtime Host；
- Component events；
- destroy 生命周期。

编辑预览不得直接复用作者 Store 作为运行时状态。

---

## 7. 迁移顺序

1. 建立 Runtime/Interaction facade；
2. 把纯 schema/validation 保持在 shared；
3. 将 Store wrapper 改为调用 facade；
4. 简单模板改为标准 rule command；
5. AutomationTab 使用统一 selectors；
6. Code 模式改用 draft + diff + command；
7. Player producer 只从 canonical document 构建；
8. 删除旧 direct mutation 路径。

---

## 8. 完成标准

- 一个规则模型；
- 一个 Runtime 模型；
- 三模式共用写入；
- Runtime/Component event 仍可扩展；
- Automation UI 不依赖 Store 内部结构；
- Player 生命周期与作者状态隔离。
