# v07 截图与审片索引

本目录为**已保存的正式 v07/r215 离线作品**和材料工作台保留视觉证据。截图可辅助复核，不代替 GLX 作者事实；最终离线工程见 [native/coffee-journey-v07-offline.html](../native/coffee-journey-v07-offline.html)。

## 优先打开

| 需求 | 资料 | 说明 |
| --- | --- | --- |
| 六个物件材质和 30 个孤立阶段帧 | [material-reference-final.png](material-reference-final.png) | 同一构图检查摄影材质及独立变形，非实际滚动 |
| 正式桌面导航 30 帧概览 | [motion-contact-1440.png](motion-contact-1440.png) | 6 段 × 0/25/50/75/100%，取自实际离线导航 |
| 正式手机导航 20 帧概览 | [motion-contact-390.png](motion-contact-390.png) | U02→U03、U04→U05、U05→U06、U06→U07 各五帧 |
| 可逐帧放大审查 | [MOTION_REVIEW.html](MOTION_REVIEW.html) | 真实 `flowMotion`、实际相位、scrollTop 元数据 |
| 六段主体形变独立合成表 | [transition-contact-sheet.png](transition-contact-sheet.png) | 物件层变化，不是正文中的尺寸或遮挡关系 |
| 全部素材连续播放 | [art-studies-offline.html](../art-studies-offline.html) | 独立单文件艺术参考，可拖进度、播放/暂停 |

## 正文七章

- **桌面 1440px**：[U01](final-1440-u01.png)、[U02](final-1440-u02.png)、[U03](final-1440-u03.png)、[U04](final-1440-u04.png)、[U05](final-1440-u05.png)、[U06](final-1440-u06.png)、[U07](final-1440-u07.png)。
- **手机视口 390px**：[U01](final-390-u01.png)、[U02](final-390-u02.png)、[U03](final-390-u03.png)、[U04](final-390-u04.png)、[U05](final-390-u05.png)、[U06](final-390-u06.png)、[U07](final-390-u07.png)。
- **局部互动**：[桌面 U03 并排](final-1440-u03-compare.png)、[手机 U03 并排](final-390-u03-compare.png)、[桌面 U05 中间帧](final-1440-u05-midpoint.png)、[手机 U05 中间帧](final-390-u05-midpoint.png)、[桌面 U06 稀释](final-1440-u06-dilution.png)、[手机 U06 稀释](final-390-u06-dilution.png)。
- **材料结构源包**：[U03 桌面并排](u03-material-1280-compare.png)、[手机并排](u03-material-390-compare.png)、[手机详情](u03-material-390-detail.png)。

## 原始逐帧截图（`motion/`）

文件名格式：`{1440|390}-uXX-uYY-{000|025|050|075|100}.png`。1440px 覆盖 U01→U02 至 U06→U07 共 **30 帧**；390px 覆盖 U02→U03、U04→U05、U05→U06、U06→U07 共 **20 帧**。起始/结束帧可与同一段的中间帧并排审查。**总计 50 帧实际导航证据**，不是 60 帧；其余两个移动端转场已在代表性阅读截图和整体材料画面中审看，但没有本目录的五帧完整序列。

进度、章节阅读坐标、运动状态与挂载身份记录在 [final-motion-frames.json](../evidence/final-motion-frames.json)。艺术判断和软件验证分别见 [visual-acceptance.json](../evidence/visual-acceptance.json) 与 [VERIFICATION.md](../VERIFICATION.md)。本组手机结果是 Chromium 的 390px 视口，不代表实体手机或 Safari 实测。
