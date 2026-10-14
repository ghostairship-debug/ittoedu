# A02 作者记录归属、按属性写回和状态

结果：作者文字/图片/几何/样式覆盖归组件作者层，不污染任意业务data；每次修改命中正确属性与当前展示状态。

依据F03/T02。Owner：Root正式合同/事务，先核已独审方向并审最终候选。前置无，A01/A03/A04消费本包确定的地址。

修改边界：component-platform instance与presentation override strict schema、正式路径解析与project/data操作、sourceAuthoringEdits/authorSpotTextEdits/authorSpotImageEdits、当前值投影与记录reconcile、Published投影、复制/库消费者。使用现DocumentSession/CAS/History；codec/clone已有完整序列化则复用，不造第二存储或迁移平台。

编辑草稿的`src/renderer/store/slices/slideAuthoringSlice.ts`当前投影data/implementation，新作者层必须进入同一草稿投影，保输入预览与提交值一致；`src/main/workbench/contentApply/applyService.ts`现HTML摄取协调接新归属，继续只退役源文实际替代的text/src，保留geometry/style。

通用记录放组件作者层；需要的图片resourceBindings必须有同一适用归属，不能只迁records而继续写任意data。按本次text/src/geometry/style属性解析有效目标：同一authorKey已有geometry不能抢走text的dataPath/sourceRegion。读取呈现合成当前源/数据与对应属性覆盖；明确源文变更时只退役被替代的覆盖，保几何样式与人工布局。

展示状态继承/override沿现正式状态投影，只改当前状态不串基础及兄弟状态。旧override.data是完整替换：已有data override而无记录时原有效记录为空，新归属必须能用显式空值覆盖base，不能意外继承base记录。默认记录上移采用本轮正式格式而不另建旧格式迁移器；原工程留副本，当前业务data.authoringRecords的合法语义在明确载入/应用边界承接，不全局迁磁盘、不长期双写、不静默丢已有修改。authorSpots与Sandbox两端都按本次属性协调owner，不能只修一端。

最小验证：primitive/数组/严格专业data不被改形；已有geometry后改text仍写正确字段；当前展示状态隔离；一次Undo/Redo与保存重开。复制/库和输出使用A03/A04集成例，不重复全矩阵。新路径与生成schema资源通过正式生成器同步。

