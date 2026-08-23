# 组件体系：Catalog、工程包、实例与 Authoring

组件是长期核心能力。本轮只降低实现耦合，不删除组件路线。

## 1. 四个子域

### Catalog

回答“有哪些组件可供加入”。来源可为内置、本地目录和未来可信远程源。Catalog snapshot 不是工程真相。

### Project Packages

回答“工程真正嵌入了哪些组件版本和字节”。Canonical：

```text
CourseProjectDocument.componentPackages
+ component archive files / runtime bytes
```

### Instances

回答“具体 Surface 上放置了哪些组件”。Carrier 必须 Surface-specific：

- Slide/Spatial/Flow overlay：`ComponentLayerItem`；
- Flow 稿纸：`FlowComponentBlock`；
- global/surface shared：`ScopedLayerItem`。

### Authoring

回答“如何编辑可编辑组件副本”：Manifest、Props Schema、Runtime、静态后备、验证、Diff。

## 2. 目标边界

```text
features/components/
├── index.ts
├── catalog/
├── packages/
├── authoring/
└── shared/

surfaces/*/
└── componentPlacement.ts
```

不建议建立一个通用 `instances/commands.ts` 直接创建所有 Surface 实例，因为它会再次抹平 Flow carrier 差异。通用实例能力只包含：

- stable package/version ref；
- props validation；
- compatibility；
- static fallback 合同。

## 3. 安装与更新

### 安装

```text
Catalog/local bytes
→ package validation
→ trust/integrity checks
→ metadata + component files
→ Core transaction/resource changes
→ package available to all Surface placements
```

### 更新

```text
new package
→ version/hash/compatibility
→ enumerate dependent instances
→ produce update plan and warnings
→ atomic package metadata + bytes update
→ preserve stable instance identity
```

更新不自动改变每个实例 props，除非 migration 明确、可回滚且通过 schema。

## 4. 创建实例

```text
installed package
→ package service returns defaults/preset
→ current Surface placement command creates correct carrier
→ Core transaction commits
→ one history entry
```

Flow 稿纸不得被转成 z-order LayerItem。

## 5. 当前入口与稳定化边界

### 简洁编辑

当前组件入口不完整。本轮不借稳定化新增推荐入口或改变教师工作流；只保证已有入口、已安装组件和本地导入不被破坏。新入口另列产品 Epic。

### 专业编辑

保护当前 Catalog、来源、版本、安装/更新/替换、props、实例使用情况和 fallback；ARCH-2 只做 package/resource transaction 与公共边界收口。

### 现有 DeveloperTab

保留当前 Component Manifest/Runtime 编辑与校验后应用。本轮不新增实例 JSON、结构化 Diff 或独立 Code Workspace 产品界面。

现有入口共用 package service；placement 仍由 Surface command 负责。

## 6. Catalog unavailable

- 显示清晰空状态；
- 本地导入与工程已安装包继续可用；
- 可为当前课新建组件；
- 不删除 Catalog 架构；
- 不提前建设认证/商店/远程同步平台；
- 外部目录变化通过现有能力索引摘要体现，不纳入 repo-index V1 源码图。

## 7. Player 与 Export

- Player 使用与工程保存相同的 package bytes；
- 缺包或不兼容显示明确 fallback/error；
- mount/destroy 不写回作者文档；
- HTML/Web 包嵌入运行所需字节；
- 静态导出使用明确 fallback/snapshot；
- Package lifecycle、实例 carrier 和格式 adapter 分别测试。

## 8. 迁移重点

- 从 ComponentsTab 拆 UI，不先改业务；
- 建立窄 Components facade；
- 列出 package/instance/authoring consumers；
- 迁移代码草稿到统一 transaction；
- 最后处理旧深层 import；
- 不把组件文件字节再次复制成新的 Store 真相。
