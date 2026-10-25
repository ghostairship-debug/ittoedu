# Flow浮层与图片双击接线结果

2026-10-25；候选工作树：`C:\Users\74755\.codex\worktrees\regression-boundary-repair\果铃工作台`。对应本轮PLAN的R1-A、D02及D01的Flow正文图片入口；未commit、push或发布。

## 实际改动

- `FlowWorkspace.tsx::FlowFloatingInstance`仅在编辑态捕获点击；试运行沿原Runtime/Navigation执行业务，不改运行系统与教师按钮默认配置。
- 当前唯一对象工具条直接显示纸面／段落／视口定位select；原布局owner仍负责坐标转换。上下文字层、转正文合并进原“更多操作”，删除复用原菜单，不增加独立移动条。
- Flow原生图片双击进入已确认的简易编辑面板。正文PM以media块承载图片，且整体拖动的pointer capture会使浏览器将dblclick重定向到编辑器；根捕获记录本次pointerdown的准确DOM对象及坐标，双击仅在同坐标使用该手势对象，不退回上次选择或父对象。原生图片分支先于Source作者字段查找及course-instance过滤。
- Flow正文图片打开面板时，原正文目标工具条挂起；关闭面板保留同一图片选中。面板本身、属性写入及跨Surface能力由主执行者统一实现。
- 独审补漏：Flow的原生图片裁剪回调现按当前单选图片绑定，涵盖正文、浮层及全局图片；全部复用既有`FlowMediaCropEditor`和捕获的正式命令。裁剪只提交图片data，不重算frame或段落锚点。原裁剪对话框挂载时取得焦点，使面板转入裁剪后立即Esc能取消原草稿。

## 复现与验证

新增`tests/integration/flowFloatingBoundaryBrowser20261024.test.ts`，复用现有`currentFlowBrowserHarness`，接实际`DocumentHostService → DocumentSession → Store/Bridge → FlowWorkspaceConnector → CourseV10RuntimeView`。Chromium 149.0.7827.55；不是脱离React捕获的函数测试。

| 属性 | 证据 |
|---|---|
| 修前宿主DOM业务按钮 | 同一浏览器fixture的bundle指向根目录未修复e77963756源码：编辑不执行业务，试运行按钮仍保持关闭，业务点击计数0；随后点击默认教师展开按钮也没有展开，断言失败；无pageerror |
| 修后编辑／运行往返 | 编辑点击选中floating且业务计数0；拖动产生一次正式revision，鼠标释放不触发业务，Undo恢复原frame；试运行原按钮展开且业务计数恰为1；回编辑再次点击仍选中该对象，业务计数仍1 |
| 真实教师按钮 | fixture显式含原默认配置的builtin教师控制台，作品controls设为canvas；试运行点击原“展开教师控制器”，出现原“收起教师控制器”。产品默认配置没有变化 |
| D02实际呈现 | 一个可见当前目标工具条；直接select从纸面切换段落定位；原“更多操作”可见移到正文下方、转为正文、删除。已检查实际截图 |
| D01 Flow正文入口 | 真实正文图片双击打开“图片简易编辑”；面板打开时0条可见对象快捷条；Esc关闭后selectedInstanceIds仍为picture |
| 既有手势／分层 | `flowOverlayFinalPointer20261023.test.tsx`完整3例及`flowUnifiedLayers.test.tsx`完整3例通过；与新浏览器用例合计3文件7例通过 |

最后单文件浏览器复核通过。观测值：修前`{businessExpanded:'false',businessClicks:0,teacherExpanded:false}`，候选`{businessExpanded:'true',businessClicks:1,teacherExpanded:true}`。业务提示在点击别处时沿原逻辑关闭，所以在点击教师控件前读取其展开状态。

证据均写入已忽略的`output/test-runs/flow-floating-boundary-20261024/`：`facts.json`、`fixed-test-report.json`、`final-browser-report.json`、`unfixed-test-report.json`、`fixed-run-clicks.json`、`unfixed-run-clicks.json`及`flow-locator-and-more.png`。未改写历史证据目录。

独审后的增量验证仅运行新加的Flow浮层原生图片裁剪case，原R1业务用例按`-t`未选中，不重复计算为通过：实际双击图片→简易面板→裁剪，键盘调整左裁剪到20%→确认，正式data.crop.left=.2且一次History；frame及paragraphAnchor与原值相同；Undo恢复原图；再开裁剪立即Esc，revision/model均未变且仍选择floating。1个新用例通过，无页面／Runtime错误；证据为`output/test-runs/flow-floating-boundary-20261024-crop/{facts,test-report}.json`。此新增浏览器证据覆盖段落锚定浮层图片，全局图片为同一回调接线，未另声称做过全局GUI裁剪验证。

## 范围与余项

- 结论针对当前真实Flow装配中的宿主DOM浮层控件及默认builtin教师按钮，不声称所有iframe浮层原先均失效；没有改iframe内部事件桥或生命周期。
- 图片面板的替换、其他参数、保存及冷开由主执行者图片专项验证统一报告；本项证明Flow真实入口、工具条互斥、保选及上述浮层裁剪／Undo／取消。
- 最终组合候选三段typecheck、全量终点比较、集中独审由Root收口，不在本子任务重复执行。
