# 统一选择、拖动与编辑实施结果

> 2026-10-25边界纠正：本文件保留原轮结果与统计，不能把其中实现状态或技术独审当作额外UI／模式／操作路径的Owner授权。本次恢复HTML“编辑／完成编辑”、普通文档原快捷动作和Flow文档／段落入口，并按Owner新确认实现图片简易面板及Flow直接定位／更多布局；新增测试失败已逐条定性，具体候选、保留失败与起终点比较见[边界回归修复结果](../20261024-regression-boundary-repair/RESULT.md)。当前不commit、push或发布，新产品变更仍须先确认。

日期：2026-10-24。基线 `main / 63992093a`。Owner 在方案阶段后明确“按照方案执行”，本轮实施依据为 [PLAN](PLAN.md)。当前：方案规定的软件迁移、针对性检查、独立源码评审和代表性组合验收已完成，未提交。

## 用户操作与实现

- 创作区单击选择；从对象主体按下后拖动，超过约 3 屏幕像素才移动整体。双击进入内容编辑或下一层级；编辑内部的拖动继续选择文字／单元格。Esc／完成沿原输入 owner 应用或明确保留输入，返回当前目标；普通组在没有输入／手势时 Esc 返回上层。
- 工具条共用格式控件和显示壳；整体文字选择作用于全文，编辑态作用于实际范围或光标。普通字符串提供其真实支持的编辑／完成操作。有输入时不再显示另一套对象条。颜色弹层保留输入范围，公式 Esc 不再直接清稿。
- 正式选择投影为实线框；移动、缩放、旋转入口按实际能力及锁定状态显示。精确字段用自己的边界定位条和框，无独立几何时不移动父对象。编辑时保留选择反馈并关闭整体变换手柄。
- Slide、Spatial、Flow、程序根及受管 Web／Source／nested realm、独立 HTML 迁移同一意图。Flow 保留单个连续 PM，正文主体拖动改读序；浮层复用原 FreeTransformGesture 和 placement／paragraphAnchor。
- 普通组范围放在既有 view／Bridge 的临时 `activeGroupId`，不写入作品。当前层级命中、图层／AI 精确定位、进入／返回真实容器继续使用正式实例树和原导航 owner。
- realm 保留稳定作者地址及 start／update／end／cancel，选择态不执行业务按钮；只有内容输入态扩选文字。独立 HTML 的选择和实际输入分离，完成后恢复原文绘制并保留同目标。

所有数据写入仍由原 DocumentSession／Bridge／HTML source edit／PM 事务完成。没有第二选择 store、writer、History 或持久化编辑 phase。

## 原问题与同类范围

| 编号 | 实施与裁定 |
|---|---|
| U01 | Slide 接入准确 authorBounds，native table／chart 精确定位可按正式地址恢复当前边界 |
| U02–U03 | 共用 TextFormatControls；全文／范围命令仍由原 owner 执行；plain 字段也有编辑完成条 |
| U04–U06 | 单击不自动开输入；主体拖动、显式双击、move／resize／rotate 分发收敛；退出 text 穿组特例 |
| U07–U09 | 锁定选择仍有实线框；正式字段选择驱动反馈；共同八向手柄使用正确光标 |
| U10 | Flow 退出专用移动条和单一右下点，主体与共同手柄沿原浮层几何和锚点写回 |
| U11–U12 | realm pointer 与 double-click 分流，传完整生命周期；原始目标和最终点贯穿迟到 ACK |
| U13–U14 | 独立 HTML 选择／编辑分离，实际输入才抑制文字；完成保选、恢复原文、共同能力框 |
| U15 | 字段方向键交给精确字段几何 owner；无能力明确诊断，禁止回退移动父组件 |
| U16 | Spatial 创作态作品 input／button／link 先走作者命中，run 保持业务交互 |
| U17 | 补阈值、最终点、取消／lostcapture／Esc、无变化不写 History；已结束的迟到命中不重新捕获 |
| U18 | 输入交接与显式完成分开，保留同目标；慢 ACK 双击保留明确编辑意图，不重命中旧坐标 |
| U19 | 既有 view／Bridge 中增加临时组范围；清选择不丢组，精确外部定位重解合法父组 |
| C01 | Spatial 延迟命中时释放状态由原 pending 手势保存，定向反例覆盖不再次 capture |
| C02 | AI 卡 rich dataPath 恢复正式 author-field，使用真实富文本解析；不放宽任意 JSON／string authorField 合同 |
| C03 | 共用控件和单物理快捷条已落实；没有把原静态双路径冒充已复现稳定同时重叠 |
| C04 | 再查旧 CompositionEditorDialog／CompositionFragmentPreview 仍仅定义／内部引用，无生产调用者证据；保留，不重建旧组合平台 |

## 验证与评审

聚焦检查由真实消费者和可信失败模式选取。各叶子有效证据保存于 `output/unified-selection-editing-20261024/leaf-reports/`；可持续复验的检查在本次新增 `tests/unit/unifiedSelection*20261024` 与 `tests/e2e/unifiedSelection20261024.spec.ts`，保留原读写、History、几何和地址断言。

- Slide 真实组件／native 输入／快捷条／DocumentSession 装配的 11 条通过；最后新增 realm 整体双击编辑出口反例定向通过。包括慢 ACK、字段 anchor、锁定、取消、右键、预览坐标及组返回。
- 主树整合后 Slide／Program／工具条弹层 3 文件共 20 条通过；新增 realm 出口修订另以定向反例证明。不把 skipped／未匹配计为新通过。
- Flow／Spatial／程序根／命令／组／realm／HTML／工具条的聚焦行为分别通过；对 Owner 明确改变的单击编辑、文字穿组、旧专用拖动入口断言作等价迁移。
- `build:player` 通过，正式 chrome113 compiled runtime 已生成。
- `npm run typecheck` 三套类型通过；最后 Slide 小修及新反例后 renderer 类型再次通过。最终 `build:renderer` 通过，生成结果对应最后软件候选。
- 5 个真实 Chromium 用例有各自有效通过证据：Slide、Spatial、Flow 代表样本真实鼠标／键盘操作；独立 HTML capture-root 后图像双击；Slide 单框视觉。Slide／Spatial／Flow 均保存 GLX 后由独立 Node/tsx 进程冷开、比较解析后的正式 project；Flow 正式离线 HTML 的业务按钮 Count 0→1 且保留修改正文。命令、facts、截图与中间失败见[浏览器记录](../../../output/unified-selection-editing-20261024/browser-result.md)。
- 已查看最终 Slide 单条／实线框、Spatial 锁定框、HTML 原文恢复、Flow 当前字段框及离线 Player 的实际像素。该证据来自真实 Main API transport／Store／Bridge／Runtime 的 Chromium 装配，不冒充完整 Electron 壳层、全局键盘或全部旧作品验收；HTML 裸 agent 也不冒充 Pane，Pane／Session 的完成保选与写回由针对性检查承担。

独立源码评审见 [交互评审](INDEPENDENT_REVIEW.md)及 [Flow／HTML 评审](HTML_FLOW_REVIEW.md)，最终已审候选均批准。发现并修复了锁定字段假手柄、公式 Esc 清稿、realm 预览坐标／右键残留、慢 ACK 双击及内部图片双击／锁定边界；后续真实浏览器还发现 Flow 将 pointer capture 放在 PM 外根、双击进不了输入，以及 Slide 选中后仍叠旧 discovery 虚线／badge；均已修并定向复验。Program 的 native table／chart 复用原专业输入 owner，ACK 后从 Bridge 当前 frame 续手势，避免覆盖新尺寸。评审与实际视觉验收分别记录。

保留的旧检查边界：旧 SharedDocumentEditor cross-owner paste 的 stale fixture 仍要求“无诊断”，而基线已明确诊断目标变更；旧裁剪夹具把 logical width 与屏幕 width 混用；Spatial 旧集成 fixture 缺真实 paint／adoptedStyleSheets。没有删除、skip 或修改这些无关断言以取得全仓通过。本轮不声称全套测试通过。

## 交付边界

未修改用户原作品、人工布局、原件、恢复稿或真实 profile；未调用模型／新费用路径。旧卫生整理 commit `63992093a` 是历史事实，本轮没有 commit、push、Portable、发布或部署。软件、真实组合样本和 Owner 整体接受分别判断；不签普遍性能提升、任意程序内部图元编辑或物理 IME／整套桌面操作验收。

本轮七个隔离工作树的候选已按单 writer 清单整合，最终报告已复制到主目录 output。工作树回收尚未完成：专用归档请求返回 queued 后仍保留 active checkout；自动审批又拒绝批量及单个依赖目录 Junction 的删除，均只返回 `blocked by policy`，未给更具体原因。未继续尝试其他删除路径，工作树、可恢复成果及 `D:/果铃工作台/node_modules` 均保留。这是辅助清理余项，不影响已完成的软件及验收结果。
