# 资源持久化修复结果

## 已确认根因与边界

`createCourseProjectV10Archive` 原先逐 `project.assets[id].path` 及 `components/<owner>/<local-path>` 写入完整 ZIP 条目。逻辑 ID 和源码相对路径被同时当成物理存储地址；不同导入、组件提炼或源文件引用形成不同 ID 时，相同字节会重复保存。此事实不归因于 v08 路线或美术设计。

现有 `DocumentResources`、CourseV10Driver、DocumentSession 仍持有原逻辑资产和组件文件字典，没有第二资源系统，没有改变持久编辑事务、History 或资源引用身份。

## 软件实施

- `src/shared/resourceContent.ts`：共享 SHA-256 内容身份及一次保存/导出的内容索引；同步版本用于既有归档 worker，异步版本优先 `crypto.subtle.digest`，缺少该实现时复用相同 noble 算法。没有跨时间 WeakMap hash 缓存或新增环境准入门。
- `src/core/drivers/codecs/courseProjectV10Archive.ts`：`project.json` 不变；`resource-index.json` 保存所有旧逻辑路径到摘要的映射，`resources/sha256/<digest>` 每实体只存一次。原路径归档仍可读取；新 reader 在进入原资产/组件消费者前恢复相同字典。摘要与实际实体相符属于内容寻址本身的完整性合同，缺失、被修改、未归属实体有明确诊断。
- `src/core/components/library/archive.ts`：复用本来已有的资源 logical→physical 路径 manifest，仅将物理条目按相同内容索引归并，不增加库包 wire 或兼容层。组件内部模块、CSS/HTML 资源相对路径与源码不变。
- reader 对每个公开逻辑 entry 保留独立可变缓冲，防止调用者原地修改某素材污染同内容的相邻素材；正式 Session 仍使用原有 replacement/COW。Main 归档 worker 输出传输 Set、GLX driver 入口可直接消费。只读取 `project.json` 的 Main 身份探针不受影响。

## 真实 v08 资源对照

正式原件只读：`docs/creative-production/works/coffee-journey/design/v08/native/coffee-journey-v08.glx`。

| 项目 | 原件 | 本轮另存副本 |
| --- | ---: | ---: |
| GLX 文件 bytes | 17,502,438 | 8,434,293 |
| 相对文件减少 | — | 9,068,145 bytes / 51.8108% |
| 资源逻辑条目 | 114 | 114 |
| ZIP 实体资源条目 | 114 | 64 |
| 唯一资源原始 bytes | 8,473,630 | 8,473,630 |
| 重复实体原始 bytes | 9,116,052 | 0 |

副本：`output/resource-runtime-repair-20261024/resource/coffee-journey-v08-cas-copy.glx`。保留 80 个资产 ID、12 个组件源码 owner、34 个组件文件；所有项目字段 deepEqual、每逻辑资源完整字节 deepEqual，通过。原件前后 SHA-256 保持 `989c8d2e65fb4370ae463f9f5a4ae299f743bb8c0aa71341ccc58b29a1db8e98`。此次没有重编码、降低分辨率或丢弃美术素材。

## 检查与证据等级

- `resourceContentArchive20261024.test.ts` 6 项：共享 identity、真实物理去重、元信息/相对路径保留、旧归档读取、索引同名素材、缺失/修改/未归属诊断、库包归并、逻辑缓冲隔离、canonical replacement、Undo/Redo 和序列化重开；全部通过。
- `documentArchiveWorker20261022.test.ts`、`auditAllSaveResources.test.ts`、`glxWorkSession20261020.test.ts` 与最初 5 项新测试，第一批 4 文件 19 项通过；实际 worker、own-key/case-distinct 路径、Project 11 保存/冷读沿原 owner 通过。
- 新增库包用例后，`auditResourceClosure20261014.test.ts`、`l0LibraryClosure.test.tsx` 及新测试，第二批 3 文件 17 项通过；覆盖实际提炼、闭包、插入、重映射路径。异步 hash 实现新增后，只重跑新测试 6 项，仍通过。上述批次有重叠，不合计为唯一测试数量。
- `archive-results.json` / `measure-archive.ts`：真实原件只读载入、另存及重读对照。单进程一次 Node codec 观察 open 301.5ms、save 349.4ms、reopen 198.1ms；依赖已加载，不能据此宣称 GUI 首帧或冷开收益。
- `cold-open-results.json` / `cold-open-archive.ts`：另一个新 Node 进程 pid 35120，读取 CAS 副本与 codec open 233.5ms，随后与原件全部逻辑内容 deepEqual。该项不是操作系统文件缓存冷态，也不是 GUI 交互验收。

资源归档子任务未运行 GUI/build、未修改 v08 正式工程/素材/路线代码、未 commit/push。发布物资源选择/HTML 内嵌去重、图片衍生和 Player 性能由主任务对应软件模块另行实施与验收；本结果不替代这些证据。
