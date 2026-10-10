# Portable sharp 已知问题修复结果

后续记录：Owner 追加构建、提交及推送授权后，已生成含本修复的新 Portable 和目录版并核对实际负载，详见 [构建交付记录](BUILD_DELIVERY.md)。下文保留修复实施完成时的事实；其中未构建/未提交描述不代表追加授权后的最新状态，Windows 运行仍未执行。

日期：2026-10-10。基线：`df21debdde2a86e7108a1af41b7aa4df62746b67`，接续 W1—W4 的有效未提交成果。Owner 最新授权：“portable也尝试进行修复啊，已知问题先修了”。本次已实施局部代码和打包配置修复，原 [DIAGNOSIS](DIAGNOSIS.md) 保留为修复前记录；没有提交、推送、发布、生成 Windows EXE 或替换原交付件。

**已修复启动期 sharp 静态加载的放大机制，并消除当前 builder 默认共用解包目录的配置风险。原故障电脑上 DLL/模块间歇加载失败的底层原因仍未证实，不能据云测试宣布跨电脑故障已根治。**

## 1. 已实施修改

| 范围 | 最终行为 |
| --- | --- |
| 四个启动可达入口 | [图片准入](../../../src/main/workbench/admittedImageResource.ts)、[能力验证](../../../src/main/workbench/providers/ModelCapabilityProbe.ts)、[图片编辑](../../../src/main/workbench/mediaFiles/imageFileEditing.ts)、[开放图库](../../../src/main/workbench/assetSources/OpenImageService.ts) 均改为图片操作实际发生时加载 sharp，模块导入阶段不加载它。 |
| 按需加载 | 共用薄的 [imageDecoder](../../../src/main/workbench/imageDecoder.ts)，沿现有 CommonJS `require` 和 Node 模块缓存工作；加载失败抛出 `ImageDecoderUnavailableError`，保留 sharp 实际提供的原始 cause，不永久缓存失败，不自动重试。后续显式图片操作可重新尝试。 |
| 错误消费者 | 复用既有 `DesktopOperationError` 和 [附件错误映射](../../../src/main/workbench/attachments/attachmentOperationErrors.ts)。本机模块不可用会明确显示，不被改叫坏图片，也不在提取时静默跳过页图；真正损坏的图片仍沿原路径处理。图片处理失败不写入新附件快照、不改原件。 |
| 模型能力 | 本地视觉挑战生成失败先于 provider 请求，不记录“模型不支持视觉”；非图片的工具能力验证仍可用。 |
| 本地诊断 | 既有诊断记录可保留 `nativeModule: sharp`、错误类别、可取得的原生错误码和指纹。默认导出继续去除个人路径、正文和密钥；完整加载错误写入本地 stderr，专项制品验证会收集可取得的 stderr。sharp 自身已丢弃的信息不能由外层包装恢复。 |
| Portable 解包 | [electron-builder.yml](../../../electron-builder.yml) 增加 `portable.unpackDirName: true`，使用每次 launcher 的 `$PLUGINSDIR/app`，避免同构建共享目录的删除/占用干扰。Portable + dir/x64、ASAR、现有 `.node`/DLL 解包规则、版本和 `npmRebuild: false` 均沿用。 |

原诊断关于 `unpackDirName: false` 的建议有误，源于上游类型注释与实现不一致。当前安装的 electron-builder `26.15.3` 的 `NsisTarget.buildInstaller` 在 false/省略时生成 `UNPACK_DIR_NAME`；true 时不生成，`portable.nsi:33–36` 才使用 `$PLUGINSDIR/app`。本次通过真实 builder 调用确认了这一行为，没有修改依赖源码或 NSIS 模板。此项消除有依据的干扰机制，不证明原故障曾发生重叠启动。

## 2. 最小制品验证入口

[verify-release.ts](../../../scripts/verify-release.ts) 新增显式 `--portable-sharp` 分支，具体实现位于 [portableSharpVerification.ts](../../../scripts/portableSharpVerification.ts)。它不执行原全量发行流程，不覆盖旧报告、不重新构建，也不删除系统 Temp 或用户 profile。

在 Windows x64 上，从仓库运行；两种 EXE 应为同批负载，输出目录必须尚不存在：

```powershell
node --import tsx scripts/verify-release.ts --portable-sharp --portable 'C:\候选制品\guoling-workbench-portable-0.0.1.exe' --unpacked 'C:\候选制品\win-unpacked\guoling-workbench.exe' --output 'C:\专项证据\portable-sharp-20261010-new'
```

- 核对目录版实际 ASAR 的 sharp/平台包版本、JS 导出入口、原生文件 unpacked 标记及实体；取得运行中 Portable 的真实 Main 路径和解包负载，比较 ASAR 与原生文件字节证据，避免只凭相同版本号判断同批。
- 两种制品各做 5 次独立启动，每轮使用新的 cwd/profile/CDP 端口；通过正式 preload 附件 API 在该制品的 Main 中完整解码同一个 3×2 PNG，并检查尺寸、原字节摘要和 `sharp-verified-v1` 来源。
- 记录 launcher/Main 进程身份、时间、真实资源路径、退出及失败信息；确认本轮进程完全结束才进入下一轮。正常关闭失败仅清理本轮捕获的进程，强制结束、非零退出或终止信号均不能判为通过。测试 profile 和报告保留作证据。
- Linux 实际 CLI 检查返回失败、报告为 0/10；复用输出目录被拒绝。错误不会进入旧发行报告写入分支。

## 3. 已执行验证

| 检查 | 实际结果与限度 |
| --- | --- |
| [故障注入与恢复](../../../tests/integration/portableImageDecoderStartup.test.ts) | 2 项通过：子进程中注入 `MODULE_NOT_FOUND` / `ERR_DLOPEN_FAILED`，实际四入口 CJS bundle 导入不加载 sharp；文本/PDF 原件存取与非图片能力仍可用；图片失败分类、原 cause、无错误快照、诊断隐私、恢复后的 3 并发准入/旋转/归一化/提取均通过，恢复调用使用真实 sharp。不是 Electron 窗口或 Windows DLL 复现。 |
| [builder 配置生成](../../../tests/unit/portableUnpackDirectory.test.ts) | 1 项通过：读取真实 YAML，调用当前安装版本的 `buildInstaller`，在其支持的 `effectiveOptionComputed` hook 取得真实 defines；true 缺少 `UNPACK_DIR_NAME`，false/默认有值。只替代包归档，不下载、编译、签名或创建 EXE。 |
| [制品专项验证模块](../../../tests/unit/portableSharpVerification.test.ts) | 5 项通过：参数/新报告保护、真实 AttachmentService PNG 解码证据、实际生成的 ASAR 与 unpacked 原生文件核对、非 Windows 失败边界。ASAR 内原生文件是测试夹具，不冒称可执行 DLL。 |
| 受影响已有回归 | 6 套共 26 项通过：附件及失败恢复、统一媒体、模型能力本地 HTTP 验证、开放图库和诊断；无真实模型/收费调用。 |
| 类型与 Main 开发构建 | `npm run typecheck` 三套检查及 `node scripts/build-electron.mjs` 通过。Renderer/Player 未因本修复改变，复用 W1—W4 已完成的构建证据。 |
| 作者外复审 | Files 独立检查 Root 的产品代码、故障测试和 builder 测试；Root 独立检查 Files 的专项验证入口。已闭合本范围审查，未据此签收实机。 |

故障测试最初遇到云沙箱对子进程的限制；在允许测试所需进程/本地网络的执行环境中实跑。随后发现测试 extractor 的 `assets.bytes` 应为 `Uint8Array`，已修正夹具后通过，未为此改变产品规则或放宽断言。

本轮没有原交付 EXE/ASAR 或 Windows 在线环境。**Portable/目录版真实启动为 0/10；原故障机、杀软/Loader 日志、同批原制品负载和重叠启动均未实测。** 原 EXE 的行为不会因源码修改自动改变。

## 4. 剩余验收与需要配合

不再需要产品方案决策。具备 Windows 环境后，使用既有打包方式构建到新的候选目录，保全原交付 EXE/同批目录版和报告；用上述专项入口对新候选执行两种制品各 5 次启动/真实解码。还需一次原实例运行中再次启动并退出的检查，确认转交单实例正常且不影响原实例资源。以上不是云环境已经通过的项目。

原故障电脑上保持正常防护执行同样检查；若仍失败，保留报告和该时刻的完整错误/匹配安全日志，再按证据局部处理漏包、解析、DLL 加载或文件访问问题。需要用户配合的只有可用 Windows 候选构建环境、原同批制品和故障机证据；不要求关闭防护、清空 Temp 或删除用户数据。5 次是最低回归样本，不保证永不偶发，也不构成发布或替换授权。
