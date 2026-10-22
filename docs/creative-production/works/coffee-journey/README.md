# 《一杯咖啡的远行》｜当前作品入口

**当前有效工程：v0.5，Project 11，revision 179（2026-10-22 核验）。** U01—U07 已形成同一 Flow 下的完整作品：7 个有界原生 group、62 个原生文字对象、8 个文档标题、8 张原生图片、3 段局部程序。代表性的编辑／撤销／保存／冷开及 1440／390px 单 HTML 断网播放已通过。**尚未完成最后一轮创作收口，也未发行或获得 Owner 最终接受。**

## 唯一当前入口

| 用途 | 文件 |
| --- | --- |
| **果铃继续创作** | [当前 GLX](design/v05/native/coffee-journey-v05.glx)，r179；修改前复制新命名副本 |
| **已核验的正式离线交付** | [单文件 HTML](design/v05/native/coffee-journey-v05-offline.html) |
| 独立响应式设计源 | [七章网页](design/v05/index.html)，不是 GLX 的第二个正式作者稿 |
| 修改方法及源码、图片 | [v05 设计与源文件](design/v05/README.md) |
| 继续任务与验收边界 | [NEXT_PASS](handoff/NEXT_PASS.md) |
| 供 AI 选择的案例 | [REFERENCE_CASES](design/v05/REFERENCE_CASES.md) |
| 素材来源、许可及生成说明 | [ASSETS](design/v05/ASSETS.md) |

版本和 SHA-256 由 [交付 Manifest](design/v05/DELIVERY_MANIFEST.json) 记录。上述正式工程和离线文件已从 2026-10-22 经验证的 r179 冻结原件逐字节复制到本目录，原始 output 文件保留用于核对。勿使用带审查标记的 r183/r188 副本继续创作。

## 可以借鉴和复用什么

- **图文设计**：U01/U07 首尾呼应；U02 人物主图＋环境副图；U04 安静章节节奏。
- **可改写交互**：U03 同时点多状态比较，U05 三关键帧连续演变；不把它们当作任意主题的一键通用组件。
- **有条件的配置复用**：U06 固定溶质稀释机制在独立 HTML 中已迁移至糖水主题；正式 GLX 跨题材迁移尚未验证。
- **工程组合**：Flow 原生段落／图片包围三个局部 HTML 程序，正文、图注保留独立编辑身份。

详见 [场景模式](design/v05/SCENE_PATTERNS.md)、[AI 创作指南](design/v05/AI_CREATIVE_GUIDE.md)、[复用契约](design/v05/REUSE_GUIDE.md)。

## 收口尚需什么

1. U06 动态图解层次、信息重点与手机画布标注可读性；
2. U03 SVG 组织区分及三路线并排比较的视觉信息；
3. U05 只做最后代表性验收，不重做成熟关键帧；
4. U06 迁移到另一主题的**正式 GLX**并验证编辑、保存、冷开及离线交付；
5. 跨章节背景 Runtime 的连续物件动画是新提议，**尚未开发或验证**；初步判断与最小验证范围见 [背景 Runtime 方案](handoff/BACKGROUND_RUNTIME_CONCEPT.md)。

曾经的“Flow 已挂载程序热编辑 append 失败”“手机整篇同比缩小”“内置源码分发导致新建／导出失败”已由软件批次处理。当前仍可能存在有界构图内部按作者画幅缩放、大 HTML 保存等待等受限场景，不能把旧诊断继续当成当前阻断。

**历史隔离**：v03、v04、next-round、旧交接及 r73 阶段交付，已移出默认作品树，备份与清单见 `output/coffee-document-cleanup-20261022/`。它们不参与默认创作检索，不应覆盖本页和 NEXT_PASS 的现行判断。
