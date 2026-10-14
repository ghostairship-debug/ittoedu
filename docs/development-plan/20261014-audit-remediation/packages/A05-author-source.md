# A05 短作者入口、共享依赖与私有定制

结果：普通小定制默认读写相关业务入口，成熟实现作为可保存重开的工程共享Source依赖；保完整源码深改与实例隔离。

依据F05/T03，现85.3万字符成熟闭包默认暴露不适合作作者材料。Owner：Root source准备，用A02/A03/A04共同语义；不并行造新的能力模型。

主要路径：`src/core/projectFiles/componentPlatform/projection.ts`、`src/renderer/components/ComponentSourceEditor.tsx`、componentCompilationInput.ts、esbuildComponentCompiler.ts、`src/core/components/source/sourceAuthoringEdits.ts`、`src/core/components/compilation/liveSourceReferences.ts`、library/rebindSource.ts、CourseV10RuntimeView、buildPublishedCourseV3、compileCoursePlayback。

默认builtin继续canonical data+builtin，读取不落盘。第一次普通定制由同一准备owner生成短JS/TS root＋现workspace/moduleBindings共享Source依赖快照及必要files/资源；UI和AI投影共同消费。resolver只支持真实Source依赖，不假装可直接import builtin，不增guoling:*全局模块平台、logicScript、第二份可写展开闭包或有限hooks天花板。

成熟Web实际模块图、资源、HTML观察与Published准备随扩展接通，不能只wrapper mount。实例局部深改复制被修改依赖及通向它的必要引用，未改sibling保持共享；显式定义入口修改才共享。存坏源可修、CAS、Undo、身份和布局沿现owner。

最低证明：依赖输入/COW针对性检查；一个成熟Web＋业务行为、图片/module及邻实例的短入口局改→运行→普通编辑→Undo→保存冷开→实际输出，私有修改不串邻实例。若库依赖消费改变，A04例复用。短源码只是材料改善，不承诺共享运行堆、缓存命中或提速倍率。

