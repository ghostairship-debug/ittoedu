# A04 Source 换图与跨工程资源

结果：Web派生Source换图后，提炼到库、插入另一工程、发布裁剪与输出都保token并重映射真实assetId。

依据F04/T02。Owner：Root资源owner。当前data绑定collector/remapper可先修；组件作者层路径依A02，输出依A03。

主要路径：`src/core/components/library/references.ts`、`src/core/components/library/rebindSource.ts`、`src/core/publish/componentPlatform/buildPublishedCourseV3.ts`、authorSpotImageEdits及实际resolveWebResourceBindings。collector/remapper的资格必须与真实运行消费者一致，effective builtin不能排除仍消费绑定的派生Source；不扫描替换任意业务字符串。

覆盖definition Source与instance override、记录中真实图片引用、presentation overrides、复制/提炼/插入依赖闭包。直接consumer包括library/extract.ts与insert.ts、`src/core/course/courseObjectEdits.ts`复制/跨工程粘贴、`src/core/projectFiles/componentPlatform/projection.ts`文件视图资源、`src/core/drivers/courseV10Operations.ts`替换锁/引用删除和Sandbox换图解析。新作者记录/绑定归属与现资产写入在一次canonical transaction完成，不建第二资源索引。保留token，只变正式assetId。

`tests/unit/l0LibraryClosure.test.tsx`现有“Source override忽略Web binding”断言与真实消费者冲突，需按本包已批准行为改正并由独审核等效保留；不能为绿灯直接删掉该反例。

最低证明：图片仅由该绑定引用且目标工程没有旧assetId，保存到API5库→插入新工程→读实际assetId/字节→运行显示→保存冷开/受影响输出。精确作用域反例保无关业务字符串、邻实例及兄弟状态。原工程旧资产仍在不能证明跨工程通过。

