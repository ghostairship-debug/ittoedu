# HTML／IME修复结果

2026-10-25；候选工作树 `C:\Users\74755\.codex\worktrees\regression-boundary-repair\果铃工作台`。本包没有commit、push或发布，没有修改 `D:\果铃工作台` 的产品和测试。

## 已完成的产品行为

- HTML文档顶部恢复“编辑／完成编辑”，实际模式ACK、输入保稿、源码入口及内部选中／输入分离保留。
- 图片双击或“编辑图片”打开已批准的简易面板。HTML图片复用精确源码字段现有能力：替换图片与已有尺寸属性；未把原生对象的旋转／裁剪等能力伪装成此处已支持，也未改父对象。替换或应用属性后面板继续打开，“完成”或Esc退出，当前图片仍选中。选中快捷条在面板期间隐藏，避免重复。
- 图片文件选择等待期间固定原字段目标。即使用户已选中另一图片，返回的文件仍只提交给最初捕获的handle；原revision校验仍在Main与Controller路径保留。
- 修复真实IME时序缺陷：原实现把blur完成请求放入microtask；compositionend先到时可能没有待完成请求。现在在composition期间blur同步登记请求，由compositionend读取最终DOM值并只提交一次。格式工具条焦点仍不结束输入。

## 原7条告警逐条定性

原fullName均保留，未删除正确断言或降低保护属性。

| 原用例fullName | 分类与处理 | 保留／补充的行为证据 | 结果 |
|---|---|---|---|
| finishes editing after a rejected field while retaining its input, and keeps business interaction blocked until the mode ACK | 未授权文案回退由U-R01恢复；统一选中已批准，夹具显式发送双击的`intent: edit`。顶部与对象条同名“完成编辑”，查询限于原HTML分页工具条。 | 拒绝后原输入保留、ACK前iframe禁交互、ACK后退出、prepare持久化草稿；未改写任何原断言。 | 通过 |
| ends mode failure waiting and leaves the source editor available without faking an edit-mode ACK | 未授权“编辑”改名造成入口失配；产品恢复原名称。 | 模式错误后结束等待、重连可用、禁业务交互、源码仍可编辑；没有伪造ACK。 | 通过 |
| commits the final IME input only once when blur requested completion before compositionend | 真实产品回退，修`CanvasPlainTextEditor` blur／compositionend owner。测试事件及一次提交断言不变。 | compositionstart→input→blur前0次→compositionend／再次blur仅最终中文1次。 | 通过 |
| patches an exact selected text change despite an unrelated malformed tail, without reloading the preview | 已批准选中／编辑分离的等价夹具迁移，发送`intent: edit`。 | 精确field局部patch、保留无关malformed尾部、预览open仍仅一次。 | 通过 |
| prepares source typed during the recovery ACK instead of returning the captured old source | 已批准选中／编辑分离的等价夹具迁移，发送`intent: edit`。 | ACK等待期间最新源码覆盖旧捕获值、编辑器内容保持最新、未应用字段草稿仍保留。 | 通过 |
| keeps the move action in the existing toolbar for 'a left-aligned full-width paragraph' without overlaying the document | 原fullName包含旧移动按钮路径；按已批准“选中后主体拖动”迁移驱动，不恢复额外移动条。 | 快捷条不覆盖文档；选择态不误输入；主体start／move／end只向`full-width`提交一次`translateX:30, translateY:12`；再显式编辑仍读原文字。 | 通过 |
| keeps the move action in the existing toolbar for 'a split heading run beside other text' without overlaying the document | 同上，使用独立split-run几何。 | 保留相邻文字的局部范围；同一handle的主体拖动一次提交，编辑后仍准确原文。 | 通过 |

## 聚焦执行与新增证据

- 最终文件级：`npx vitest run tests/unit/htmlPreviewRecoveryUi20261023.test.tsx --maxWorkers=1 --reporter=json --outputFile=output/test-runs/html-repair-verified.json`，**9／9通过**（原7＋2条图片面板／异步目标保护）。
- 原IME编辑直接消费者 `plainAuthorInline20261022.test.tsx` **6／6通过**，见 `output/test-runs/html-repair-final.json` 对应文件记录。该次组合运行HTML文件另有一次初始ACK夹具请求未就绪，后续文件级检查9／9通过；未把此偶发观察隐去或宣称修过该握手。
- 额外直接消费者 `g20HtmlEditingUsability.test.tsx` 当前**3／5通过**，见 `output/test-runs/html-repair-first.json`：两处失败为旧按钮文本报告预期和缺失`edit-targets`自动扫描报告；不属于本包原7条，未改产品扫描或改断言洗绿，交主会话起终点比较归因。
- 行尾按HEAD逐文件保留（仓库存在LF／CRLF混合），自有文件`git -c core.whitespace=cr-at-eol diff --check -- …`通过。未改全局换行设置。

## 真实Chromium最小装配

使用 `agent-browser` Skill，Vite仅本机5203端口，挂载实际`CanvasPlainTextEditor` owner；没有付费请求。证据目录 `output/test-runs/html-ime-boundary/`：

| 属性 | 实际结果 | 证据 |
|---|---|---|
| blur早于compositionend | blur后0次，compositionend及再次blur后仅一次“中文结束值” | `composition-case.js`、`composition-case.json` |
| IME期间移到格式控件 | 焦点为format，0次完成提交 | `toolbar-case.js`、`toolbar-case.json` |
| 实际逐键输入与结束 | CDP键盘逐键输入`actual typing`，点击外部“结束输入”后恰一次同文提交 | `ordinary-typing.json`、`ordinary-typing.png` |

composition事件由脚本派发，只证明浏览器该事件时序与焦点路径；没有物理中文输入法、整Electron或所有载体声明。截图已实际检查，显示实际输入和一次提交记录。

HTML图片支持范围仍以精确源码字段现有写入能力为界，本包没有新增图像引擎、第二History或新的模式。

## 补充：HTML名称的两处直接测试消费者

主会话终点全量运行期间发现另两处仍按未确认名称“进入创作”查找HTML顶部按钮。仅在候选工作树将以下各一处locator恢复为U-R01规定的“编辑”，没有修改产品、原fullName、模式ACK、几何、正式数据、History或其他行为断言：

- `tests/unit/htmlAuthoringRecords.test.ts:349`
- `tests/unit/unifiedSelectionHtml20261024.test.tsx:49`

搜索unit与integration没有其他“进入创作”literal；其余“试运行”literal属于课程／Flow／Spatial运行按钮或运行时名称，不作扩大替换。

一次聚焦运行：`npx vitest run --config output/test-runs/html-direct-consumers.config.ts --maxWorkers=2 --reporter=json --outputFile=output/test-runs/html-direct-consumers-verified.json`。临时配置位于ignored输出目录，浅拷贝正式Vitest配置，只将`include`明确设为上述两个完整文件、`globalSetup`设为空，未重复preparePlayer或扩大范围。结果**17／17通过**（10＋7），原始JSON保留。diff仅两行locator替换，`core.whitespace=cr-at-eol`的聚焦diff检查通过。

本补正未在全量运行期间集成回Root；终点raw中的文案失配必须保留，并与本次补充聚焦证据一并报告，不能改写基线把原观察抹除。

## 补充：HTML占位图片面板的直接消费者

终点首轮进一步发现`tests/integration/g20M23HtmlLightEdit.test.ts`的`shows the source AI card for a no-src placeholder and disables an unbound dynamic text target`仍查询旧“选择图片”。D01已经明确统一图片面板的显式替换按钮，且`HtmlLightEditOverlay`仍沿原`submit → selectImage → onImage`路径，因此候选仅将这一处locator改成“替换图片”。原fullName、占位图片target夹具、Source AI card存在、unbound动态文字诊断及AI禁用断言全部保留；原用例只检查选图按钮存在，并未点击picker，未把它报告成picker执行证据。异步picker精确目标的实际驱动证据仍使用前述新增图片测试。

同类literal搜索只有这一处；`g20ExecutionSettingsPanel.test.tsx`中的“需要选择图片模型”是独立错误文案，不作替换。

一次完整文件聚焦：`npx vitest run --config output/test-runs/html-lightedit-direct.config.ts --maxWorkers=1 --reporter=json --outputFile=output/test-runs/html-lightedit-direct-verified.json`。ignored临时配置浅拷贝正式配置、`globalSetup: []`、`include`仅此完整文件。**目标用例通过，文件17／18通过、0skip**。剩余`keeps the same frame and script state when canonical change arrives before the edit ACK`查询另一旧名称“编辑预览”，且夹具未先完成ready／编辑模式ACK；本补正没有扩大改动该用例，也没有修改产品或正确断言。此剩余失败交主会话与起终点raw归因，不能声称整个文件全过。

diff仅一行locator替换，聚焦行尾检查通过。Root全量运行中的产品、测试及运行定义均未改变；原终点失配和补充检查原始JSON分别保留。此前两个文件17／17证据未重跑。


## Root整合记录（2026-10-25）

终点全量及304个失败文件复跑已全部结束，本文所述已审补正随后同步根目录。原冻结样本及其失败未改写；后续定点证据、未决和最终状态统一见[综合结果第7节](RESULT.md#7-全量比较样本后补正与交付边界)。图片唯一另存的本次facts在Root另存于`output/test-runs/image-panel-browser/unique-save/facts.json`，旧facts及GLX保留。
