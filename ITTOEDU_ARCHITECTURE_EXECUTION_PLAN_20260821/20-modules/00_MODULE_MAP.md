# 模块地图与迁移总规则

---

## 1. 目标模块表

| 模块 | 拥有的数据/职责 | 主要消费者 | 不应承担 |
|---|---|---|---|
| Editor Core | canonical document、history、active editor、selection | 所有 Renderer Feature | 导出、Player DOM、文件对话框 |
| App Shell | 窗口级 UI、项目生命周期编排、模式与布局 | Renderer | 领域命令细节 |
| Persistence/IPC | 文件读写、恢复、目录和系统能力 | App Shell | 编辑状态和 UI |
| Slide | Slide 作者态命令、投影、画布 | UI、Preview producer | Flow/Spatial 内部逻辑 |
| Flow | Flow 文档、命令、稿纸与浮层编辑 | UI、Preview producer | Slide proxy |
| Spatial | 世界、镜头、关系、路径、语义缩放 | UI、Preview producer | Slide/Flow 内部逻辑 |
| Components | Catalog、包、实例、属性、代码 | 三模式、三 Surface、Player | 项目保存编排 |
| Runtime | Runtime 文档与代码校验 | 专业/代码、Player | 组件 Catalog |
| Interactions | 规则、动作、触发器、自动化 UI | 三模式、Player | 直接写 Store |
| Media/Assets | Asset metadata、sidecar、导入与 URL | Surface、Player、Export | UI 模式 |
| Diagnostics | 完整性、教学分析、视觉分析 | 专业/代码、导出 | 实时重算所有内容 |
| Player/Preview | 只读 Published 运行 | 试运行、整课预览 | 写作者文档 |
| Export | 读取统一 producer 并生成产物 | App Shell | 修改工程 |
| Repo Knowledge | 开发代码图、Context Pack | 编码 AI | 产品运行时 |

---

## 2. 模块迁移规则

1. **先建公共入口，再移动实现。**
2. **每次只迁移一个责任。**
3. 旧入口可临时 re-export 新入口。
4. 新入口不得再依赖旧上帝文件的内部状态。
5. 迁移期 adapter 必须是单向的。
6. 不同时修改 persisted Schema 和模块结构。
7. 相关测试跟随 Feature，而不是跟随旧目录。
8. 只有消费者全部迁移后才删除旧文件。

---

## 3. 公共 API 设计原则

每个 Feature 对外暴露：

- 必要类型；
- selectors；
- commands；
- UI 入口；
- 校验器；
- 与 Player/Export 的转换函数。

不暴露：

- 内部 helper；
- 临时草稿；
- Store 内部字段；
- 具体组件树；
- 私有缓存；
- 迁移中的旧投影。

---

## 4. 交叉 Feature 操作

跨 Feature 操作由调用方组合最小公共 API，不建立中央万能协调器。

例如插入组件：

```text
Components catalog/package
→ Surface component instance command
→ Media/sidecar transaction
→ Editor Core history commit
```

组合发生在明确的用例函数中，不发生在 UI 组件内部。

---

## 5. 依赖冲突处理

若两个 Feature 互相依赖：

1. 找共同 Contract；
2. 把纯类型或纯模型放入 `shared/`；
3. 或由上层组合；
4. 不允许用事件总线隐藏循环依赖；
5. 不允许把所有逻辑重新塞回 Store。
