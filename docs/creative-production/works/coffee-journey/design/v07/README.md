# 《一杯咖啡的远行》v07｜正式参考作品入口

**当前作品基线：Project schema 11 / r215（2026-10-23）。** 这是继 v06/r204 之后的艺术精修版：六种摄影级主体形态、六段连续材料转化、U03 材料剖面与原生 Flow 合并装配。核心工程、单文件离线交付和证据已经存在；本页仅整理交付，不表示 Owner 已审美签收。

## 直接打开

| 目的 | 当前入口 |
| --- | --- |
| 继续在果铃里编辑 | [正式可编辑 GLX](native/coffee-journey-v07.glx)（r215） |
| 脱离果铃阅读/演示 | [正式单文件离线 HTML](native/coffee-journey-v07-offline.html) |
| 观看六段素材形变 | [独立离线材料审片](art-studies-offline.html)（可连续播放，不是整篇正式交付） |
| 核对真实导航中间帧 | [正式离线作品转场审片页](previews/MOTION_REVIEW.html) |
| 快速看视觉成果 | [截图目录](previews/README.md) |
| 对象、身份和路径 | [OBJECT_INDEX](native/OBJECT_INDEX.json) |
| 最终状态与限制 | [CLOSEOUT](CLOSEOUT.md)、[VERIFICATION](VERIFICATION.md) |
| 全部交付校验 | [DELIVERY_MANIFEST.json](DELIVERY_MANIFEST.json) |

## 按任务选资料

- **修改背景材质或转场**：读 [BACKGROUND_RUNTIME](BACKGROUND_RUNTIME.md) → [background-stages.js](background-stages.js) → [background-runtime.js](background-runtime.js)，资源接入见 [background-entry.js](background-entry.js) / [background-assets.css](background-assets.css)。
- **替换物件与检查来源**：读 [ASSETS](ASSETS.md) 与 [assets/manifest.json](assets/manifest.json)；原始 PNG、正式 WebP、生成描述和配准变换分别保留。
- **修改 U03 图解**：读 [U03 源码集成说明](programs/u03/INTEGRATION.md) → [build_u03.py](programs/u03/build_u03.py)。修改过的源码必须重新经正式作者事务应用。
- **找可复用机制**：读 [REFERENCE_CASES](REFERENCE_CASES.md)，按问题选一个案例，不必一次加载全部工程。
- **判断是否真实通过**：读 [VERIFICATION](VERIFICATION.md) 对应证据文件，尤其区分正式导航 50 帧与孤立艺术工作台 30 帧。
- **接续交接**：读 [项目交接](../../handoff/NEXT_PASS.md)。

## 工程边界

原生 Flow 图文、导航/阅读状态、U03/U05/U06 三个独立局部程序与**唯一 Global Underlay** 保留；原生实例总数 **183**。U05 原三关键帧逻辑、U06 数学模型/声音/交互未因 v07 重制；v06/r34 的糖水跨主题复用样例继续使用，不冒称有新的 v07 糖水交付。新艺术源文件本身不自动进入 GLX；当前作者事实始终以正式 GLX、正式 Session 事务和保存链为准。

**历史保留**：[v06/r204](../v06/README.md) 和 [v05/r179](../v05/README.md) 均未覆盖。不要以 v06 旧版 ROOT README 或旧 U03 SVG 为当前版本。未提交 Git、未推送、未发行、未部署；本轮文档收口亦不修改工程正文/源码。
