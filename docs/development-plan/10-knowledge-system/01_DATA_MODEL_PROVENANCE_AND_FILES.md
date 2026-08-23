# repo-index 数据模型、Provenance 与文件布局

## 1. 目录

```text
repo-index/
├── README.md
├── semantic/
│   ├── features.json
│   ├── modules.json
│   ├── invariants.json
│   └── exclusions.json
├── generated/
│   ├── manifest.json
│   ├── files.jsonl
│   ├── symbols.jsonl
│   ├── edges.jsonl
│   ├── tests.jsonl
│   ├── contracts.json
│   ├── scripts.json
│   └── docs.json
├── golden-tasks/
│   ├── tasks.json
│   └── expected.json
└── contexts/
    └── .gitignore
```

`semantic/`、`generated/` 与黄金任务进入 Git；临时 Context Pack 不进入 Git。

## 2. 事实与意图必须分开

每条记录包含：

```json
{
  "origin": "generated | semantic",
  "statusClass": "current-must-preserve | current-debt | target-acceptance | transitional-allowance",
  "evidence": ["path-or-symbol"],
  "schemaVersion": 1
}
```

- generated 描述源码当前事实；
- semantic 描述 Feature owner、目标边界和硬约束；
- target 不得伪装成 current；
- transitional 必须带删除阶段或 review gate。

## 3. 输入域与 Hash 单一归属

严格 freshness 使用四个互斥输入域；同一个相对路径只能属于其中一个域，禁止为“保险”重复计入多个 Hash：

| Hash | 唯一输入域 |
|---|---|
| `sourceTreeHash` | 被索引的产品源码、测试、合同正文和普通文档；排除 config、tool、semantic、generated |
| `semanticHash` | `repo-index/semantic/**` |
| `configHash` | `tsconfig.json`、`tsconfig.electron.json`、`tsconfig.e2e.json` 与 repo-index 自身扫描/排除配置 |
| `toolHash` | `scripts/repo-index/**`、生成/查询入口、`package.json`、`package-lock.json` 和实际解析器版本 |

生成器先输出排序后的 input inventory：`normalizedPath → domain → contentHash`。若一个路径重复归属、没有归属或落入 generated 自引用，`--check` 必须失败。`generatorVersion` 是格式/行为版本标记，不能替代真实 `toolHash`。

三个 tsconfig 的文件集合取并集；同一共享文件只建立一个 File 节点，并记录它来自哪些 project，而不是重复生成记录。

## 4. V1 节点

### File

记录 path、kind、bytes、content hash、exports、tags。这里的 hash 是 repo-index 输入文件 hash，不是 Course Project `AssetMeta` 字段。

### Symbol

仅记录顶层导出或高信号声明：name、kind、file、start/end line、exported、JSDoc 摘要。

### Test

记录 test file、describe/test 名称、层级、运行命令和静态关联。

### Contract

直接摄取：

- `src/shared/contracts/**`；
- `docs/contracts/**`；
- `artifacts/contracts/contract-manifest.json`；
- 当前协议版本与生成 check 命令。

### Script

记录 package script、入口脚本和用途，不执行脚本。

### Feature / Module / Invariant

人工维护，数量保持少而稳定。

## 5. V1 自动边

```text
contains
imports
imports_type
imports_dynamic
re_exports
exports
entrypoint_of
tested_by
references_contract
```

不在 V1 自动生成：

- 精确函数调用图；
- 业务 reads/writes；
- renders/produces 全量推断；
- 运行时依赖。

这些高层关系只在 Feature semantic 中人工记录高信号项。

## 6. Feature 语义

示例：

```json
{
  "id": "feature:components",
  "name": "组件体系",
  "aliases": ["组件库", "component catalog", "component package"],
  "statusClass": "current-debt",
  "canonicalFiles": [
    "src/shared/contracts/component-v4/index.ts",
    "src/shared/componentPackageLifecycle.ts"
  ],
  "entrypoints": [],
  "carriers": {
    "slide": "ComponentLayerItem",
    "flowPaper": "FlowComponentBlock",
    "flowOverlay": "ComponentLayerItem",
    "spatial": "ComponentLayerItem"
  },
  "runtimeConsumers": ["src/player/surfaces/publishedComponentMount.ts"],
  "tests": ["tests/unit/componentPackageLifecycle.test.ts"],
  "invariants": ["component-package-instance-separation"]
}
```

Alias 只存于 `features.json`，不再单独维护第二份 aliases 真相。查询器运行时构造反向索引。

## 7. Module 语义

Module 记录：

- 当前或目标 owner；
- public entrypoints；
- allowed dependencies；
- forbidden dependencies；
- status：existing/partial/planned；
- transitional deep imports；
- owner review phase。

不要在 modules.json 手工复制完整 import graph。

## 8. Exclusions

默认排除：

- `node_modules`；
- dist/release/build 产物；
- 大型导出 HTML 和二进制；
- `repo-index/generated/**` 自身；
- contexts；
- 大型生成 Schema 正文；
- 已归档任务正文。

合同 Manifest、文档标题和路径仍可作为轻量节点摄取。
