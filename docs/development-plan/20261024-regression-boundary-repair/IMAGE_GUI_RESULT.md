# 原生图片面板：实际浏览器验证

已完成 Slide 原生图片的代表性链路；没有修改产品源码或原 30／5 条告警的测试名、断言。新增一个可复跑集成测试及独立装配，不碰其他 Flow 验证装配。未 commit／push／发布。

## 已通过行为

实际 Chromium 149.0.7827.55 装配 **DocumentHostService → CourseV10DocumentBridge → editorStore → CourseV10RuntimeView → SlideWorkspaceConnector → SlideLocationWorkspace**，提供真实 CourseEditorActionsContext／CourseEditorChromeContext。固定文件 fixture 只替代操作系统选图，替换仍调用既有 `replaceCourseImageAtTarget`；没有 mock History 或第二 writer。

| 操作／属性 | 实际结果 |
|---|---|
| 图片身体双击 | 打开“图片简易编辑”，选图次数仍 0；没有自动裁剪，没有可见重复快捷条，没有 History 写入 |
| 向右旋转 90° | 正式 frame 旋转矩阵更新，Undo 恢复原 frame，Redo 恢复旋转 frame；该操作是一个 History 条目 |
| 水平翻转 | 正式 flipX 为 true，实际图片 transform 反映 scale(-1, 1) |
| 显示方式选填充 | 正式 fit 为 cover |
| 亮度输入 125 并 Enter | 正式 filters.brightness 为 1.25，实际画布图片 filter 反映 brightness(1.25) |
| 替换为不同尺寸图片 | 选图仅调用 1 次；实际资源解码宽度从 320 变 500；保留当前 frame／flowLayout，以及 fit、flip、亮度；原始引用切换到新素材 |
| 完成／Esc | 均关闭面板并保留同一 picture 选中；完成后直接从图片身体拖动，可提交新的 frame |
| 保存／冷开 | GLX 保存到 ignored output；全新 DocumentHostService 冷开，图片实例的 data／frame、替换素材字节长度保留，dirty 为 false |
| 运行时错误 | 本次 pageerror 和 harness 错误均为空 |

正式功能用例：`tests/integration/imagePanelBrowser20261024.test.ts`，**1／1 通过**，结果 `output/test-runs/image-panel-browser/vitest-review.json`、`facts.json`。装配：`tests/helpers/imagePanelBrowserHarness.tsx`。类型读取统一经 `imageDataSchema.parse`，没有用宽泛 any 绕过图片数据类型。

## 由验证发现并修复的问题

1. **完成后图片身体拖不动**：Slide 的 wholeNative 分流漏掉 guoling.image，实际原生图片被自己的 authorSpot 当成内部图片；没有 geometry 时直接结束。Root 已修复同一所有者及其相关路径。保持“完成后身体拖动会改变 frame”的原断言复跑通过，没有改成 Alt 拖、句柄拖或放宽成功条件。
2. **展开调整盖住预览图片**：原面板只使用上下快捷条定位，在上下空间不足且右侧空旷时几乎盖住整张图片。Root 改为可用时优先左右空位。仅重建相同真实 fixture 后复核定位，没有机械重跑已通过功能链。

定位专项使用 ignored output 的临时用例／配置，**1／1 通过**：`vitest-layout.json`、`layout-facts.json`。展开后的面板位于图片右侧（x=306.75、y≈316.19、290×363.5），与实际图片 raster rect 交叠面积 **0**。`cover` 源图可能伸出裁切 frame，因此这里比较的 raster rect 比可见预览范围更大，仍完全不交叠。

使用 agent-browser 技能连接同一 Chromium，实际观察展开参数、截图并查看像素：

- 修复后：`output/test-runs/image-panel-browser/agent-browser-adjustments-fixed.png`、`image-panel-adjustments-fixed.png`
- 原问题证据：`agent-browser-adjustments.png`（面板盖住预览）；`failure.png`／`failure.json`（原图片身体拖动失败）
- 功能完成初始面板：`agent-browser-panel.png`、`image-panel.png`

fixture、浏览器及 agent-browser session 均已关闭。

## 证据边界

- 这是 1280×900 CSS viewport 的真实 Chromium 验证，不是物理触屏、原生 Electron 文件对话框或所有图片格式矩阵。
- 实际执行到新 DocumentHostService 冷开数据；没有声称在另一浏览器页重新渲染了冷开结果。
- 裁剪按钮存在，旋转状态显示既有禁用原因；具体裁剪手势由 Root 负责现有裁剪验证，本叶子没有重建裁剪引擎或另测全功能。
- Program 的 Workspace.editObject 与 Spatial 的 objectDoubleClick 已静态核对：原生图片整体选择后发 requestImageEdit；内部字段仍带精确 selectionIdentity。Program 此处仍仅属接线检查；Spatial 现已补下述实际裁剪链。Flow body 图片的实际双击／Esc 链由 Flow owner 独立文件覆盖，本叶子不重复跑。
- 定位临时配置第一次误用 mergeConfig 的数组合并，触发原 globalSetup 的 player 准备；已在准备阶段中断并改为明确单文件／覆盖配置，没有进入全量测试。生成源码 dirty 已交 Root 统一处理，不覆盖其他 writer 的文件。


## 集中 review 后追加：Spatial 原生图裁剪

已在同一独立装配中按 surface kind 使用正式 `SpatialWorkspaceConnector`，不修改 Flow 装配、产品源码或旧用例。仅运行新增用例 `crops a Spatial native image from its simple panel through one canonical history step and keeps selection after Undo`，**1／1 通过**；同文件已通过的 Slide 用例仅因 `-t` 过滤未重跑，报告该 pending 不代表被修好或被忽略。

实际 Chromium、Main／Store／Bridge、150% Spatial camera：

- 图片身体双击 → “图片简易编辑” → 可用“裁剪” → 现有 `ImageCropOverlay`；未另造裁剪算法或 writer。
- 将裁剪右边向左拖原显示宽度的 1／8：正式 frame **320×200 → 280×200**，transform 精确保持 `[1, 0, 0, 1, -160, -100]`。
- 正式 crop 精确为 `{left:0, top:0, right:0.125, bottom:0}`，fit 为 stretch，cropX／cropY 为 0.5，assetId／originalAssetId 仍为 original。
- 整次裁剪只有 **1 个 History 条目**；完成面板后仍选中 picture。Undo **恢复整个原始图片实例**，undoDepth 回到 0，选中仍为 picture。
- 实际图片资源已在浏览器解码（naturalWidth=320）；无选图器调用、pageerror 或 harness 错误。实际裁后截图已查看，像素裁去右边且选中框对应新 frame。

证据：`output/test-runs/image-panel-browser/spatial-crop/vitest.json`、`facts.json`、`spatial-cropped.png`。fixture 已关闭。此证据新增 Spatial 原生裁剪属性，不扩展为所有缩放／旋转／嵌套矩阵的全矩阵声明；非零旋转沿用原禁用理由。


## 终点首次运行后的测试 fixture 补正

Root 终点原始报告 `output/test-baseline/2026-10-24T17-20-02-350Z/initial.json` 记录首个 Slide 用例失败于 DocumentHostService.save：**另存目标已存在**。此前 Root 4／4 聚焦预跑保留了固定 `image-panel-saved.glx` 证明文件，重复运行再次请求另存同一路径被正式保存保护正确拒绝。这是本轮新增测试的重复运行 fixture 缺陷，不是产品保存保护回退。

仅候选测试两行补正：导入 node:crypto 的 randomUUID，另存文件名改为 `image-panel-saved-${randomUUID()}.glx`。没有删除／覆盖旧 GLX 证据，不改产品保存保护；实际正式 GLX 写盘、全新 DocumentHostService 冷开、data／frame／History 断言全部保留，测试名称不变。

候选仅运行首个具名用例 **1／1 通过**，Spatial 因 `-t` 未重跑，其已通过证据继续有效；报告 `output/test-runs/image-panel-browser/vitest-unique-save.json`。本次实际新路径保存在 facts.json 的 savedFile 字段，未覆盖旧证明文件。补正已独立 review 通过，见同目录 REVIEW.md；Root 终点原始失败不得覆盖或洗成全量通过，待 Root 结束该轮失败文件复跑后统一集成。


## Root整合记录（2026-10-25）

终点全量及304个失败文件复跑已全部结束，本文所述已审补正随后同步根目录。原冻结样本及其失败未改写；后续定点证据、未决和最终状态统一见[综合结果第7节](RESULT.md#7-全量比较样本后补正与交付边界)。图片唯一另存的本次facts在Root另存于`output/test-runs/image-panel-browser/unique-save/facts.json`，旧facts及GLX保留。
