# 《一杯咖啡的远行》｜当前正式作品入口

**唯一当前正式版本：v08 Runtime-first / Project 11 / r264（2026-10-25本地日期）。** [最终交付与证据](design/v08-runtime-first/final-20261025/README.md)包含[最终GLX](design/v08-runtime-first/final-20261025/coffee-journey-v08-runtime-first-final.glx)、[离线HTML](design/v08-runtime-first/final-20261025/coffee-journey-v08-runtime-first-final.html)、真实桌面/移动端交互、原生编辑、独立冷开及导出记录。r263原件保留在design/v08-runtime-first/native；旧design/v08、r247及以下历史不再作为主基线。

[Runtime-first体系与独立创作验证](runtime-first-system-20261025/README.md)在独立目录开展，不继续修改冻结咖啡样本。

以下是历史v07资料，保留追溯用途。

## v07既有交付基线

| 用途 | 文件 |
| --- | --- |
| 果铃继续编辑 | [v07 正式 GLX](design/v07/native/coffee-journey-v07.glx)，r215 |
| 离线阅读 | [v07 单文件 HTML](design/v07/native/coffee-journey-v07-offline.html)，r215 |
| 六段连续材质演示 | [独立离线审片](design/v07/art-studies-offline.html) |
| 正文真实滚动过渡逐帧审片 | [导航运动审片](design/v07/previews/MOTION_REVIEW.html) |
| 交付总说明 | [v07 README](design/v07/README.md)、[CLOSEOUT](design/v07/CLOSEOUT.md) |
| 可复用创作机制 | [v07 参考案例](design/v07/REFERENCE_CASES.md)、[背景机制](design/v07/BACKGROUND_RUNTIME.md)、[U03 集成](design/v07/programs/u03/INTEGRATION.md) |
| 素材与许可 | [v07 素材台账](design/v07/ASSETS.md)、[继承摄影授权台账](assets/photography/LICENSES_AND_SELECTION.md) |
| 真实验收、截图与版本校验 | [VERIFICATION](design/v07/VERIFICATION.md)、[截图](design/v07/previews/README.md)、[Manifest](design/v07/DELIVERY_MANIFEST.json) |
| 续作提示及边界 | [NEXT_PASS](handoff/NEXT_PASS.md) |

## 已成立的参考价值

- **高质量图像结合持续 Runtime**：六张一致光照的摄影感主体，按统一注册坐标使用分层贴图、移动遮罩、材质序列与源纹理碎裂，实现杯／果／种子／豆／粉末溶质／杯的视觉连续性。
- **Flow 的内容与运动是唯一事实**：背景消费宿主 `flowMotion` 和阅读进度同步变化；深浅章节同屏使用内容坐标纸色区段，桌面负空间与手机边缘遮罩保护原生正文。
- **U03 科学编辑表现**：同尺度材质剖面、SVG 描线、独立图例与三路线矩阵。选择、详情、比较和返回保持。
- **U05/U06 成熟局部程序保留**：U05 三关键帧进度机制；U06 固定溶质计算/状态/交互/声音。它们依旧是独立局部程序，未因背景重制合并成大 Web。
- **正式编辑交付**：共 183 个实例，所有原有实例与定义身份保持；r215 已验证保存、新进程冷开和离线导出。完整交付证据见 [v07 验收](design/v07/VERIFICATION.md)。

## 历史和权利边界

- [v06/r204](design/v06/README.md) 保留为上一代 Canvas/SVG 背景与原始参考样本；[v05/r179](design/v05/README.md) 为更早基线。**两个版本的 GLX 均未覆盖**。
- 已成立的独立糖水复用示例仍为 [v06/r34 糖水 GLX](design/v06/reuse/solute-study/solute-study.glx) 及其 [离线 HTML](design/v06/reuse/solute-study/solute-study-offline.html)。v07 没有另造一个糖水副本。
- AI 生成材料图属于概念解释；真实纪实照片分别沿用原作者与相应 CC 授权。手机验收为 390px Chromium 页面而非实体手机认证，音频触发验证不等同听感认证。
- v07资料整理时未修改软件源码、正式GLX、HTML或图片，也未提交Git；本次另获卫生整理后本地提交授权，推送、发行和部署仍暂停。所有作品修改继续沿现有正式作者事务和保存链，避免覆盖参考基线。
