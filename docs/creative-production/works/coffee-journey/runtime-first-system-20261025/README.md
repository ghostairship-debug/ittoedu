# Runtime-first 开放创作资产层

本目录是果铃现有组件库、正式工程投影与 MCP 上的一层可检索说明和经验证组件，不另建文件、保存或组件系统。Runtime-first 是可选创作方法；原生文档优先保留主要文字、媒体和可编辑结构，程序负责确有意义的耦合视觉与互动。

## 从需求到采用

1. 先读 [ASSET_INDEX.md](ASSET_INDEX.md) 的能力、适用情形、预览、前提和成本。
2. 按需求调用正式 `asset.search`，例如“连续阶段背景”；不必加载完整咖啡工程。
3. 确认适配后读对应契约、源码、依赖和失败例；[METHOD.md](METHOD.md) 说明原生与 Runtime 职责。
4. 使用正式 `asset.use` 装配、`project.apply` / `object.update` 修改；页面背景、尺寸和正文结构仍由创作者决定。
5. 实际观察并交互，再 `file.save`、`document.export`；检查独立冷开和离线运行。
6. 将采用、修改、失败、耗时和质量影响记入 [FEEDBACK.md](FEEDBACK.md)。一次能插入不等于已具备跨主题质量保证。

## 当前可用成果

| 层 | 入口 | 实际状态 |
|---|---|---|
| 方法 | METHOD.md | 七章咖啡精修所得的职责、视觉、色彩、构图、生命周期和装配方法；含反例与边界 |
| 可执行组件 | assets/continuous-background/README.md | v1.0，事件驱动连续背景；已完成提取、搜索、跨工程插入、依赖迁移、改参数、滑杆联动与官方导出 |
| 现有软件组件 | ASSET_INDEX.md 中 continuous-variable-v1 | 复用现有配方；明确页面句柄、状态键和背景归属前提 |
| 参考 | ../design/v08-runtime-first/final-20261025/ | 已冻结咖啡 r264；七章完整 Runtime 和咖啡素材仍是参考，不包装成通用主题模板 |
| 反馈与软件问题 | FEEDBACK.md / SOFTWARE_FINDINGS.md | 保存真实失败与解决依据，不把验证器错误改写成产品修复 |
| 双路径验证 | validation/BRIEF.md / PROTOCOL.md | 同一雨城任务、v1.0资产、同一软件构建；Luna原始自主运行与主Agent+MCP分别留证 |

## 安装与真实检索

连续背景组件已通过正式 `asset.import` 安装到日常配置的「我的资产库」，并以正式 `asset.search` 确认可发现。包ID：
`library_e6a82cca-55c4-48ef-a4b5-d5a845a17afb`，版本 `1.0.0`。
同一包在独立验证配置中提取、使用，包文件在 assets/continuous-background/ 下。预览位于 previews/。

安装与搜索证据：`output/coffee-final-20261025/validation/production-catalog-install.json`。
组件独立离线实测：`validation/asset-offline.json`（该证据在 output/coffee-final-20261025/validation 下），0→1颜色正确，空闲1秒无新增绘制，无页面错误。

## 使用边界

组件不包含正文、主题图片、章节数量、咖啡或雨城成品，也不自动替用户修改前景文字对比、页面底色或版式。可以修改 stop 数量、颜色、驱动方式和源码，可以全部不采用。已有 media、Skill、MCP、原生装配、保存和导出能力继续由软件提供。

当前状态为“可用组件＋已验证参考方法”，尚不以单个组件试验宣布通用推荐。双路径作品完成后，将补齐实际采用、质量、计时和限制结论。
