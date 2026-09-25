# B00 实施基线 · 2026-09-23

Owner 本轮已授权完整 B00–B12 产品实现。Goal 保持 active；本记录只证明 S01 开发起点与能力基线，不证明 2.0 已完成。

- 源码：`071149e20e62d9eef58c3f745d1d5be873c0d07b`；开发分支 `codex/g20-implementation-20260923`，无 Git commit/push。
- 上一轮方案、设计、评审及旧 r20 卡退役修改全部保留。差异/清单：`output/g20/b00/initial-tracked.patch`、`initial-status.txt`；首次读取的原始工作树状态另见本次会话工具记录。
- 环境：Windows，Node v24.14.0、npm 11.9.0、Python 3.13.5；Electron 43.1.1，tsx 4.23.1，Vitest 4.1.10，Playwright 1.61.1（仓库锁定依赖）。
- 样本副本：`output/g20/b00/samples/course-project-v9/`、`shared-document/`。界面用例另外通过真实工厂生成隔离临时文件，不在原件上试验。
- 28 个任务的 123 条 existing_code 引用，53 个唯一当前源码路径，缺失 0。

## 实际验证

1. `npm run build:desktop`：exit 0；内置组件检查、Player、renderer、Electron 构建完成。日志 `output/g20/b00/build-desktop.log`。大 bundle 警告存在，不冒充当前核心功能失败。
2. `npx playwright test tests/e2e/r19FrontendSpecialPathA.spec.ts tests/e2e/r19FrontendSpecialPathC.spec.ts tests/e2e/r19DocumentCoauthoring.spec.ts --grep 'F08 path A:|F08 path C:|copies image and cw object' --workers=1 --reporter=list,json --output=output/g20/b00/playwright`：发现/运行 3，通过 3，失败 0，跳过 0；2.3 分钟。证明 Markdown 手改保存重启、Flow/Markdown 图像与对象往返和撤销、Slide 状态撤销/重做/保存重开及实际预览。日志和结果 `output/g20/b00/electron.log`、`electron-results.json`；截图 `electron/`。
3. `npx playwright test tests/e2e/spatialGlobalRuntimeAuthoring.spec.ts tests/e2e/flowComponentConversion.spec.ts tests/e2e/editor.spec.ts --grep 'Spatial global API2：|Flow overlay component converts through|流程 7：两页课件导出 PDF 与 PPTX' --workers=1 --reporter=list,json --output=output/g20/b00/preservation-playwright`：发现/运行 3，通过 3，失败 0，跳过 0；2.4 分钟。证明 Spatial Runtime 手改/历史/保存重开/离线 HTML、Flow Component 正文转换/资源/历史/归档/Published/DOCX、Slide PDF/PPTX 实际导出。日志和结果 `output/g20/b00/preservation.log`、`preservation-results.json`。

未运行整文件真实 CLI 矩阵；未调用任何产品付费模型。本批 6 个 Electron 用例只是代表基线，不代替 M13 或最终保全门。

## S01-T05 归因

探针：`output/g20/b00/reproduce/s01-t05-probe.mts`；记录：`S01-T05-RESULT.md`。实际运行一个行为探针和 6 个名称筛选单元用例（4 + 2）。历史跨行引用错误写入未复现，但跨行排版编辑仍因 unmapped 被拒绝；旧清单首次漏列已修，harness 后置追加 host-result.json 不在显式引用清单仍复现。当前 UI 明确说明清单不是完整最终载荷。不是环境阻塞，也不是两个功能已通过；S01-T05 的源码准确归因要求完成。跨行保真归 S06/M05，输入/过程边界归 S05/S08/S07，保留到对应工程验收，不恢复旧 r20 卡。

## 已核实迁移边界

- 课件 writer：editorStore 单例与 slide/flow/spatial slice 的 persist/undo/redo；工具只接管 courseToolTransaction 不足以迁完人工路径。
- Markdown writer：renderer DocumentFileSession 的 source/History 与 main LessonDocumentFiles 的磁盘/AI apply；须接入同一 Session，不能保留旁路写入。
- 资源/事务纯函数当前通过 v9AssetAdapter 拉入 Published；archive 与组件 codec 需提纯后由 Driver 复用。
- 23 个工具的静态注册会载入真实 DOM/Player/媒体解码，不能整包搬入 main；测量、动态准入、图像解码和字体保留窄观察端口。
- projectPersistence 当前单 recovery 文件不能作为多文档恢复。保存必须固定已提交 revision，ViewState 与 DocumentId/path 分离。

S01 的基线、代表能力及归因已建立。B01 后续三个内部检查点仍需分别取得真实证据；纯内核测试通过不意味着主进程与默认 UI writer 已迁移。
