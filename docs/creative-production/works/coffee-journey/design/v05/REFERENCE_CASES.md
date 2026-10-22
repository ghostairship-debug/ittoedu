# 咖啡作品｜可检索的参考案例清单（v0.1）

**作品基线**：[Project 11 / r179](native/coffee-journey-v05.glx)。该清单为人工和 AI 选择参考的短索引，当前没有实现自动 RAG、组件注册或后台检索服务；展开时只需读相关案例和实际 Source，不读整篇作品。

| ID | 想解决的设计问题 | 参考章节 | 使用等级 | 核心限制 |
| --- | --- | --- | --- | --- |
| `coffee-editorial-arc` | 从熟悉场景进入陌生过程，再回到开篇建立新理解 | U01/U07 | 设计参考 | 重写主题与画面；不沿用咖啡语义 |
| `coffee-editorial-dual-photo` | 人物动作主图 + 环境小图 + 独立正文 | U02 | 结构参考 | 按新素材主体位置重排，不能机械固定照片比例 |
| `coffee-quiet-handover` | 在互动密集叙事中制造静态阅读缓冲 | U04 | 设计参考 | 不为了复用而强加交互 |
| `coffee-alternative-states` | 同一时点比较几种方案的材料/状态差异 | U03 | 可改写机制 | 当前渲染依赖三路线、四层组织；需改写，不是通用比较器 |
| `coffee-keyframes` | 同一物件的连续可视变化、手动拖动和自动播放 | U05 | 可改写机制 | 帧间对齐；进度仅为视觉参数，不保证几何 morph |
| `coffee-fixed-solute` | 改变一个量、观察不变量，图像/数值/文字由同一状态驱动 | U06 | 已验证 HTML 配置复用 | 只适用于固定溶质稀释；GLX 跨题材迁移尚待验证 |
| `coffee-native-hybrid` | 文字和图注可原生编辑，复杂互动仍保持程序整体 | U01—U07 | 已验证工程组织 | 必须按当前工程映射目标；不可从历史对象 ID 拷贝 |

## 按需深读（最小内容）

- **视觉/章节组织**：先读 [场景模式](SCENE_PATTERNS.md) 和 [AI 指导](AI_CREATIVE_GUIDE.md) 对应章节。U01/U07 观看同一只杯子的开篇与结尾；U02/U04 是两种对比鲜明的图文节奏。
- **U03 多状态比较**：读 `content.json` 的 `methods`、`u03.html`、`lab.js`，结构图由 `build_diagrams.py` 生成。选择、详情、比较是不同状态；需要视觉增强但不要改变返回时所选路线。
- **U05 关键帧**：读 `assets/green.webp`、`gold.webp`、`roast.webp`，`u05.html` 与 `lab.js` 中 roast 部分。参考三张图配准和两段不透明底帧融合；素材一变必须重新目视中间帧。
- **U06 稀释**：读 `water.config.js`、`water.js`、`water.css`、`u06.html`；迁移时参考 `reuse/sugar-water/water.config.js` 和 [复用契约](REUSE_GUIDE.md)，已有 [浏览器迁移事实](evidence/sugar-water-browser-facts.json) 与 [截图](evidence/sugar-water-preview.jpg)。
- **正式编辑组织**：读 [ASSEMBLY_GUIDE](native/ASSEMBLY_GUIDE.md)；正式可修改对象路径只从当前 GLX/软件投影取得。

## 可用性与版本

- U03/U05/U06 在 r179 正式单 HTML 中已通过桌面和手机的代表性交互与离线验证；其**视觉质量**仍有下轮 U03/U06 精修计划。
- U06“只改配置、同引擎复用到糖水”目前仅独立 HTML 验证；不可检索成任意模拟的现成通用组件，也不可写成 GLX 跨主题已完成。
- 本作品背景连续咖啡物件 Runtime 目前只是候选想法，**没有制作、验收、入库**；不得作为已存在的案例推荐。
- 后续若创建真正的软件检索增强系统，索引这份简明案例元数据，并按需返回截图、具体对象、源码与验收记录；旧备份 ZIP 不进入默认索引。
