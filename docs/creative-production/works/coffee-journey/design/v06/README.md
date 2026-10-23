# 《一杯咖啡的远行》v06 · 正式参考作品

**创作收口：2026-10-22。正式工程为 Project schema 11 / revision 204。** 七章原生 Flow、一个持续存在的 Global Underlay、三个局部互动程序已装配为同一可编辑 GLX。对应单文件 HTML 已由新进程冷开的正式工程导出并断网验证。跨主题糖水小样为正式 GLX / r34。

## 正式入口

| 用途 | 文件 |
| --- | --- |
| 继续编辑作品 | [coffee-journey-v06.glx](native/coffee-journey-v06.glx) |
| 直接离线阅读 | [coffee-journey-v06-offline.html](native/coffee-journey-v06-offline.html) |
| 了解实际完成与边界 | [CLOSEOUT.md](CLOSEOUT.md) |
| 验收范围与机器证据 | [VERIFICATION.md](VERIFICATION.md)、[DELIVERY_MANIFEST.json](DELIVERY_MANIFEST.json) |
| 按问题选择可复用案例 | [REFERENCE_CASES.md](REFERENCE_CASES.md) |
| 定位原生对象及三个程序 | [OBJECT_INDEX.json](native/OBJECT_INDEX.json) |
| 关键视觉与互动状态 | [截图索引](previews/README.md) |
| 糖水正式复用 | [小样说明](reuse/solute-study/README.md)、[GLX](reuse/solute-study/solute-study.glx)、[离线 HTML](reuse/solute-study/solute-study-offline.html) |

## 本版的创作成果

全局背景以同一条物件叙事贯穿杯、果、组织剥离、生豆、烘焙豆、粉末与溶质，再回到杯中。位置、转角、尺寸、材质、剥离和颗粒参数共同变化，阅读静止时停帧。它使用现有 `teacherController` 的阅读状态，与现有导航共享章节事实。浅色目的章节的纸面在约 180ms 内恢复可读性，物件继续完成约 1350ms 的平滑转场；深色章节仍按完整时长过渡。

U03 用相同尺度的 SVG 截面和组织矩阵呈现三条处理路线，保留选择、详情、并排比较和返回状态。U06 以有前后层次的玻璃杯、纸滤杯、水流、液面和固定数量颗粒表达物质变化，关键标注放在可读的 DOM 中。U05 的三张配准关键帧和两个脚本完整保留，只作透明化和局部文字对比度协调。

原 r179 的 182 个对象 ID 与 definition 身份全部保留，仅增加一个全局背景实例。最终共 183 个实例：1 Flow、93 原生文字、13 文档块、8 原生图片、63 组合、2 Web 局部程序、1 HTML 局部程序、1 导航 Source、1 背景 Source。组合与文档块数量包含嵌套布局，不能把“七章”误写成“仅七个组”。详见 [保留性证据](evidence/preservation.json)。

## 源码与修改入口

- 背景：[background-runtime.js](background-runtime.js)、[background.config.json](background.config.json)、[阶段与生命周期说明](BACKGROUND_RUNTIME.md)。
- U03：[生成源与一致性说明](programs/u03/INTEGRATION.md)。`build_u03.py` 是作者源；CSS、JS、JSON、SVG 为生成副本。
- U05：[实际装配源码](programs/u05/README.md)，随附三帧资源及 GLX 资源映射。
- U06：[引擎、配置与生成方式](programs/u06/INTEGRATION.md)。咖啡与糖水 GLX 嵌入完全相同的 `water.js` 引擎。
- 素材、许可和资源身份：[ASSETS.md](ASSETS.md)。

修改这些磁盘源文件不会自动修改 GLX。应先从当前工程取得真实虚拟路径，再通过 `project.read / project.apply` 或统一 Session 的原生操作提交、保存。保留一个正文 Flow、一份 Underlay 和原生对象边界。

## 已知边界

宿主对 pinned 全局对象保留约 18px 的右侧／底部空间，当前背景因此有细窄留边。最小复现与软件线交接见 [SOFTWARE_HANDOFF.md](SOFTWARE_HANDOFF.md)。本版没有修改共享产品源码、构建环境或测试文件。源码导入时对动态 `innerHTML / style.setProperty` 的静态提示已留存；正式最终导出警告为零，断网没有 HTTP 请求。

原始 [v05/r179 GLX](../v05/native/coffee-journey-v05.glx) 未覆盖、哈希不变。PoC、阶段稿和异常隔离稿已归档至仓库 `output/coffee-final-20261022/archive/`，不作为默认入口。本轮未提交 Git、推送、发行或部署。
