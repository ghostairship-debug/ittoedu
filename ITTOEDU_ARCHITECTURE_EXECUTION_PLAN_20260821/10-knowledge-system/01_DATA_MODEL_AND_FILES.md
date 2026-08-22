# 项目知识图谱的数据模型与文件布局

---

## 1. 目录布局

```text
repo-index/
├── README.md
├── semantic/
│   ├── features.json
│   ├── modules.json
│   ├── invariants.json
│   ├── aliases.json
│   └── exclusions.json
├── generated/
│   ├── manifest.json
│   ├── files.jsonl
│   ├── symbols.jsonl
│   ├── edges.jsonl
│   ├── tests.json
│   ├── contracts.json
│   ├── scripts.json
│   └── docs.json
└── contexts/
    └── .gitignore
```

`semantic/` 进入 Git；`generated/` 建议进入 Git，以便云端 Agent 不运行生成器也能读取。`contexts/` 不进入 Git。

---

## 2. 节点类型

### File

```json
{
  "id": "file:src/renderer/ui/ComponentsTab.tsx",
  "path": "src/renderer/ui/ComponentsTab.tsx",
  "kind": "tsx",
  "bytes": 26330,
  "sha256": "...",
  "exports": ["ComponentsTab", "ComponentLibraryDialog"],
  "tags": ["renderer", "ui"]
}
```

### Symbol

```json
{
  "id": "symbol:src/.../ComponentsTab.tsx#ComponentsTab",
  "fileId": "file:src/.../ComponentsTab.tsx",
  "name": "ComponentsTab",
  "kind": "function-component",
  "startLine": 120,
  "endLine": 390,
  "exported": true
}
```

### Feature

人工维护：

```json
{
  "id": "feature:components",
  "name": "组件体系",
  "summary": "目录、工程包、实例、属性和代码编辑",
  "aliases": ["组件库", "component catalog", "component package"],
  "canonicalFiles": [
    "src/renderer/components/componentPackageStore.ts",
    "src/shared/componentPackageLifecycle.ts"
  ],
  "writes": [
    "CourseProjectDocument.componentPackages",
    "component sidecar",
    "LayerItem(kind=component)"
  ],
  "modes": ["simple", "professional", "code"],
  "tests": [
    "tests/unit/componentPackageLifecycle.test.ts",
    "tests/e2e/componentCatalogMatrix.spec.ts"
  ]
}
```

### Module

```json
{
  "id": "module:renderer-core",
  "name": "Renderer Core",
  "publicEntrypoints": ["src/renderer/core/index.ts"],
  "allowedDependencies": ["shared", "renderer-features-pure"],
  "forbiddenDependencies": ["player-ui", "main"]
}
```

### Contract

- Course Project V9；
- Published Course V2；
- Component API 4；
- Runtime API 2/3；
- Interaction API；
- IPC types。

### Test

记录：

- 测试文件；
- 测试名称；
- 引用源码；
- Feature；
- 层级；
- 是否 E2E；
- 运行命令。

---

## 3. 边类型

V1 只需要以下关系：

| 边 | 含义 |
|---|---|
| `contains` | Module/Feature 包含 File/Symbol |
| `imports` | 文件导入文件 |
| `exports` | 文件导出符号 |
| `implements` | 文件或符号实现 Feature/Contract |
| `reads` | Feature 读取数据 |
| `writes` | Feature 写入数据 |
| `renders` | UI/Player 渲染 Feature |
| `produces` | 生成 Published/Export 数据 |
| `validates` | 校验 Contract/Feature |
| `tested_by` | 文件/Feature 被测试覆盖 |
| `legacy_of` | Legacy 路径与替代路径 |
| `entrypoint_of` | 公共入口属于模块 |

不在 V1 中尝试精确构建函数级调用图。

---

## 4. 人工语义文件

### `features.json`

每个产品能力一条，字段：

- id；
- name；
- summary；
- aliases；
- status；
- modes；
- canonicalFiles；
- entrypoints；
- writes；
- reads；
- runtimeConsumers；
- exportConsumers；
- tests；
- invariants；
- legacyPaths；
- relatedFeatures。

### `modules.json`

描述目标依赖边界，不重复记录自动 Import 图。

### `invariants.json`

只记录跨任务必须保持的硬约束。

### `aliases.json`

处理：

- 中文/英文；
- 旧命名；
- 产品文案；
- 文件命名差异；
- 常见错拼。

### `exclusions.json`

排除：

- node_modules；
- 构建产物；
- 二进制；
- 历史任务；
- 大型生成 Schema；
- 示例导出产物。

---

## 5. Manifest

```json
{
  "schemaVersion": 1,
  "repository": "ghostairship-debug/ittoedu",
  "head": "690411...",
  "generatedAt": "2026-08-21T...",
  "generatorVersion": 1,
  "sourceFileCount": 0,
  "symbolCount": 0,
  "edgeCount": 0,
  "semanticHash": "...",
  "status": "fresh"
}
```

---

## 6. 数据规模控制

- 文件与符号使用 JSONL，避免一个超大 JSON；
- 不存储完整源码；
- 不复制 Schema 正文；
- 只记录行号和摘要；
- Context Pack 再按需读取源码；
- 生成物总大小目标控制在数 MB，而非数十 MB。
