# 验证边界

只在制定纵切、集成或交付检查时读取本文件。

## 每个实现单元

- 输入数据能写入真实 Course Project V9，并能打成 `.h5lesson`；
- 真实行为与脚本一致，错误、重试、揭示和教师接管可达；
- 文字必须、普通可替换图片应当在当前画面可命中；
- `authoringAddress` 跨保存重开仍可解析，过期 revision 被拒绝；
- 改动不会覆盖同工程其它教师修改。

## 整课

- `npm run --silent validate:course-project -- <file.h5lesson>`（Schema、包内文件、当前已接线的结构性工程健康结果与相关预检）；退出码 0 不代表完整 V9 语义或 Runtime/Component 源码离线网络合规已经证明；
- 编辑、Undo/Redo、保存、关闭、重开和恢复；
- CoursePlayer：`SlidePublishedAdapter` / `FlowSurfaceHost` / `SpatialSurfaceHost` 的初始态、关键交互态、稳定结果、返回、重播与教师控制；无限画布核对自由逛与镜头巡游都可达，且组件/视频/控制器手势不被画布拖拽抢走；不要用 Phaser `PlayerApp` 冒充试运行；
- 默认离线 HTML 自包含，并在真实浏览器中确认没有外部请求；其它格式按脚本要求检查保留、静态化、降级或省略；
- Runtime/Component 不压住公式或教师控制器，全部图层顺序可编辑；
- 交互后冻结编辑不把会话作答误写成默认值；
- 内容正确、视觉层级、投影可读性、无障碍和教学节奏由独立体验 QA 复核。

## 结论用语

分别报告工程检查和用户可见结果。没有真实画面、互动和教师编辑证据时，不声称可用或已验收。自动化最多 `engineering candidate`。`accepted` 必须来自教师明确验收。产品能力缺失、可编辑性不成立或必须静默降级时停止，不用占位图或 Headless 绿色替代。
