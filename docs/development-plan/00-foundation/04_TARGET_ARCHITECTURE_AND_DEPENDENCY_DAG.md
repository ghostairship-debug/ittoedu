# 目标架构、依赖 DAG 与目录方向

## 1. 目标依赖关系

```text
UI shell / routes / panels
             ↓ depends on
renderer/app + use-case composition
             ↓
Surface adapters       Feature adapters
Slide / Flow / Spatial Component / Media / Runtime / ...
             ↘       ↙
        renderer/core ports
                 ↓
     shared/contracts + shared/domain

authoring V9 → Published producer → Player / Preview / Export
                只读取，不反向写入作者数据
```

箭头明确表示“使用方依赖被使用方”。Core 不能 import 具体 `SlideSelection`、`FlowSelection` 或 Feature UI。这是目标边界，不得伪装成当前已完成的目录事实。

## 2. Core 只拥有

- canonical document 的读取与提交 port；
- projectId / revision；
- authoring identity 和 stale-target guard；
- 通用 history entry 语义；
- sidecar/component resource delta 接口；
- dirty、path 等应用级状态边界；
- 稳定 selector 和 typed hooks。

Core 处理的“活动作者身份”依托当前 exactly-one-active V9 session。目标是让 canonical document 不再由 Surface 切换方式推断，不是引入一个新 ActiveEditor 或无 session 真相。

Core 不拥有：

- Flow block 布局算法；
- Spatial camera/path 细节；
- Phaser 生命周期；
- Component Catalog UI；
- Runtime 代码编辑器；
- Export 格式实现。

## 3. Surface 与 Feature 的组合

跨域动作由 use-case composition 完成。例如“从 Catalog 插入 Flow 稿纸组件”：

```text
Components package service  提供 package/default props
Flow placement command      生成 FlowComponentBlock
Core transaction port       原子提交 document + 必要 resource delta
App/UI                      组合并呈现结果
```

Components Feature 不创建通用 `LayerItem` 来绕过 Flow 模型；Flow 也不复制组件包安装逻辑。

## 4. 推荐目录方向

目录是迁移方向，不要求一次搬完：

```text
src/renderer/
├── app/                 # 项目生命周期与跨域用例组合
├── core/                # ports、selectors、transaction、history、authoring identity
├── surfaces/
│   ├── slide/
│   ├── flow/
│   └── spatial/
  ├── features/
│   ├── components/
│   ├── media/
│   ├── runtime/
│   ├── interactions/
│   ├── global-layers/
│   ├── teacher-controller/
│   └── diagnostics/
├── project/
├── preview/
├── export/
├── ui/
└── styles/
```

现有 `course/`、`authoring/`、`phaser/` 不先整体移动，而是在职责被真实迁移时逐文件归属。该目录图是 owner 参考，不是必须全部新建的交付清单；能通过删除旁路和收窄现有入口达到边界时，优先不新增目录。

## 5. 依赖允许/禁止

### 允许

- Surface/Feature → Core public ports；
- Surface/Feature → shared contracts/domain；
- App composition → Core + Surface/Feature public API；
- Player → shared published/contracts；
- Export adapter → Published payload / authoring static plan。

### 禁止

- Core → 具体 Surface 或 Feature；
- shared → renderer；
- player → renderer/store；
- Feature A → Feature B 内部文件；
- Surface → App；
- UI → history 内部数组；
- Preview/Export → 写 Store；
- 新模块 → `legacyUseEditorStore`；
- Derived projection → 回写 V9。
- 普通稳定化任务 → 修改 `src/shared/contracts/**`。合同默认只读；任何 additive 变更必须转为独立合同任务。

## 6. 公共入口规则

每个公共入口只导出真正跨模块需要的：

```text
selectors
narrow typed hooks
commands/use-case inputs
validators
ports/types
```

不得导出整个 Zustand Hook、内部 slice、可写历史数组或 UI 私有组件。

## 7. 文件规模规则

- 文件过大是拆分线索，不是硬失败；
- 只有职责和 owner 清楚后才移动；
- 不为达到行数目标制造大量一函数文件；
- 新功能不得继续把完整业务逻辑塞入上帝文件，迁移期薄接线例外必须带删除任务。
