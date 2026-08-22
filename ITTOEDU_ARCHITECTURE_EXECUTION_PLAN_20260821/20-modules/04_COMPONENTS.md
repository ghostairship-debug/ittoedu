# 组件体系：Catalog、工程包、实例与代码编辑

组件是长期核心能力，不删除；需要把当前混合职责拆清楚。

---

## 1. 四个子域

### Catalog

“有哪些组件可以加入工程”。

来源：

- 内置；
- 本地目录；
- 未来远程可信源。

数据是可发现清单，不是工程真相。

### Installed Packages

“当前工程真正包含哪些组件字节与元数据”。

归属：

- `CourseProjectDocument.componentPackages`；
- component sidecar files。

### Instances

“某个 Surface 上有哪些组件实例”。

归属：

- `LayerItem(kind='component')`；
- frame、props、visibility、scope。

### Authoring

“如何修改可编辑组件副本”。

内容：

- Manifest；
- Props Schema；
- Runtime；
- 静态后备；
- 校验；
- Diff。

---

## 2. 目标目录

```text
features/components/
├── index.ts
├── catalog/
│   ├── types.ts
│   ├── selectors.ts
│   ├── sources.ts
│   └── CatalogBrowser.tsx
├── packages/
│   ├── packageStore.ts
│   ├── lifecycle.ts
│   └── InstalledPackages.tsx
├── instances/
│   ├── selectors.ts
│   ├── commands.ts
│   └── ComponentProperties.tsx
├── authoring/
│   ├── validation.ts
│   ├── drafts.ts
│   └── ComponentCodeEditor.tsx
└── shared/
```

---

## 3. 数据流

安装：

```text
Catalog entry / local package
→ validate package
→ create package metadata
→ add component bytes to sidecar
→ one Editor transaction
→ package becomes available to all surfaces
```

创建实例：

```text
installed package
→ choose preset/default props
→ current Surface command
→ add LayerItem(kind=component)
→ one history entry
```

更新组件包：

```text
new package bytes
→ version/hash/compatibility check
→ analyze instances
→ plan update
→ transaction replaces package metadata + bytes
→ instances preserve stable identity
```

---

## 4. 三模式整合

### 简单模式

- 推荐组件；
- 已安装组件；
- 常用 props；
- 拖入画布；
- 自动处理版本细节。

### 专业模式

- 完整 Catalog；
- 来源、版本、质量和兼容性；
- 安装/更新/替换；
- 全部 props；
- instance 使用情况；
- scope 与后备资源。

### 代码模式

- Manifest；
- Runtime；
- Props Schema；
- 实例 JSON；
- Diff；
- 校验后应用。

三种模式共用 package/instance command。

---

## 5. Catalog 当前 unavailable 的处理

- 空目录显示清晰空状态；
- 本地导入仍可用；
- 工程已安装组件仍可用；
- 不删除 Catalog 架构；
- 不为未来远程源提前做认证平台；
- Source 接口保持简单，真实源出现后扩展。

---

## 6. 与 Surface 的关系

Surface 只负责：

- 实例位置/布局；
- 当前 scope；
- selection；
- Surface 专属框架。

Component Feature 负责：

- 包；
- props；
- Runtime；
- 版本；
- 校验。

避免每个 Surface 复制组件安装逻辑。

---

## 7. 与 Player/Export 的关系

Player：

- 按同一 package bytes 挂载；
- 实例缺包时显示 fallback/error；
- 不写回作者文档。

Export：

- HTML/网页包保留互动；
- PPTX/PDF 使用静态捕获/fallback；
- preflight 复用组件校验。

---

## 8. 迁移顺序

1. 建 `features/components/index.ts` facade；
2. 把现有公共函数从旧路径 re-export；
3. 拆 Catalog UI；
4. 拆 installed packages；
5. 拆 instance commands/selectors；
6. 拆 authoring；
7. 简单/专业/代码模式改用同一 facade；
8. 迁移 Surface 消费者；
9. 删除旧 ComponentsTab 巨型接线和重复逻辑。

---

## 9. 完成标准

- Catalog、package、instance、authoring 概念不再混用；
- 三模式共用命令；
- 三 Surface 共用包生命周期；
- 保存、运行和导出使用同一 bytes；
- 空 Catalog 不影响本地组件和工程组件；
- 组件未来增强不需要扩大 Store/App。
