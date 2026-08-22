# Feature Manifest 模板

该模板用于编写 `repo-index/semantic/features.json` 中的一项。

```json
{
  "id": "feature:<id>",
  "name": "<中文名称>",
  "summary": "<一句话说明>",
  "status": "core",
  "aliases": [
    "<中文别名>",
    "<英文关键词>",
    "<历史命名>"
  ],
  "modes": ["simple", "professional", "code"],
  "surfaces": ["slide", "flow", "spatial"],
  "entrypoints": [
    "src/renderer/features/<feature>/index.ts"
  ],
  "canonicalFiles": [],
  "reads": [],
  "writes": [],
  "commands": [],
  "selectors": [],
  "ui": {
    "simple": [],
    "professional": [],
    "code": []
  },
  "runtimeConsumers": [],
  "exportConsumers": [],
  "contracts": [],
  "tests": [],
  "invariants": [],
  "relatedFeatures": [],
  "legacyPaths": [],
  "notes": ""
}
```

## 填写规则

- `status`：`core | advanced | experimental | legacy`；
- `canonicalFiles` 只列真正入口，不列全部实现；
- `writes` 写数据语义，不只写文件路径；
- `tests` 只列高信号测试；
- `legacyPaths` 必须有替代路径或删除条件；
- 不复制源码内容。
