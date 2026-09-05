# 页面配方

`recipeCatalog.ts` 是六个配方 ID、版本及输入槽位的唯一目录。UI、Builder、能力索引直接投影它。`planRecipe` 在明确的 Slide 目标位置后新增普通页面，使用既有 V9 工厂、一次 document mutation 与资源事务计划；规划失败不写工程，提交方必须再次核对当前 session generation、位置和 revision。

输入表单是临时状态；展开后的文字、声明式规则、课程状态及 Component 参数均由原有编辑器维护，不保存 Recipe 节点或专用运行时。固定版式检查显式换行和保守换行容量，字体不低于 20 px；超容量返回换档、拆页或 Flow 建议。这里不提供自动排版求解器。

`single_choice_*_correct` 是可编辑的普通 boolean 课程状态，选项规则写入答题正确性，重置规则恢复 false。该明确单选规则族约定由 `shared/singleChoiceRuleFamily.ts` 诊断；不根据标题、Recipe 名称或任意手写多选规则推断答案。改名不会破坏运行，但不再自动识别该单选族。

排序使用随产品代码交付的 Component API 4 DOM 包。项目稳定 ID、文字、正确顺序、反馈在已有组件属性栏编辑；学习者用原生按钮的指针或键盘操作真实重排。包的 manifest 和 runtime 字节与页面一起写入同一资源事务，保存、重开与导出复用正式 Component 通路。

应用层接线：`createEditorTransactionStep(project, result.plan)` → 当前 Surface `persistTransaction` → 激活 `createdLocationId`。`resourceChanges` 已包含所需包字节，不能只持久化 `nextDocument`。Headless Builder 同样合并 package resource delta 后交给正式归档 API。
