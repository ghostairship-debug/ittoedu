# 初始 Feature Matrix

> 本表基于方案基线，用于启动 `MAP-01`。执行时应由源码索引补全精确入口、消费者和测试。

| Feature | 产品定位 | 模式 | Canonical Data | 当前主要入口 | 目标模块 | 状态 |
|---|---|---|---|---|---|---|
| 项目新建/打开/保存/恢复 | 核心 | 全部 | V9 document + sidecars | `App.tsx`、project、main IPC | App/Persistence | core |
| 课程树与 location | 核心 | 全部 | locations/surfaces | `ScenePanel.tsx`、course commands | Editor Core + Surface | core |
| Slide 编辑 | 核心 | 全部 | Slide surface/scenes/layers | Workspace、Phaser、slide commands | Surface/Slide | core |
| Flow 编辑 | 核心 | 全部 | Flow surface/blocks/overlays | FlowWorkspace、flow commands | Surface/Flow | core |
| Spatial 编辑 | 核心 | 全部 | Spatial world/camera/path | spatial commands/UI | Surface/Spatial | core |
| Mixed 课程 | 核心 | 全部 | locations/surfaces | course navigation | Editor Core | core |
| 文本/公式/图形 | 核心 | 全部 | Native LayerItem | Properties/commands | Surface + shared native | core |
| 图片/视频/音频 | 核心 | 全部 | assets/media + sidecar | App、MediaTab、commands | Media/Assets | core |
| 全局层/共享层 | 高级核心 | simple/professional/code | global/surface layer items | layer commands/UI | Global Layers | advanced |
| 教师控制器 | 高级核心 | professional/code；simple 可模板化 | global controller item | Nodes/Properties/Player | Teacher Controller | advanced |
| 组件目录 | 长期核心 | simple/professional/code | Catalog snapshot（非工程） | ComponentsTab、main catalog | Components/Catalog | advanced |
| 工程组件包 | 长期核心 | 全部 | componentPackages + files | package store/lifecycle | Components/Packages | core |
| 组件实例 | 长期核心 | 全部 | LayerItem component | Surface commands/Properties | Components/Instances | core |
| 组件代码编辑 | 高级 | code/professional | Manifest/Runtime draft | DeveloperTab | Components/Authoring | advanced |
| Runtime | 高级核心 | professional/code；simple 模板 | Runtime layer/document | DeveloperTab、runtime host | Runtime | advanced |
| 互动规则 | 高级核心 | 全部按层级暴露 | InteractionRule | Automation/InteractionEditor | Interactions | advanced |
| 常用动画模板 | 核心易用性 | simple | 标准 InteractionRule | Properties/automation | Interactions/Templates | core |
| 代码模式 | 长期核心 | code | canonical data 的草稿视图 | DeveloperTab | UI/Code Mode | advanced |
| 简单模式 | 核心易用性 | simple | UI preference | Toolbar/Sidebar branches | UI Composition | core |
| 专业模式 | 核心能力上限 | professional | UI preference | Toolbar/Sidebar branches | UI Composition | core |
| 结构完整性 | 核心正确性 | 后台/全部 | V9/refs/protocols | projectHealth/CLI | Diagnostics/Integrity | core |
| 教学流程分析 | 高级 | professional/code | derived report | informationRelease | Diagnostics/Authoring | advanced |
| 视觉密度分析 | 高级 | professional/code | derived report | visualDensity | Diagnostics/Authoring | advanced |
| 当前位置试运行 | 核心 | 全部 | Published V2 session | Workspace/CoursePlayer | Preview | core |
| 整课预览 | 核心 | 全部 | Published V2 session | App/CoursePlayer | Preview | core |
| HTML/网页包 | 核心交付 | 全部 | Published V2 | export/course | Export | core |
| PPTX/PDF/DOCX | 核心交付 | 全部 | authoring/static plan | export/course | Export | core |
| AI 课件能力索引 | 长期核心 | 外部 AI | artifacts/ai-capabilities | generator/skills | Product Capability Index | core |
| 开发代码知识图谱 | 开发基础 | 编码 AI | repo-index | 尚未落地 | Repo Knowledge | core |
| 历史任务/评估 | 取证 | 默认不读 | Git 历史/ADR | docs/tasks、reviews | Archive | legacy |

---

## 使用规则

1. `core` 不等于必须显示在简单模式；
2. `advanced` 不等于可删除；
3. `experimental` 应有明确入口和成熟条件；
4. `legacy` 才进入删除评估；
5. 每个 Feature 后续补充 entrypoints、commands、selectors、tests 和 aliases；
6. 一项能力可跨多个 Surface，但只应有一个业务所有者模块。
