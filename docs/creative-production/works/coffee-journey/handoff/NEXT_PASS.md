# 接续交接｜《一杯咖啡的远行》v08候选与v07交付基线

**2026-10-23。当前已保存候选为[v08/r247](../design/v08/README.md)**，正式文件与原冷开／导出收据沿该入口读取；创作会话本轮已结束，验收交接和Owner艺术判断保留。以下已有结果及局部精修方法记录v07交付基线：[v07说明](../design/v07/README.md)、[GLX](../design/v07/native/coffee-journey-v07.glx)、[离线HTML](../design/v07/native/coffee-journey-v07-offline.html)、[收口报告](../design/v07/CLOSEOUT.md)、[版本Manifest](../design/v07/DELIVERY_MANIFEST.json)。

## 已有结果（不要从头重复）

- 一个 Global Underlay，六份统一摄影级主体资产与六段不同技术的连续形态变化：杯→果→果皮分离和种子→生豆→烘焙豆→碎粒/溶质→杯。**已实际消费宿主 `flowMotion`**，没有第二套滚动控制或独立 1350ms 时钟。
- 全篇七章原生 Flow、唯一导航/阅读状态、三个局部程序 U03/U05/U06 均保留；v07 U03 改为摄影感剖面 + 矢量标注/同尺度三路线比较；U05/U06 成熟运行机制继承且代表性交互通过。
- r215 183 个实例及原有定义/对象身份全部保持；保存与新进程完整冷开相等；正式单文件导出 warnings=[]，1440px/390px 离线七章无 HTTP 请求、无页面异常。旧 18px 背景留边在这些最终视口记录中未再出现。
- 真正的过渡中间帧：桌面 6×5=30 帧、手机代表性的 4×5=20 帧，分别见 [真实运动审片](../design/v07/previews/MOTION_REVIEW.html)；独立材质转化和连续播放另见 [艺术审片](../design/v07/art-studies-offline.html)。
- 文档已整理：[素材来源](../design/v07/ASSETS.md)、[背景技术](../design/v07/BACKGROUND_RUNTIME.md)、[复用案例](../design/v07/REFERENCE_CASES.md)、[验收细目](../design/v07/VERIFICATION.md)、[截图索引](../design/v07/previews/README.md)、[U03 源包说明](../design/v07/programs/u03/INTEGRATION.md)。

## 仍然保留的判断与验证边界

- 创作 Agent 在既有 [visual-acceptance](../design/v07/evidence/visual-acceptance.json) 标记六段转场内部可接受；**Owner 个人审美签收尚未进行**。如果用户指出某段视觉问题，再做局部改版，无需自动启动六段全重做或全面架构审查。
- 目前的手机证据是 390px Chromium 视口；实体手机/Safari/主观声音听感未经测试。U03 的 AI 概念剖面及背景生成图不能当作实测植物样本。
- U05/U06 仍使用原数学/局部程序身份；跨主题糖水实证仍为 [v06/r34](../design/v06/reuse/solute-study/solute-study.glx)，未因 v07 背景重制而重建。
- 独立 PNG/WebP 和源码文件不自动改变 GLX；新一轮复制新命名工作副本，先读取 `project.read/list` 得到当前真实对象路径，再用正式 Session 事务、保存与导出。背景 Source 工作空间路径历史名是 `underlay-poc.js`。

## 若确有下一轮局部精修

1. 先由用户打开正式 [离线 HTML](../design/v07/native/coffee-journey-v07-offline.html) 和 [转场审片](../design/v07/previews/MOTION_REVIEW.html)，指出需改变的具体物件、画面或章节；不预设全部六段需要返工。
2. v08工作副本现已存在，接续时读取其当前事实，不再从v07重新创建并覆盖。v07/r215、v06/r204和v05/r179原件保留；继承素材及旧机制见[v07背景说明](../design/v07/BACKGROUND_RUNTIME.md)，v08增量按其[当前入口](../design/v08/README.md)处理。
3. 内容高度或字体发生改变时复核 `READING_KNOTS` 和 U04/U05/U06 底色过渡；若只更新局部物件，针对对应 5 点转场与正文实看，不机械重测无关内容。
4. 只在真实变更需要时再做冷开、单文件离线和受影响互动验证；不可因新窗口/新 Agent 重新把已有证据全部判为无效。

**当前无实施writer；协调卡queued仅保留接续目标，不自动启动创作。** 本次资料整理不修改GLX、Runtime或共享产品源码；Owner另授权卫生整理后本地Git提交，push、发行或部署继续暂停。
