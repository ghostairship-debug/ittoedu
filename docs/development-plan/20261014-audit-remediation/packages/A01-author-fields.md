# A01 普通字段、页面文字与精确 AI 目标

结果：相同作者语义换为Source表现后仍能定位和修改正文/专业数据；页面文字列表显示真实作者字段；选内部字段给AI时冻结对应字段，整对象选择仍可用。

依据：F01/F02/F08、T01、GPT两报告。Owner：Root作者用例；前置A02确定记录地址/状态语义，目标合同共享文件顺序写入。

主要路径：`src/renderer/ui/workspaces/SlideLocationWorkspace.tsx`、`src/renderer/workbench/NativeSelectionContext.tsx`、`src/renderer/workbench/SelectionContextController.ts`、`src/renderer/workbench/RuntimePageText.tsx`、`src/renderer/composition/runtime/runtimeLightEditCommands.ts`、`src/core/tools/ToolTargets.ts`、`src/core/course/courseProductivityEdits.ts`、`src/core/tools/DocumentToolGateway.ts`、`src/renderer/composition/selection/slideLightEditingPort.ts`与`src/renderer/ui/properties/FlowPropertiesContextBuilder.ts`；executionDesktop及`src/shared/workbench/tools.ts`的目标合同与A02顺序交接。按实际调用追到共同planner，不能在每入口另造资格决定。

实施：按真实字段语义/可写地址判断普通编辑资格，执行加载保kind区别；自定义Source视觉不能因professionalBuiltinKey被换回builtin。pageCopy与AuthorSpot entries统一列表投影，修V10不对应的runtime条件。单字段修改按身份；同文批量替换保独立明确动作。同字段多处显示不是多个字段、同文不同字段不是同一作用域。

course-instance dataPath沿既有fieldScope；authorKey/sourceRegion由共同目标合同与Gateway准备窄地址，Source override与definition两种来源一致。内部spot传入冻结目标，不用整个实例静默兜底；图片参考不与图片替换资格混同。软件准备身份，模型不维护key/offset。

精确冻结还要同步`src/core/tools/ToolReadCoverage.ts`、SelectionContextController与Gateway授权包含关系/状态依赖；不能只有ToolTargets识别新字段而观察覆盖仍授权整实例。

验证：最近层命令/目标反例证明dataPath、源码与记录字段的范围，实际V10一个Source标题从页面文字/现场入口输入提交并读回、Undo、保邻字段。与A03联验保存冷开和实际输出，复用未变其他Surface证据。限制：并不承诺任意黑盒画面能逆向成字段。

