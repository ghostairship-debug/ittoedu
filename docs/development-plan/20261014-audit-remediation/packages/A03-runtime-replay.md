# A03 编辑热点与真实输出回放

结果：Source与Web的自动/显式作者目标可命中、可提交，保存修改在direct/native播放和重绘后呈现，当前展示状态不被首状态元数据覆盖。

依据F01/F04/F08及新查编译去重消费者。前置A02，联同A01/A04。Owner：Root runtime接线；SandboxComponentRuntime、ComponentRuntimeWorld、CourseV10RuntimeView、compiledPlayer等共享文件单writer。

实施：复用现HTML作者binder/DOM scan/显式AuthorSpot，不新增路由。Source自动观察接现Host；无data.html的显式目标hit-test/右键与覆盖按钮一致，同时尊重实际遮挡，不能无条件相信几何候选；不把自动可写目标都强制手填。专业默认整框热点不得捏造自定义画面内部几何。直接接线还包括`src/player/componentPlatform/publishedPlayer.ts`及`src/components/web/authoringDom.ts`。

按真实作者root装配记录回放，初始化/update/重绘后的生命周期一致；播放也消费记录，不能要求authoring=true才正确。direct Source及direct Web共同接已存作者记录；native仅补当前缺口，保原记录/资源解析。

`src/core/publish/componentPlatform/compiledContract.ts`签名、compileCoursePlayback与`src/player/componentPlatform/compiledPlayer.ts`当前把首份nativeData/semanticData伴code复用。保代码去重，但记录、textOverrides、resourceBindings必须从当前projected instance读取；两个状态同代码不同作者修改不能显示首状态。

验证：最近层先证明两个状态仅记录/binding不同仍用当前值；一条实际Source文字输入→提交→重绘→Undo→保存冷开→受影响direct输出；native真实独立Document仅补受影响消费。无HTML显式spot单独反例。不能以回执带records或编辑器截图签导出已应用。

