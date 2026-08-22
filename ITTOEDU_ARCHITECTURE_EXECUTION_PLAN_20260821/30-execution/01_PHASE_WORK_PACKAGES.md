# 分阶段工作包清单

工作包用于直接派给编码 AI。每个工作包应再复制到 `50-templates/TASK_CARD_TEMPLATE.md`，补充当前 HEAD、允许文件和精确测试。

---

# P0：基线与知识系统

## BSL-01 当前行为基线

**目标**

- 记录 HEAD、构建环境、核心流程状态；
- 不修复业务问题。

**交付**

- `docs/current-baseline.md`；
- 核心流程结果；
- 已知 P0/P1/P2 列表；
- 三份代表工程。

**验证**

- 基线阶段仅一次完整 `npm run verify`；
- 若 verify 因已知问题失败，记录而不顺手修复。

---

## MAP-01 Feature Matrix

**目标**

盘点所有当前与路线能力。

**字段**

- Feature；
- UI 入口；
- simple/professional/code；
- canonical data；
- write commands；
- runtime/export consumers；
- tests；
- status：core/advanced/experimental/legacy；
- owner module。

**交付**

- `repo-index/semantic/features.json` 初版；
- 人类可读 Feature Matrix。

---

## IDX-01 `repo-index/` 骨架

**目标**

创建目录、Schema Version、README 和 semantic 文件。

**限制**

- 不扫描源码；
- 不改产品代码。

**验证**

- JSON parse；
- 所列路径存在。

---

## IDX-02 AST 索引生成器

**目标**

生成 files/symbols/edges/tests/scripts/contracts。

**允许**

- `scripts/generate-repo-index.ts`；
- `repo-index/generated/`；
- 索引单测；
- package scripts。

**验证**

- 目标单测；
- 运行一次 `repo:index`；
- 不跑桌面测试。

---

## IDX-03 语义关联与路径校验

**目标**

将 Feature、Module、Contract、Test 关联，并检查失效路径。

**验证**

- semantic fixture；
- 当前仓库路径检查；
- 确认失效旧路径被报告。

---

## IDX-04 Context Pack 查询器

**目标**

实现关键词、alias、图扩展和 Markdown 输出。

**验证**

至少用以下查询评估：

- “组件目录版本更新”；
- “Flow 图片替换保存重开”；
- “Slide 试运行返回编辑”；
- “代码模式修改互动规则”。

---

## DOC-01 活跃文档入口收口

**目标**

- 重写 `AGENTS.md` 为短入口；
- 将 `PROJECT_COGNITION_INDEX.md` 替换为精简 `PROJECT_INDEX.md` 或改为自动入口；
- 历史任务不再默认阅读；
- 保留必要决策到 ADR。

**验证**

- 链接检查；
- `repo:index:check`。

---

# P1：公共入口与边界

## BOUND-01 模块边界规则

**目标**

用索引生成器或轻量脚本检查：

- player 不导入 renderer store；
- shared 不导入 renderer；
- Feature 不深层互相导入；
- 新代码使用公共入口。

**限制**

先只报告，不立刻阻断所有历史违规；建立棘轮。

---

## FAC-01 Editor Core facade

创建：

```text
renderer/core/index.ts
```

初期 re-export：

- canonical selectors；
- active editor identity；
- transaction types；
- Store hook。

不移动实现。

---

## FAC-02 Surface facades

为 Slide、Flow、Spatial 各建公共入口，只导出当前真正消费者。

---

## FAC-03 Components facade

按 Catalog、Package、Instance、Authoring 分组导出。

---

## FAC-04 Runtime/Interactions facade

导出纯模型、commands、selectors、validators。

---

## FAC-05 Media facade

导出 asset/sidecar/import/public URL API。

---

## FAC-06 Diagnostics facade

导出 structural、authoring、export 三类入口。

---

## TESTMAP-01 测试映射

将测试映射到 Feature；不移动全部测试，只在索引中建立关系。

---

# P2：低风险解耦

## APP-01 提取项目生命周期

从 `App.tsx` 提取：

- new/open/recent；
- save/save-as；
- recovery。

先保留现有 Store API。

---

## APP-02 提取 Preview 生命周期

提取：

- course preview state；
- mount/destroy；
- fit；
- feedback。

不改 Player producer。

---

## APP-03 提取 Export actions

每种格式只保留调用编排；实际实现留在 export 模块。

---

## DIAG-01 检查分类

将当前 Project Health 规则标记为：

- structural；
- authoring；
- export；
- simple contextual。

先不移动代码。

---

## DIAG-02 纯校验拆分

抽出无 UI 的 validators，复用到 CLI。

---

## DIAG-03 按需 UI

- 移除 App 每次变更的完整健康计算；
- 专业模式打开时分析；
- 简单模式仅操作点提示；
- 保留当前能力。

---

## COMP-01 Component UI 拆分

从巨型 `ComponentsTab` 提取：

- CatalogBrowser；
- InstalledPackages；
- ComponentDetails；
- Instance panel。

仍使用现有命令。

---

## UI-01 模式能力配置

集中 simple/professional/code 可见性，替换部分散落判断。

---

## STYLE-01 跟随 Feature 移动样式

只移动本阶段 UI 对应 CSS；不全量重写样式系统。

---

# P3：Editor Core

## CORE-01 Canonical selectors

所有新消费者从一个入口获取 V9 document/sidecars/active identity。

---

## CORE-02 ActiveEditor union

先从旧状态派生，再逐步成为导航真相。

---

## CORE-03 Transaction facade

建立统一提交和 history label；接入少量新命令试点。

---

## CORE-04 Slide 写入迁移试点

选择一个低风险 Slide 操作，通过 transaction 提交，验证 selection/history/save。

---

## CORE-05 Flow 与 Spatial 写入迁移

各选择一个低风险操作，再逐步扩大。

---

## CORE-06 History 与 binary delta

统一 document patch、asset delta 和 component delta。

---

## CORE-07 旧 project/session 降级

- 旧 project 只读 selector；
- 禁止写回；
- 删除已迁移 action；
- session 仅保留局部草稿。

---

## MEDIA-01 Sidecar 收口

替换完整 past/future sidecar 快照。

---

# P4：模式与高级能力

## MODE-01 三模式 UI 状态

将 code 作为明确 UI 模式或明确工作区，不进入 persisted Schema。

---

## MODE-02 Feature 字段分层

common/advanced/code-only 仅控制展示。

---

## MODE-03 模式切换草稿处理

文本、代码和复杂表单草稿在切换时提交/取消/提示。

---

## COMP-02 Catalog source 与 installed package 分离

Catalog 不再被误认为工程组件包。

---

## COMP-03 Instance commands 统一

三 Surface 使用同一 package lifecycle 和各自 placement command。

---

## COMP-04 Authoring draft/diff

组件代码编辑通过统一 command 应用。

---

## COMP-05 三模式整合

简单推荐、专业完整、代码编辑共用数据链。

---

## RUN-01 Runtime facade 迁移

场景/全局 Runtime 读写走统一 Feature。

---

## RUN-02 Runtime code draft

语法、协议、Schema、Diff、应用。

---

## RUN-03 Runtime Player producer

作者数据只经 Published producer 进入 Host。

---

## INT-01 简单模板标准化

简单动画/点击入口生成标准 InteractionRule。

---

## INT-02 Automation UI 迁移

专业 UI 不直接操作 Store 内部。

---

## INT-03 Rule code view

JSON 草稿通过 command 应用。

---

## DIAG-04 专业/代码模式整合

完整面板 + JSON report + 按需缓存。

---

# P5：Surface 迁移

## SLIDE-01 Slide selector/command 入口

## SLIDE-02 Slide authoring UI 拆分

## SLIDE-03 Phaser 生命周期与 proxy 收口

## SLIDE-04 删除 Slide 可写 V8 projection

## FLOW-01 Flow model/command 入口

## FLOW-02 FlowWorkspace 组件拆分

## FLOW-03 Flow text/overlay draft 收口

## FLOW-04 Flow export 与 authoring 共用模型

## SPATIAL-01 Spatial model/command 入口

## SPATIAL-02 camera/path/relation 子模块

## SPATIAL-03 world/viewport/session 分离

## SPATIAL-04 Player 与作者状态隔离

## WORKSPACE-01 Workspace 降级为路由

## PROPS-01 Properties 降级为编辑器路由

每个 Surface 可分多张小卡，不应在一个 PR 中整体完成。

---

# P6：运行、导出与清理

## PLAY-01 Published producer 收口

## PLAY-02 Try-run/Preview 共用 mount helper

## PLAY-03 Host destroy 与过期 generation

## EXPORT-01 HTML/Web Package 统一 producer

## EXPORT-02 静态导出计划收口

## EXPORT-03 Export preflight 分层

## CLEAN-01 删除旧写入投影

## CLEAN-02 删除重复 history/session

## CLEAN-03 删除无消费者 adapter/helper

## CLEAN-04 清理历史任务与 reviews

## CLEAN-05 清理孤儿 CSS/测试/文档

## FINAL-01 重建索引与边界检查

## FINAL-02 最终完整验证

## FINAL-03 人工核心流程验收

---

# 工作包规模

默认一张工作卡应满足：

- 单一目标；
- 1–8 个主要源码文件；
- 1–3 个相关测试文件；
- 不同时迁移两个高风险模块；
- 可以独立回滚；
- 目标测试在合理时间内完成。
