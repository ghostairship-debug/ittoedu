from pathlib import Path
import json,hashlib,datetime
base=Path(__file__).resolve().parent.parent
read=lambda n:json.loads((base/'evidence'/n).read_text(encoding='utf-8-sig'))
export=read('final-export.json')['data']; revision=export['exportedRevision']
offline=read('final-offline-verification.json'); motion=read('final-motion-frames.json'); cold=read('final-cold-open.json'); preservation=read('final-assembly-preservation.json'); material=read('material-continuity.json'); reference=read('reference-package.json')
assert export['status']=='written' and not export['warnings']
assert len(offline)==2 and len(motion)==2 and all(len(r['chapters'])==7 and not r['errors'] and not r['httpRequests'] for r in offline)
assert all(len(r['transitions'])==6 and r['idleStopped'] and not r['errors'] for r in motion)
assert cold['fullProjectEqual'] and not cold['dirty'] and cold['oldPid']!=cold['newPid']
assert reference['actualNavigationFrames']==50 and not reference['errors']
assert (base/'evidence/visual-acceptance.json').exists(), 'Complete actual visual review first'
visual=read('visual-acceptance.json'); assert visual['accepted'] and visual['revision']==revision
hashfile=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert hashfile(base/'../v06/native/coffee-journey-v06.glx')=='e4a7e1e051891a9381fe9dbd878668a6e83b9956f64a81733a8d164cf343a525'

def write(name,text):
    p=base/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text.strip()+'\n',encoding='utf-8')

write('README.md',f'''# 《一杯咖啡的远行》v07

**艺术精修交付 · Project schema 11 / r{revision} · 2026-10-23**

## 打开作品

| 用途 | 当前正式文件 |
|---|---|
| 在果铃继续编辑 | [coffee-journey-v07.glx](native/coffee-journey-v07.glx) |
| 浏览器直接打开，断网阅读 | [正式单文件 HTML](native/coffee-journey-v07-offline.html) |
| 完整观看六段物件变化、拖动停帧 | [独立离线视效检视页](art-studies-offline.html) |
| 查看真实导航的中间帧 | [审片页](previews/MOTION_REVIEW.html) |
| 完成、验收与边界 | [CLOSEOUT](CLOSEOUT.md)、[VERIFICATION](VERIFICATION.md) |
| 实际实现与复用 | [背景 Runtime](BACKGROUND_RUNTIME.md)、[REFERENCE_CASES](REFERENCE_CASES.md) |
| 素材来源与处理 | [ASSETS](ASSETS.md)、[素材 Manifest](assets/manifest.json) |
| 文件校验 | [DELIVERY_MANIFEST](DELIVERY_MANIFEST.json) |

正式作品仍是原生 Flow + 三个局部互动程序 + 一份 Global Underlay，183 个实例身份保留。视效检视页只是同一渲染器的材料参考，不能替代正式作品或其 GLX。

`background-entry.js` 是正式 Source 更新入口；`background-runtime.js` 为实际实现，`background-stages.js` 为构图和阅读标定。`programs/u03/` 保存精修后的实际 HTML、CSS、JS、材料图和标注。源码修改后须经过正式 `project.apply`、保存、导出；磁盘源码不会自动写回 GLX。

`authoring/` 为本轮作者事务、验证脚本和隔离测试缓存；`before-final-pass/`、独立 Electron profile 与 `runtime-snapshot/` 不属于交付入口。不要把中间 r205/r211/r213/r214 的证据当作最终版本。v06/r204 原件保留。
''')

write('CLOSEOUT.md',f'''# v07 收口报告

日期：2026-10-23。当前正式版本：**Project 11 / r{revision}**。

## 已完成

六份摄影级透明主体（杯、果实、剖面、生豆、初烘豆、熟豆）完成清边、配准及运行时资源整理。原简单示意图背景已替换；六段变化使用分层材质、遮罩、旋转、碎裂与液面连接。U03 改为同尺度材料图配矢量解释，保留选择、详情、并排比较和返回。

实际观看中继续修正了三个问题：材质合成切换引起的透明边缘跳变；背景主体压住正文或过度裁切；深浅章节同时入屏时，整屏底色使 U06 文本过暗。最终用同一材质采样网格、章节构图、手机页边遮罩和随正文位置移动的背景色区分别解决。

## 正式验证

七章在 1440×1000 与 390×844 的 Chromium 实际页面中完成阅读、导航和互动检查。六段每段五个进度点均采样；保存 30 张材料帧、30 张桌面真实导航帧和 20 张手机代表性导航帧。快速反向、连续跳章、手动接管、静止停帧、减少动态通过。U03、U05、U06 未发现已测交互回退。

原生文字的精确修改、界面撤销／重做／恢复完成；最终 GLX 在独立新进程冷开后与保存时完整项目相等，dirty=false。正式 HTML 导出无警告；两种视口断网运行，无页面错误、无 HTTP 请求，18 个图片节点全部解码。背景实际占满视口，原右侧 18px 背景留边未再复现；导航本身保留宿主安全边距。

## 交付判断与范围

本轮主创多轮视觉审查接受该版本作为果铃摄影材质与结构化内容协同的参考案例。无需为本轮目标继续无限艺术精修；这不代替用户的最终审美确认。

手机采用页面级视口测试，未进行实体手机、Safari 或全部浏览器认证。声音验证覆盖开关、WebAudio 事件及状态，不包含主观听感评价。生成剖面为结构说明，不是实测标本；过渡是叙事表达，不是物理模拟。

没有未解决的本轮 P0 阻断。换字体、大幅改变章节高度或移植到其他主题时，应重新验证阅读标定和暗／浅区交界。v06 糖水复用案例保留为历史证明，本轮没有将新摄影素材移植到糖水工程，也没有冒称其完成了 v07 复测。

未修改共享产品源码、未改共用构建、未覆盖 v06、未提交 Git、推送、发行或部署。没有调用本机外部模型 Agent。
''')

write('BACKGROUND_RUNTIME.md',f'''# v07 背景 Runtime：实际实现

## 文件与身份

入口 `background-entry.js` → `background-runtime.js` → `background-stages.js`，资源经 `background-assets.css` 的六个 CSS URL 纳入正式 Source 闭包。入口的资源探针只存在于自身组件根节点，不读取宿主 DOM。

唯一 Underlay 实例：`926a6155-1814-4a16-ba47-24c1c1f5dbc8`。共享定义：`96347310-25a2-4382-bde7-1c46f6d5ba9f`。工程中的入口仍保留历史名 `underlay-poc.js`，身份不因艺术重制而更换。

## 六段转化

| 进度 | 形态 | 实际手法 |
|---|---|---|
| 0→1 | 杯到果实 | 陶瓷退去遮罩、共享液面抬升、果实体积与红色材质逐步显露 |
| 1→2 | 果实剥开 | 原果实左右不透明表皮分离，内侧组织经移动遮罩显露，种子保持空间连续 |
| 2→3 | 组织到生豆 | 外层组织离开；第二粒种子退场；主种子经侧面旋转换到带沟槽的一面 |
| 3→4 | 生豆到熟豆 | 同一轮廓配准的绿／金／棕三材质进行预乘 Alpha 混合 |
| 4→5 | 熟豆到粉末与液体 | 165 个确定性 Voronoi 区块从原豆纹理中释放、缩小、漂移；共享液面逐步承接 |
| 5→6 | 液体到杯 | 液面汇聚到原杯口坐标，陶瓷从液面向外显露，少量残粒消隐 |

中间关键帧由同一渲染器计算，见 `art-studies-offline.html`、`previews/material-reference-final.png`。没有用六段预录视频替代可控制的程序。

## 消除接缝的关键

所有主体先画入同一 960×960 离屏材质网格，再进行相机位置／尺寸／角度变换。不同素材的边缘不能简单 source-over 叠加；`blendLayers` 用预乘 Alpha 权重相加，避免双轮廓。剥离与转面入口使用配准的重叠姿态。透明边缘清理只处理极低 Alpha 噪点，未用整体低透明度遮掩素材缺陷。

每个相同进度产生确定性画面。粒子位置由固定种子生成，正反向和快速跳章不重新随机。离屏画布复用，DPR 上限为 2；静止时不维持独立动画循环。

## 只消费软件的运动事实

`teacherController.subscribe/read` 提供 reading 与 flowMotion。新导航 id 出现时捕获当前可见形态；随后用软件发布的实际 displacement progress 插值到目标章。完成时到达精确终态。反向导航从当前相位继续；手动接管后，用实际阅读距离消除残留相位偏差。

`reading.progress` 是整个 Flow 的滚动比例，不能当作章节局部比例。`READING_KNOTS` 存储作品标定，导航到真实章节锚点后可在运行时校准；对象级 reveal 不得改写章节锚点。该缓存只服务绘制，不写作者数据、不接管阅读状态。

## 物件变化与纸面明暗分开

物件用语义形态进度；背景色区用正文实际滚动坐标。`paperForReading` 从公开 scrollTop 与 reading.progress 推得当前 reading range；目标章节可直接使用公开 targetScrollTop，其余边界用标定。浅色／暗色章节交界只在对应内容位置过渡，因此 U05 与 U06 同时出现在屏幕里时，各自有适合文字的底色。

这一实现仍只有一个 Underlay Canvas。没有宿主元素查询、第二套 scroll controller、scrollTo、固定延迟补偿或导航源码修改。初始无运动数据时使用作品内容高度标定；大幅重排内容后必须复测此标定。

## 构图与生命周期

桌面主体使用章节负空间；手机正文近乎全宽，使用右侧空间遮罩保护阅读，完整物件可在独立材料视图查看。遮罩不改变素材本身，不影响原生对象身份或命中区域。

减少动态时直接终态。suspend 取消阅读订阅，resume 从当前软件事实重绘；dispose 清除订阅、ResizeObserver、媒体偏好与可见性监听、图像回调和自身节点。图片加载、尺寸变化、内容状态变化触发必要重绘；静止 tick 不增加。
''')

write('ASSETS.md','''# v07 素材来源与制作说明

## 新增主体

本轮新增主体均为当前会话图像生成工具制作的摄影风格资产，并非互联网抓取的实物照片。统一规格：左上柔光、暖中性光色、真实材料纹理、全物件清晰、透明背景、无标签／地板／独立投影。提示词原文在 `ASSET_PROMPTS.json`；其中临时生成路径只是制作历史，不是交付依赖。

| 稳定名称 | 原始 PNG | 运行时资源 | 衍生关系 |
|---|---|---|---|
| cup | assets/source/cup.png | assets/runtime/cup.webp | 杯与液面共同纹理来源 |
| cherry | assets/source/cherry.png | assets/runtime/cherry.webp | 完整红果；剖面的外轮廓参考 |
| section | assets/source/section.png | assets/runtime/section.webp | 对 cherry 作纵向剖面编辑；种子与组织层来源 |
| green | assets/source/green.png | assets/runtime/green.webp | 生豆，后续焙色的几何基准 |
| gold | assets/source/gold.png | assets/runtime/gold.webp | 从 green 参考编辑初烘材质 |
| roast | assets/source/roast.png | assets/runtime/roast.webp | 从 green 参考编辑中深烘材质 |

原始 PNG 为 1254×1254、保留 Alpha；运行时 WebP 为 900×900。`authoring/render-materials.cjs` 执行极低 Alpha 清理、焙色轮廓仿射配准和 WebP 编码；参数与配准数值保存在 `assets/manifest.json`。PNG 原件未覆盖。

## U03 材料图

`programs/u03/assets/{natural,washed,honey}-section.webp` 都由同一剖面、同一裁切和种子几何派生。日晒保留外层；水洗显示种子及薄羊皮层；蜜处理显示较宽的黏液材料边缘。三条路线仅用于同一时点的组织去留比较，不按生成图的像素厚度作科学测量。

`*-layers.svg` 和页面内 SVG 负责轮廓、虚线、引线等解释。材料本身由图像表达，颜色／表格／文字说明由可编辑结构负责。生成剖面明确标注为材料示意、非实测标本，银皮省略。

## 沿用素材与使用边界

U01/U02/U04/U07 的原摄影、U03 的既有物件主图、U05 的原三关键帧均保留。原摄影作者署名和许可仍见作品图片说明及 `../v06/ASSETS.md`；本轮没有将这些摄影改称为自有或 AI 生成。v07 新增部分没有外部摄影下载或新增外部字体。

不另行声称所有生成资产在所有司法辖区享有独占版权；这里记录的是实际来源和制作过程。复用时保留真实摄影的原有署名与许可要求。
''')

write('REFERENCE_CASES.md','''# v07 可复用参考案例

这些案例对应实际交付文件，不是设想中的通用平台。它们适合供人与 AI 查看材料、行为和实现后再改写，不要求照抄整篇作品。

## 1. 摄影材质与程序形变

**入口：** `background-runtime.js`、`assets/source/`、`assets/runtime/`、`art-studies-offline.html`。

先确定光照、视角和轮廓基准，再生成材质变体；运行前配准和清边。用程序控制空间关系，避免让模型用大量 Path2D 勉强模拟摄影纹理。可迁移到果实成熟、材料加工、食品制作和工业过程。

最容易误判的是“相同位置的淡入淡出应该自然”。不同透明边缘叠加会变粗，不同离屏缩放会令纹理跳变。此作的修复是统一采样网格和预乘 Alpha 合成，而非反复调 easing。

## 2. 用材料本身产生过渡

**入口：** `cupToCherry`、`shells`、`seedTurn`、`beanToSolution`、`solutionToCup`。

大形态差异通过有联系的中间物完成：杯内液面先获得体积再成为果实；果皮分离时里面的种子已经存在；粉粒直接切取原豆纹理；最终液面回到原杯口。变化可组合遮罩、旋转、裁切、粒子，没必要统一成一个 SVG Morph。

保留确定性相位函数，才能在任意进度倒放、被打断、重新定位。完整物理正确性并非本案例目标，但材料来源、重心、连续轮廓必须可见。

## 3. Flow 滚动与持续背景协同

**入口：** Runtime mount、`paperForReading`、`background-stages.js`；证据 `final-motion-frames.json`。

软件负责导航和实际滚动，作品只消费公开运动进度。主物件与纸面色区使用同一事实但不同映射：物件表达语义转化，纸面保证真实进入屏幕的正文可读。整屏颜色插值在一屏同时容纳深浅章节时会失败；本作以正文坐标中的色区解决，而没有增加另一个背景实例。

复用时更换章节目标、阅读标定、构图位置和色盘；不得复制内部 DOM 选择器或固定等待时长。章节高度大改后，用真实导航重新校验。

## 4. 高质量科学结构比较

**入口：** `programs/u03/build_u03.py`、u03.html/css/js、三份 section.webp。

材料图提供质感，SVG 解释组织关系，DOM 表格提供手机端仍清晰的信息。三个路线共用视角、尺度、裁切和组织颜色；保留同一比较时点，避免把并列路线画成先后阶段。

图片不是事实源。示意与测量明确区分，关键结论仍放在可读文字和矩阵里。原有选择／详情／比较／返回机制不因视觉升级而重写。

## 5. 原生图文 + 局部程序的正式交付

**入口：** native/coffee-journey-v07.glx、native/OBJECT_INDEX.json、final-assembly-preservation.json。

183 个实例身份保留。图文与布局仍为独立原生对象；U03/U05/U06 各有自己的程序边界；背景是唯一持久 Underlay。修改经 project.read/apply 与作者事务，保存再冷开，再从同一 revision 正式导出。来源文件、GLX 和 HTML 必须明确区分，不能在 HTML 中补丁式修好后声称 GLX 同步。

v06 的糖水独立 GLX 是既有参数化复用证据，见 `../v06/reuse/solute-study/`。本轮新补充的是摄影材料、运动分层、科学材料图和可检查源码，没有建立 RAG 或大型素材管理系统。
''')

frames=sum(len(t['samples']) for r in motion for t in r['transitions'])
write('VERIFICATION.md',f'''# v07 验收记录

正式 GLX / HTML：**Project 11 / r{revision}**。最终导出 receipt：`evidence/final-export.json`。以下为实际运行记录，不把脚本存在本身当作通过。

| 验收项 | 证据与结果 |
|---|---|
| 六段材料中间帧 | `material-reference-final.png`；30 帧；另有独立连续观看页 |
| 正式导航中间帧 | `final-motion-frames.json`；两视口共 {frames} 个进度样本；50 张实际导航截图 |
| 反向、快速跳章、手动接管 | 同上；从当前相位继续，最终精确落在目标章；同一 mount |
| 七章桌面／手机阅读 | `final-offline-verification.json`；1440×1000、390×844 |
| U03 | 三路线切换、详情、比较、返回与选中状态；三份材料图可解码 |
| U05 | 中间关键帧、近看、播放／暂停；原程序数据未改 |
| U06 | 3g/300g=1.00%、72 粒子、返回保持、重置、键盘、声音事件；原程序数据未改 |
| 停帧、减少动态 | `final-reduced-motion.json`；idle tick 不增加，终态正确 |
| 生命周期 | `material-continuity.json`、`final-author-roundtrip-and-cold.json`；取消订阅、恢复、dispose 与编辑／试运行往返 |
| 原生编辑、Undo/Redo | `final-author-roundtrip-and-cold.json`；r207→r211 验证原生段落，完整恢复，邻居未变 |
| 最终保存与冷开 | `final-cold-open.json`；PID {cold['oldPid']} → {cold['newPid']}；完整项目相等，dirty=false |
| 对象身份 | `final-assembly-preservation.json`；183 个实例、definition 身份、root/global 保留 |
| 背景边缘 | 编辑器 1340×897、离线两视口背景根节点与画布铺满；导航安全边距不当作背景留边 |
| 断网完整性 | 每个视口 18 个图片节点解码；0 HTTP 请求、0 页面错误；导出警告为空 |
| 实际艺术审查 | `visual-acceptance.json`；含最终深浅过渡、手机避让和六段转化的目视判断 |

## 透明度接缝的定量辅助

近整数边界的 RGB 平均差异最大 {max(x['meanChannelDifference'] for x in material['result']['joins']):.5f}/255；无像素出现大于 10 的通道跳变。六个非整数相位经倒序重绘后像素一致。手机页边遮罩测试的正文保护区（x<336）素材增量为 0。量化只用于定位接缝与状态问题，不能代替审美判断。

本机组件绘制基准只记录于 JSON，不外推为所有设备稳定 60fps。实际移动端结论仅指 Chromium 390px 页面；没有实体手机、Safari 或主观声音听感验收。

## 版本和环境

作者与冷开使用 v07 私有构建快照，哈希见 `final-pass-baseline.json`；共用构建未改。测试依赖根目录已有 Playwright/Electron 包，没有启动外部模型 Agent。

r211/r213/r214 前缀记录保留为修正前对照；`final-*` 指向当前交付。r214 的某次手机截图写盘失败已经记录，不能算通过；最终版本重新完成整套测试，不沿用那次不完整结果。

v06/r204 GLX SHA-256：`e4a7e1e051891a9381fe9dbd878668a6e83b9956f64a81733a8d164cf343a525`，与本轮开始相同。最终文件的大小和校验值见 DELIVERY_MANIFEST.json。
''')

write('previews/README.md','''# v07 视觉证据入口

`MOTION_REVIEW.html`：实际正式导出的逐段导航截图，桌面 6 段×5 帧，手机代表性 4 段×5 帧。全部 6 段手机的进度采样仍在 evidence/final-motion-frames.json。

`motion-contact-1440.png`、`motion-contact-390.png`：真实页面审片联系表。`material-reference-final.png`：材料中心视图的 6 段×5 帧。`final-1440-u01.png` 至 u07、`final-390-u01.png` 至 u07 为最终章节导航终态；另外保留 U03 比较、U05 中间帧、U06 稀释态。

`before-final-*`、`assembled-*` 和旧材料探索图是过程记录，不代表当前 GLX。用独立 `../art-studies-offline.html` 连续观看完整材质，用 `../native/coffee-journey-v07-offline.html` 看真实作品；两者用途不同。
''')

# Do not claim a delivery path until its actual file has been written and hashed.
files=[]
for rel in ['native','assets/source','assets/runtime','programs/u03','previews']:
    for p in sorted((base/rel).rglob('*')):
        if p.is_file() and p.suffix.lower() in ['.glx','.html','.json','.png','.webp','.svg','.js','.css','.py','.md']:
            if rel=='previews' and not (p.name.startswith(('final-','motion-contact','material-reference')) or p.parent.name=='motion' or p.name in ['MOTION_REVIEW.html','README.md']):continue
            files.append(p)
for n in ['README.md','CLOSEOUT.md','VERIFICATION.md','BACKGROUND_RUNTIME.md','REFERENCE_CASES.md','ASSETS.md','ASSET_PROMPTS.json','background-entry.js','background-runtime.js','background-stages.js','background-assets.css','art-studies.html','art-studies-offline.html','assets/manifest.json']:
    files.append(base/n)
for p in sorted((base/'evidence').glob('*.json')):
    if p.name.startswith('final-') or p.name in ['material-continuity.json','reference-package.json','visual-acceptance.json','u03-material-review.json']:files.append(p)
manifest={'date':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectSchema':11,'revision':revision,'formalGLX':'native/coffee-journey-v07.glx','formalOfflineHTML':'native/coffee-journey-v07-offline.html','baselineV06Unchanged':True,'notIncluded':['authoring/runtime-snapshot','authoring/*-profile','authoring/before-final-pass','transport .b64 files','process-only previews'],'files':[{'path':str(p.relative_to(base)).replace('\\','/'),'bytes':p.stat().st_size,'sha256':hashfile(p)} for p in sorted(set(files))]}
write('DELIVERY_MANIFEST.json',json.dumps(manifest,ensure_ascii=False,indent=2))
print(json.dumps({'revision':revision,'files':len(manifest['files']),'formal':manifest['files'][:2],'documentsWritten':8},ensure_ascii=False))
