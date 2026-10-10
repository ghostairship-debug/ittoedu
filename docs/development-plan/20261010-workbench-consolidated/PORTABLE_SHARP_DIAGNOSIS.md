# Portable 单文件版 sharp 启动异常诊断

日期：2026-10-10。范围：只读诊断，另新增本报告；未修复、安装依赖、构建、运行全量测试、推送或替换 EXE。

**结论：已确认图片原生依赖的加载失败会在窗口建立前阻断整个主进程；尚未确认故障电脑上原生加载失败的底层原因。** 当前配置并没有显见的 sharp Win64 DLL 解包遗漏。Portable 默认共用同一构建的临时解包目录，是有源码依据的干扰机制，但不能据此宣布本次故障是竞态。现有验收缺少 Portable 自身的真实图片解码及连续冷启动。

## 1. 已确认事实与证据边界

### 当前源码和打包

- 云工作树 HEAD：`df21debdde2a86e7108a1af41b7aa4df62746b67`。诊断开始时 `git status --short` 为空；这不能代表离线 Windows 开发机上的未提交成果。
- [package.json](../../../package.json) 的版本为 Electron `43.1.1`、electron-builder `26.15.3`、sharp `0.35.3`。本机安装包版本与这些声明一致。
- [electron-builder.yml](../../../electron-builder.yml) 第 3–7、29–44 行：`asar: true`；解包 `**/*.node` 与 `**/node_modules/@img/sharp-win32-x64/lib/*.dll`；目标保留 Portable + dir、x64；`npmRebuild: false`；未设置 `portable.unpackDirName`。
- [build-electron.mjs](../../../scripts/build-electron.mjs) 调用 TypeScript 编译器；[tsconfig.electron.json](../../../tsconfig.electron.json) 使用 NodeNext；根 package 没有 `type: module`。现存编译文件也可见顶层 `require("sharp")`。编译目录不是交付 EXE 的替代证据。

从 Main 静态导入链核对，至少下列四个入口会在启动期加载 sharp；调用相应功能之前就可能抛错：

| sharp 入口 | 已核对的启动链（省略共同的 `src/main/`） |
| --- | --- |
| [admittedImageResource.ts](../../../src/main/workbench/admittedImageResource.ts):1 | `index → ipc → attachments/attachmentsDesktopService → AttachmentService → admittedImageResource`；另有 `index → workbenchToolServices → MaterialReadTools` |
| [ModelCapabilityProbe.ts](../../../src/main/workbench/providers/ModelCapabilityProbe.ts):2 | `index → ipc → providers/executionSettingsService → ModelCapabilityProbe` |
| [imageFileEditing.ts](../../../src/main/workbench/mediaFiles/imageFileEditing.ts):1 | `index → ipc → mediaFilesDesktopService → MediaFilesService → imageFileEditing` |
| [OpenImageService.ts](../../../src/main/workbench/assetSources/OpenImageService.ts):1 | `index → ipc → assetSources/pixabayDesktopService → OpenImageService` |

另外两个静态 sharp 导入位于 `prepareHtmlCourseCandidate.ts`、`DynamicContentFallbackCaptureService.ts`；当前 Main 静态导入图未发现它们可达，不把它们自动纳入启动修复范围。不能只改提示词指定的 admittedImageResource 后就认为启动已隔离。

[index.ts](../../../src/main/index.ts):151 才申请应用单实例锁，226 才在 `whenReady()` 后安装诊断处理器。因此，静态导入抛错早于这两步；单实例锁保护不了 NSIS 已执行的解包操作，现有应用日志也可能根本来不及记录该错误。仅将同一文件内的 handler 调到 `whenReady()` 之前，仍不能捕获更早的静态导入失败。

### 原生依赖基线，非交付制品核验

只读下载锁文件指定的 `@img/sharp-win32-x64@0.35.3` 官方 npm tarball，SHA-512 与 `package-lock.json` 的 integrity 完全一致。未安装到仓库。实际内容为：

| `lib/` 内文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `sharp-win32-x64-0.35.3.node` | 442368 | `45dbb968dff27a1e8d8870d2a34e6f5418fa2a1a4fe27a7ed13ab2fb3f895468` |
| `libvips-42.dll` | 18406400 | `6d8ec83a826a1b46ef25a670501fd186475568dd3e48893cb4f756d0f2f428d8` |
| `libvips-cpp-8.18.3.dll` | 333312 | `d6eb3395e6f7799c9e2c997aba38068f1ab0684dc08a853013dbe528649306b9` |

包导出 `./sharp.node → index.cjs → ./lib/sharp-win32-x64-0.35.3.node`。三个文件均为 PE x64；`.node` 直接依赖这两个 DLL，cpp DLL 依赖 `libvips-42.dll`。其他直接导入为 Windows 系统/UCRT 库，没有发现 `VCRUNTIME/MSVCP` 直接依赖。因此当前没有依据先安装 VC++ Redistributable 或改变 DLL 搜索路径；仍需故障机的实际加载结果判断系统依赖问题。

sharp 的本机加载器 `node_modules/sharp/dist/sharp.cjs` 会按 `win32-x64` 选择平台包；不同加载失败最终汇总成用户看到的同一个首行。非 `MODULE_NOT_FOUND` 错误通常会出现在后续正文，但 `MODULE_NOT_FOUND` 的具体路径会被省略，最终 Error 也没有保留全部尝试的 cause。**只有这个首行无法区分包缺失、解析错误和 DLL 加载失败。**

sharp 源码定义 `NAPI_VERSION=9`。使用匹配平台的预构建 Node-API 包时，`npmRebuild: false` 本身不是错误，也不能套用传统 Electron ABI 不同即必须重编译的判断；实际 EXE 的 Node/Node-API 版本和原生文件仍未测得。云工作区仅安装 Linux 平台可选包，不能拿它缺少 Win64 可选包的现象判定 Windows 交付包缺文件。

### Portable 的真实模板顺序

已检查本机 electron-builder `26.15.3` 的 `app-builder-lib`：

- `out/targets/nsis/NsisTarget.js:243–248` 在**构建时**生成默认 `UNPACK_DIR_NAME`。`nsisOptions.d.ts:232–241` 明确默认是每个构建的目录名；显式 `unpackDirName: false` 才使用每次启动独有的 `$PLUGINSDIR`。
- `templates/nsis/portable.nsi:33–38` 使用 `$TEMP\${UNPACK_DIR_NAME}` 并先 `RMDir /r`；随后复制/解压资源，86 行才 `ExecWait` 启动应用；应用退出后 90 行再次删除该目录。同一 EXE 的重叠启动可共用目录，一次启动/退出可能碰到另一次运行的资源。复制到不同路径并不自动改变这个构建内目录名。
- `include/extractAppPackage.nsh` 使用 7z 解压后复制，有复制失败重试及最终覆盖解压分支；最终分支注释明确不保证原子性且忽略错误。这给文件占用/写入异常提供了排查方向，但没有证明实际故障经过该分支。

没有发现默认“先启动 Electron、再异步解包”的代码顺序。看起来随机的 Temp 目录名也不等于每次启动必定换目录。以上为当前依赖模板；尚未核实交付 EXE 是否确实由这些模板和配置生成。

### 实际交付与历史记录

[历史交付记录](../20261008-core-experience-unified/REVIEW_RESULT.md#brand-release-cleanup-20261009) 称 `release/glx-20261009/guoling-workbench-portable-0.0.1.exe` 为 283565767 字节、NotSigned，另有同批 win-unpacked，并记录 GUI/工程保存/MCP 检查通过。这是历史文档陈述，本轮未读取对应 EXE 或原始报告。

当前云仓库没有 `release/`、`output/release-glx-20261009/`；未发现其他可用 EXE/ASAR。Windows 连接设备 magicbook0923 离线，用户说明它是正常开发机，暂不方便连接；故障电脑没有接入。实际解包文件、版本/签名/哈希、两种制品是否同次构建、Windows 未提交改动及安全日志均不能在本轮证实。

## 2. 根因判断

**确定的是失败放大机制：启动期 sharp 加载失败导致整个工作台不可启动。造成原生加载失败的原因仍待证。** 下表按直接机制证据强弱排列，不代表已测出的发生概率。

| 待验证原因 | 现有支持及为何可能间歇失败 | 缺少的关键证据 |
| --- | --- | --- |
| 同构建共用 Temp 目录，重叠启动/上一启动退出引发删除或占用 | 当前模板可直接证明共享和删除。若第二次启动时上一 launcher/Main 尚在运行，资源操作可能互相干扰；相关进程完全退出后再启动可能成功 | 失败时 launcher/Main 的 PID 和时间线、真实 Temp 路径、文件变动/占用结果；不能假定用户曾重叠启动 |
| 故障机安全软件或临时目录 I/O/权限影响原生文件释放、访问或 DLL 加载 | 跨机器与间歇现象相符；每次启动需要释放可执行原生文件。重新尝试时文件占用或扫描状态可能变化 | Defender/电脑管家的匹配事件、Loader 错误码，必要时文件访问跟踪；无证据不能归因杀软 |
| 实际 EXE 缺少/损坏包、JS 导出或 DLL，或依赖解析到开发机外部位置 | 源码配置正确不能证明制品正确；现有检查没有验证 Portable 解包后的真实闭包 | 两种同批制品实际清单、ASAR unpacked 标记、三件原生文件及 JS 的路径/字节比对、运行时解析位置。固定遗漏通常会稳定失败，不能单独解释同 EXE 后来成功 |
| 系统/UCRT、CPU 架构、Node-API/运行参数等固定不兼容 | 原生模块确有系统依赖；故障机信息未知 | Windows 版本、目标进程架构、实际 Node/Node-API 和完整 Loader 错误。同机不改变环境而成功启动削弱固定不兼容的解释 |

用户尚未提供完整 sharp 错误正文。不得把表中任一待验证项写成“已查明根因”，也不得凭开发机一次成功排除故障。

## 3. 已完成验证与验收缺口

本轮已执行：工作树状态/版本核对；启动导入链与错误处理源码检查；NSIS 实际依赖模板检查；现有验收脚本逐段检查；锁文件对应 Win64 官方包的下载、完整性校验、文件/PE 导入表检查；发行制品及历史证据可用性检查。

本轮**未执行**：交付 EXE 解包和 ASAR 实物核验、Portable/目录版启动或真实图片解码、各 5 次冷启动、跨机器复现、Defender/第三方安全日志或 DLL 访问跟踪。没有把 Linux 检查计作 Windows 运行通过，也未运行会重建、删除原验证目录或覆盖历史报告的发行脚本。

| 现有入口 | 实际覆盖 | 本故障相关缺口 |
| --- | --- | --- |
| [verify-release.ts](../../../scripts/verify-release.ts):374–446 | 检查**目录版** ASAR 内包元数据、原生文件 unpacked 标记和实体存在；要求至少一个 `.node`、两个 DLL | 没有核对 Portable 解包闭包；数量/存在检查不等于正确内容；未独立检查 sharp/platform 包的 JS 导出文件 |
| 同文件 :619–699 | 一次 Portable 窗口、preload 与编辑器启动 | 启动通过不等于真正执行图片解码；没有重复冷启动或重叠启动 |
| 同文件 :701–733 | 在**目录版 Main** 调用 `prepareImageResource`，完整解码 PNG | Portable 没有同等操作；不能用目录版替 Portable 签收 |
| [verify-w3-windows-portability.ts](../../../scripts/verify-w3-windows-portability.ts):301、504、1082–1086 | 同机复制目录版并逐字节比较；复制 Portable 并核对 EXE SHA-256；分别启动，隔离 cwd/profile | Portable 仍是一次启动；未显式执行 sharp 解码；本机隔离不能模拟另一台电脑的系统/安全软件。脚本已明确声明该边界 |
| 发行脚本与历史记录 | `dist:win` 构建 portable + dir；历史记录有指定制品及 GUI/MCP 成功 | 两个验证脚本固定指向 `release/` 默认路径，不能直接假定验的是 `release/glx-20261009/` 交付件；同版本号不证明同次构建或相同负载 |
| 启动诊断 | Main 就绪后才安装现有处理器 | 静态加载失败记录缺口；sharp 首行缺少分类。后续若延迟加载，还要避免被现有图片错误转换掩盖 |

## 4. 最小修复方案与建议修改范围

**现在不能承诺某个打包修改足以根治。先冻结旧制品留证，再根据实际错误选择修复；无需重装依赖、升级 Electron 或重构分发方式。** 本轮仅提出以下可审阅范围，全部待用户确认。

1. **可先做的局部启动隔离：四个已确认启动入口改为在图片功能首次使用时加载 sharp。** 复用当前 CommonJS 运行方式，使用一个薄的同步按需加载函数和类型导入即可；成功缓存由 Node 自身提供，并发异步调用无需另建状态机。加载失败要传播到本次操作，不缓存永久失败、不做后台无限重试。后续手动再次调用可重新尝试，但不能保证 DLL 环境已经恢复。
   - 这项只防止图片模块异常拖垮非图片功能，**不是间歇故障根治证明**。不能让图片功能悄悄消失或自动返回占位结果。
   - 为模块不可用保留独立、可理解的错误。`AttachmentService.ts:179–180` 当前统一转成坏图片，351–352 会记 gap 并跳过；延迟加载后需局部区分模块加载失败与图片确实损坏。其他入口沿现有 IPC/服务错误通道传播，不能把本地图片生成失败记为模型视觉能力不支持。
   - 首次正常调用继续完整解码/现有图片编辑；失败不提交图片、改写原件或损坏现有工程。只接入现有诊断体系记录组件类别和能取得的加载错误，不另建加载框架/日志平台。当前 sharp 包若已丢失内部 cause，不能声称外层包装可凭空恢复它。
2. **必要的验收修补：复用已有检查，补 Portable Main 的真实 PNG 解码和各 5 次冷启动记录。** 为专项入口明确传入交付目录，避免命中另一个默认包；增加 Portable 解包负载与同批目录版的 ASAR/三件原生文件比对。单独追加本次证据，不覆盖原发行记录；不运行全部 `verify:release` 或 W3 工作流来代替这些检查。
3. **条件性的根因修复：** 若证实重叠启动/清理干扰，优先只加 `portable.unpackDirName: false`，使用 builder 原生支持的每次启动独有目录，继续交付单 EXE；同时验证第二次启动转交正常且不影响先前实例。若是实物漏包/解析路径错，只修对应依赖或 unpack 规则；若是安全软件拦截，先确认具体文件/事件，再评估可信分发或签名，签名也不能保证消除拦截。系统依赖问题只在具体 Loader 证据支持时处理。

不建议无证据添加启动 sleep、盲目自动重试、固定外部解包缓存、复制 DLL 到系统目录或全局 `PATH`，也不建议修改 electron-builder 模板来建设新的启动系统。

## 5. 最小验收标准

- 固定并记录旧交付 EXE 和同批目录版身份；核对 sharp JS/平台导出链、ASAR unpacked 标记、实体路径、三件原生文件和包版本。Portable 实际释放负载与同批目录版对应负载匹配，不能只比较 `0.0.1` 版本号。
- 在原故障 Windows x64 电脑保持正常安全防护，Portable 和目录版各至少 5 次**独立冷启动并真实解码同一个 PNG**，记录次数、时间、EXE/Main PID、实际 exe/Temp/native 路径、解码尺寸、退出结果及全部失败。每次确认上一 Main 和 launcher 完全退出；这不要求清空 Temp 或删除用户数据。5 次是最低回归样本，不构成“绝不偶发”的统计保证。
- 若做延迟加载：另做一次受控加载失败验证，工作台及非图片功能仍能启动，首次图片操作明确报告模块不可用且无错误写入；正常首次调用与并发调用仍成功。测试隔离故障，不破坏原交付件，也不往产品增加隐藏的故障开关。
- 若改每次启动独有解包目录：补一次先前实例仍运行时的再次启动/正常退出检查，确认不会删除先前实例的资源。
- 以后同类发版复用本次明确的制品路径、Portable 解码及冷启动检查。无需新增大型测试框架、机械全矩阵或重复已有不相关检查。

## 6. 需要用户配合的事项

当前无法接入故障电脑或读取原发行件；方便时仅做以下两项高价值诊断：

1. **保留一次失败的完整证据。** 记录失败时间、复制弹窗内完整 sharp 错误正文（尤其 `ERR_DLOPEN_FAILED` 后的说明）、真实 Temp 路径，并查看同一时段 Defender「保护历史记录」/电脑管家拦截记录，确认是否具体指向该目录下的 `.node` 或 DLL。退出/重试前保留能获得的进程与文件状态；如果弹窗仍只有通用首行，再据此决定是否需要一次针对这三件文件的 Loader/文件访问跟踪。不关闭防护、不恢复隔离文件来强行测试，也不清空 Temp。
2. **在故障机对比同批两种制品。** 提供/开放原交付 EXE 及原同批 win-unpacked 的路径，在独立测试 profile 中依次启动，各 5 次并实际导入同一个 PNG；记录成功/失败，不把自动连接现存实例计为冷启动。目录版若缺失，先找原同批制品，暂不拿新构建替代它。能连接诊断工具后，上述清单、负载比对和进程取证可由诊断方完成。

开发机重新上线只能补交付实物证据，不能替代故障机复现。本报告不是修复完成或发行签收记录。
