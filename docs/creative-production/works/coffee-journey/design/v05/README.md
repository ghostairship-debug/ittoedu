# 《一杯咖啡的远行》v0.5｜设计源码与正式交付

**当前工程为 Project 11 / revision 179。** 本目录保留可阅读的独立 HTML 设计源、局部互动源码、素材与正式 GLX；完整作品/交接入口在 [作品首页](../../README.md) 与 [NEXT_PASS](../../handoff/NEXT_PASS.md)。

## 可以打开或继续改的文件

- [正式 GLX](native/coffee-journey-v05.glx)：果铃里的**唯一当前正式作者工程**；复制副本后修改并按正式事务保存。
- [正式离线 HTML](native/coffee-journey-v05-offline.html)：r179 导出的冻结单文件验证品，不是作者源。
- [独立 HTML 阅读源](index.html)：另一个可运行的响应式设计参照。修改本目录 JS/CSS/图片不会自动写入已保存的 GLX。
- [交付哈希与状态](DELIVERY_MANIFEST.json)。
- [参考案例索引](REFERENCE_CASES.md)：先选设计意图和可复用等级，再局部读源码。

## 源文件分工

| 任务 | 源文件 | 使用注意 |
| --- | --- | --- |
| 七章独立 HTML 的阅读结构 | `index.html`, `article.css`, `article.js`, `complete.css` | 不能把独立网页直接当作正式 GLX 共同事实 |
| 处理三状态 | `u03.html`, `content.json`, `content.js`, `lab.js`, `labs.css` | 更改状态要同时检查图像、图层、步骤与比较返回 |
| U03 组织 SVG | `build_diagrams.py`、`assets/*-layers.svg` | 更新模式/图解后需重看 390px 文字、颜色和图例 |
| 烘焙观察 | `u05.html`, `lab.js`, `assets/green|gold|roast.webp` | 已通过关键中间帧，不机械重生三张图片 |
| 水与稀释 | `u06.html`, `water.config.js`, `water.js`, `water.css` | 状态为唯一计算源；移动端图形显示需精修 |
| 有条件复用的糖水主题 | [糖水独立样例](reuse/sugar-water/index.html) | 只完成 HTML 跨主题验证，尚非 GLX 移植证明 |
| 可重建的局部数据 | `build.py`, `content.json` | `build.py` 会重新生成 `u03.html`、`u05.html` 和 `content.js`，运行前确认保留了本轮有意修改 |

## 设计与引用入口

- [AI_CREATIVE_GUIDE](AI_CREATIVE_GUIDE.md)：从设计目的到编辑和真实验收。
- [SCENE_PATTERNS](SCENE_PATTERNS.md)：五种图文/交互组合。
- [REUSE_GUIDE](REUSE_GUIDE.md)：配置契约与适用/不适用场景。
- [ART_DIRECTION](ART_DIRECTION.md)、[ASSETS](ASSETS.md)：视觉体系及素材来源。
- [正式装配与修改](native/ASSEMBLY_GUIDE.md)：GLX 中的对象身份和持续编辑方式。
- [小型复用事实与截图](evidence/)：糖水独立 HTML 的记录；其它正式回归证据按 manifest 指向 output。

**旧版隔离**：已经归档的 r73、阶段性的 GLX、早期离线包、旧脚本及其报告不属于此目录的现行可运行资产。结构改变后以当前 GLX 的真实投影获取实例及文件路径，勿把历史 SOURCE_MAP 和对象 ID 当常量。
