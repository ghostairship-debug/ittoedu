# R3 独立结构审查

审查者：R-A3，未参与被审候选实现或测试断言。审查基线 `afc65c9e`；首轮集成观察点 `13f27033`，另直接读取下列叶子候选。仅写本文件；没有修改产品源码、测试、配置或其他审查文件。

**当前局部结论：首轮 A04 的两项回归已由 `ed99f2f9` + `47e75e28` 修复，并通过同一接口／时序反例补审；X 的离线说明漏报仍开放。A02、TE04 binary owner 与 TE10 replacement 提取范围没有发现新的结构阻断，但不能以这些局部结论宣称 S3 完成。已知仍在实施的公共接线列为条件，不扩大阻断无关工作。**

## 实际范围与依据

- 已读本包 EXECUTION_PROMPT、README、VALIDATION_REVIEW 的 R3/T06/T07/T08、对应 A02–A05/TE04/TE10/S09 工作包，以及当前开发入口、状态、任务板、工作协议 §1.1/§3.1 和架构合同 §0.2–0.5。
- A02：`78cdfc8d`、`ded6925e`、`a3a9dbdd`、`ef5842da`、`fadf06b2`；包含原 assembly/orderedChildren、sourceScopes、Flow page color/fixed、专业文字 alpha、失效图保留与诊断复核。
- A03：`f5aa59bb`；从实际 extractor、measurement、preview response 到直接 consumer。
- A04/A05：`8cee92d2`、`1e67caf7`；核 Published/Runtime、source transport、实际 capture consumer、export port 与 Main/Renderer 接线。
- X：`320b47a4`、`0723846f`、`dc8487c5`；核共同格式 producer、写盘/unknown、PPTX/DOCX 专业颜色、offline 声明。
- TE04：`a3faa405`、`6c5add10`；核 binary snapshot、FileArtifact 版本来源、CAS 回退和实际 Office 调用分支。TE10：`dbaa28e8`（叶子 `8eed8d33`），核 shared replacement 与旧 renderer 直接调用者。
- 读取独立 T 的实际反例及 E `output/e-focused-c234c618.txt` 原输出。该 cut 总计 31 个实际用例，26 passed/5 failed；T06 在 `availability:ready` 断言失败，不能记为回退已通过。后来的 binary digest 修复需其最近层复跑。未重跑矩阵或已有无变化绿证据。

## 需要修复的发现

### R3-F1 / P2：Published 源码组件的合法资产 ID 读取失效

位置：`src/player/componentPlatform/publishedPlayer.ts` 的 `resolveSource`/`boundResourceUrls`；`src/player/components/ComponentPlatformRuntime.ts:463–465` 的 `resourceUrls`；直接合同 `src/shared/contracts/component-platform/runtime.ts:112` 和实际 consumer `src/renderer/components/SandboxComponentImplementation.ts:321`。

API 5 允许 `context.resources.url(assetId)`，`implementation.resourceBindings` 是可选别名。A04 将 `resourceUrls()` 改为已被其他 Runtime consumer 请求的资产集合，source transport 再只补声明过的 bindings。若一个 source 组件用 `context.resources.url(instance.data.assetId)`，没有额外 bindings，也没有另一个 builtin 恰好先消费同资产，传给 realm 的资源表为空。realm 的同步 `url` 只查表，没有请求宿主 resolver 的路径，因此该图或程序资源永远无法出现。编辑器依然准备完整本地资源，造成编辑器与 Published/HTML 结果不同。

最低证明已执行：内存 jsdom 中真实 `mountPublishedCourseV3` 和 Runtime；仅以 transport 替身记录 source 收到的资源快照。合法一页仅有 source 实例 `data.assetId='photo'`，Published `assets.photo.url='data:image/svg+xml,%3Csvg/%3E'`，无 `resourceBindings`。原输出：

```json
{"sourceTransportObserved":{"assetId":"photo","resources":{}},"contractUrl":null}
```

此证明是 source 接口实值，不是实际 iframe 像素验证。修复应在软件 consumer 保全正式资产 ID 访问；枚举已有 URL 不会下载未用素材，不应要求作者补手工登记。最低补证为同一 source 反例取得 URL/实际图像，并保留首屏不下载未用后页资源的原绿证据。

### R3-F2 / P2：捕获就绪早于当前页必用资源，输出可缺图

位置：`publishedPlayer.ts:58–87` 的异步 asset resolve；`src/player/componentPlatform/outputCapture.ts:57–63` 的 capture readiness；直接调用者 `src/renderer/authoring/generation/observationWorker.ts:32–42`、`src/main/workbench/observation/ViewObservationDesktopService.ts:38–45,60–63,119–128`。

A04 对非 data URL 异步 fetch 后立即返回挂载就绪。`prepareComponentOutputRegion` 只等待字体和两帧，Main 最终 capture 也只等字体和两帧，没有等本次可见 consumer 已请求的资源。`captureIsolated` 本身就把工程资产转成 `courseware-editor://app/_observation/...` URL，因此此处不只影响公网。较慢本地素材或大图可能尚未获得 `src` 就成功截图，窗口随后销毁，请求被 abort。去掉全工程预加载是正确方向，但 capture 和普通 play 的就绪属性不同。

最低证明已执行：内存 jsdom 中真实 `mountPublishedCourseV3({capture:true})` →真实 `prepareComponentOutputRegion`；只将当前专业图片的 fetch 设为可取消 pending，并提供无布局引擎环境的 300×160 矩形。未释放资源时原输出：

```json
{"preparedCapture":true,"requested":true,"region":{"x":0,"y":0,"width":300,"height":160},"imageSrc":null,"messages":["图片资源 photoAsset 缺失，原引用已保留。"]}
```

这是捕获时序证明，未声称真实截图已量测。必要修复是捕获等待当前实际使用资源及其可呈现状态，失败给局部诊断、主动停止仍释放；普通播放不能重新等待未用后页。补证只需一个 deferred 当前图片反例和对应实际 capture；不用全资产矩阵。

### R3-F3 / P2：离线结果只信可选登记，漏掉当前 HTML 中显式外链

位置：`src/core/publish/componentPlatform/buildPublishedCourseV3.ts:109–115,157–160`；直接 consumer `src/renderer/export/componentPlatform/buildHtml.ts:22–26` 与 `delivery.ts:69–72`。

X 只从 `data.resourceSources` 和 `logic.network.connectOrigins` 生成网络依赖诊断。合法 V10 Web 数据可以只有 HTML；已有工程、Developer 或正式对象数据修改均不要求先填该可选登记。其当前 HTML 中的明确远程图片仍未进入诊断，离线导出报告可以完全无警告。`offlineComplete` 内部返回值同时为 true；当前 UI 主要消费 diagnostics，不把未使用的布尔值本身升级为额外用户缺陷。

最低证明已执行：真实 `createBlankCourseProjectV10` + `buildPublishedCourseV3`，仅一项合法 Web 内容 `<img src="https://images.example/lesson.png" alt="lesson">`，无 assets/登记、无网络调用。原输出：

```json
{"offlineComplete":true,"diagnostics":[],"html":"<img src=\"https://images.example/lesson.png\" alt=\"lesson\">"}
```

复用当前来源识别补齐真实源码事实或收窄明确承诺即可；不需要扫描任意动态程序、建立平台或以离线为由拒绝可用输出。最低补证为这个普通显式外链在真实输出报告中提示，同时纯本地内容不被错误标为联网依赖。

## 可继续推进与尚未满足的条件

- **A02 算法与来源保存：**保留原 measured assembly、专业映射、orderedChildren，针对不能拆分的实际浏览器上下文保 source scope；保留取消边界，测量失败回现有 program carrier。没有新增作者登记或新的正式 writer。Flow 背景只在明确整页 redo 转入现有 owner；普通 content 修改不重测、不改 frame。结构范围可继续。pseudo、整体 opacity/filter、重叠、Flow 根绘制和 fixed 的实际 V10 像素仍需 T08 一页真实载体；源码字符串和保存绿不替代视觉。
- **A02 alpha：**正文颜色合同使用同一 RGB/alpha parser，专业正文保精确数值 alpha；PPTX 独立传 RGB/透明度；DOCX 及高亮不能表达透明度时保 RGB 并报告差异。未发现这几处直接算法的新阻断；未运行 Office 真实呈现，不声明全部格式保真。
- **A03 公共接线仍在实施：**在 `13f27033`，A02 已写 `data.resourceSources`，但 `src/components/web/data.ts` 仍为不含该字段的 strict schema；`resolveWebResourceBindings` 会 parse 失败。内存实测为 `unrecognized_keys:[resourceSources]`。已报 I/Root；最终 cut 必须覆盖 schema、实际 sandbox/bootstrap/网络许可和 Published consumer，不能以 preview response 的 T08 声明测试当运行端通过。
- **失效图修复：**`fadf06b2` 的 verifier 使用当前 canonical 字节和既有图片解码器，不以原诊断消失或字符 Hash 宣称修复；失效图不强行专业 image admission，保原字节与 Web 源码。公共诊断查询/当前回执消费仍按 I 的真实提交核；已有 T07 保存/冷开资产反例有效范围不扩成实际按钮运行。
- **TE04：**binary before blob 和回退使用原字节、文件身份/版本、正式文件协调器；`6c5add10` 修正为 FileArtifact 原始 digest token，结构可继续。在 `13f27033`，Engine `office.*` 分支尚未调用 prepare/complete hooks；T06 手动调用 hooks 只证明实体层。需要公共 Office 执行分支接到这两个现有 hook，并用一个实际 Engine/Gateway mutation→review 反例补证。无需重复全 OOXML 矩阵。
- **TE10：**replacement 是原 renderer 算法的同义迁出；继续复用 library insertion 的身份/资产/源码重绑，过滤 instance.insert，保已有实例 data/frame/override。没有依据重审或重写成熟重绑算法。人工 consumer 仍 re-export 同实现；公共 I consumer 及真实 archive/Session 结果尚需 final cut 证据。
- **A05/S09：**端口用同 request/identity 的递增活性和取消，不移文件 writer，晚回复不结算。X 复用现格式 producer，明确多 Flow DOCX、多文件部分写入和写后 unknown。`13f27033` 的 Main/App/exportWorker 完整 signal/progress/capture/PDF 接线尚未齐；端口 fake-clock 绿不能证明 GUI/headless 取消已经贯通。固定 cut 后仅检查实际 listener → producer → capture/compiler → write 这条组合，不重跑无关绿族。

## 证据边界

本轮新增执行只有无网络、无落盘的内存反例；未改独立测试断言，未运行构建、全仓类型检查、矩阵或付费模型。已有 E 原输出继续按其 cut/闭包有效。自动化最多支持 engineering candidate；真实视觉、互动、Office 实际打开、正常保存/冷开及 Owner 接受均没有被本审查替代。发行继续暂停。

后续只有修复以上发现、相关接口接线完成或新证据改变结论时才补审相应 hunk；无关就绪工作继续。

## A04 修复补审（`ed99f2f9` + `47e75e28`）

此处直接审阅 `player_export` 的两个修复 commit；检查时集成分支为 `95ccc168`，尚不将叶子修复当作已合入。保留上文首轮反例供定位。

- **R3-F1 在接口层关闭。**源码组件得到所有已发布资产的 URL 映射；仅枚举 URL、不读取字节。重跑同一无 `resourceBindings` 的 source 反例，并加入一个未使用远程资产，实际输出 `contractUrl:"data:image/svg+xml,%3Csvg/%3E"`、`fetched:0`。没有把另一个 consumer 先消费同资产作为隐含条件。
- **R3-F2 在捕获时序层关闭。**捕获单独等待 Runtime 已请求的资源任务、其实际 update 及现有观察资源就绪；普通 mount/play 不改为全资产等待。原 pending-fetch 反例扩展为 deferred decode：fetch 未释放时 `prepared:false,imageSrc:null,messages:[]`；字节到达而 decode 未释放时仍 `prepared:false,localIsolated:false`；释放 decode 后得到 300×160 region、有效 blob src，且 `localParent:"photo"`。未用远程资产没有进入请求集合。`47e75e28` 将等待放在 Office local isolation 之前，因此资源 update 不再覆盖后设的本地像素几何。
- 本次 probe 使用真实 Published/Runtime/prepare 路径；无布局引擎的矩形与 decode 被显式替代，只证明资源合同、等待次序及 local parent，不证明真实图像解码、截图像素或 Main 取消贯通。F1/F2 的最近层回归不再阻断；真实 capture 证据仍由对应执行条目提供。没有扩大测试范围。
- F3 与前述 I 公共接线条件没有被这两个修复覆盖，保持原结论，待固定集成 cut 或针对性证据再补审。
