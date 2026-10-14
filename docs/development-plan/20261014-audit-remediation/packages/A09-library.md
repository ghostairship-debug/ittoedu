# A09 组件库承诺与可续改路径

结果：HTML旧资产区不再承诺实际不支持的AI检索插入；现API5保存→检索→插入→继续修改保持可用。

依据F10。Owner：Root库UI/既有服务；提示无前置，Source资源案例依A04。主要路径`src/renderer/ui/ComponentsTab.tsx`与`src/main/workbench/assetSources/componentLibrarySearch.ts`。

按实际能力修提示：旧HTML可查看条目信息、删除我的条目；当前不支持AI检索插入。保API5搜索/读取资格，不因此全库迁移或开放未知旧格式。API5续改仍走现canonical data/source owner。

最低验证：`tests/unit/htmlComponentLibraryUi.test.tsx`覆盖现列表/删除/过滤及新提示；现g20AssetLibrarySearch旧HTML排除可复用。完整库路径沿`tests/integration/productFollowup/T02/librarySelectionJoin.test.ts`，仅补实际缺少的插入后文案/data修改与冷开；asset.update包定义不等于插入对象正文可改。UI提示通过与完整库链证据分别报告。

