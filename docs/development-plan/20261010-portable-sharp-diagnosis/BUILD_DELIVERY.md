# 2026-10-10 Windows 构建与 Git 交付

Owner 在 W1—W4 与 Portable 已知问题修复后追加授权：“构建exe，然后git commit并push远端”。本次构建包含对应代码、当前 AI 能力/内置源码生成物和资源，不仅是修复前基线。Git 基线为 `df21debdde2a86e7108a1af41b7aa4df62746b67`；代码和本文一并提交，实际提交身份及远端 main 同步结果以 Git 和制品目录的 `evidence/GIT_DELIVERY.json` 为准。

## 制品

新目录：`release/glx-20261010/`。保全旧交付件，不覆盖历史报告。版本沿用 `0.0.1`，目标 Windows x64，未签名。

| 制品 | 字节数 | SHA256 |
| --- | ---: | --- |
| `guoling-workbench-portable-0.0.1.exe` | 215812274 | `3BC7D687E2CE2C2E743681F6483C2A8A17986E65440400F57047DD5A8609C0C0` |
| `guoling-workbench-win-unpacked-0.0.1-x64.zip` | 362446957 | `FEDD45487BFB8F1ED916B888014ADBFE863E143D50C4CAF35E25D08F8CB98365` |
| `win-unpacked/guoling-workbench.exe` | 225819136 | `ED2B39E99C3854BD69FF0FE03017DB37FEC029A04D6E690810442127052B3CB2` |

目录版 ZIP 包含整个 `win-unpacked`，使用时完整解压；单独复制其 EXE 不能代替目录版。制品与临时工具按既有规则不进入 Git；上述源码、方案与结果进入仓库。不创建 GitHub Release 或替换既有交付 EXE。

## 构建事实

- 云环境 Linux，Windows 开发机 `magicbook0923` 离线；未访问原故障电脑。Electron `43.1.1`、electron-builder `26.15.3`、sharp `0.35.3`、lockfile 和分发方式均保留。
- 在独立 `/workspace/guoling-windows-build-20261010` 中复制当前 package/lock/config，执行 `npm ci --omit=dev --ignore-scripts --os=win32 --cpu=x64`，缓存仅放该目录。Windows sharp、esbuild、canvas 可选依赖实际已安装。未重装源码工作树依赖、改写 lockfile 或禁用 TLS。
- 两个现有 Windows C# helper 使用隔离下载/解包的官方 Debian Mono 编译器编译。源码摘要与仓库一致，结果为 CLR v4 ILOnly/AnyCPU，只引用原有 Microsoft 标准程序集；编译参数、47 个工具包校验及二进制摘要保留在 `evidence/helper-build-evidence.json`。未安装系统工具；未把 Mono 运行时打入产品；Windows helper 的系统调用未实测。
- Player、Renderer、Main 本轮重新构建成功。字体资源检查、能力生成检查和 import-boundaries 检查通过；依赖方向检查为 1429 文件 / 7953 边 / 0 违规。此前定向测试、三套类型及独立复审复用，详见 [W1—W4 结果](../20261010-workbench-consolidated/IMPLEMENTATION_RESULT.md)和 [Portable 修复结果](REPAIR_RESULT.md)，未跑全量测试工作流或收费创作。
- 构建前现有内置组件可复现检查发现归档字节不一致，按原脚本重新生成四个 `.h5component` 和 catalog 摘要。四包全部成员名及未压缩内容与 Git 基线完全一致；没有改组件源码/行为或历史 attestation。检查和实际 ASAR 内 catalog/包摘要均通过。
- 当前 builder 的 Portable 目标在 Linux 原生完成 PE 资源和 NSIS 打包，无 Wine；命令成功退出。Portable 的外层 NSIS launcher 是 x86，内含 x64 应用，这是该分发器的正常结构；不能用外层 PE 的架构误判应用架构。

实际打包命令（源码先构建，再复制产物/资源及 helper 到隔离目录）：

```bash
ELECTRON_BUILDER_CACHE=/workspace/guoling-windows-build-20261010/cache/electron-builder \
npm_config_cache=/workspace/guoling-windows-build-20261010/cache/npm \
node /workspace/ittoedu/node_modules/electron-builder/cli.js \
  --projectDir /workspace/guoling-windows-build-20261010 \
  --win portable dir --x64 \
  --config /workspace/guoling-windows-build-20261010/electron-builder.yml \
  -c.directories.output=/workspace/ittoedu/release/glx-20261010 \
  -c.electronDownload.cache=/workspace/guoling-windows-build-20261010/cache/electron
```

## 实际制品检查及边界

| 检查 | 结果 |
| --- | --- |
| Portable 与目录版同批身份 | 用 builder 的 7zip 解开 Portable 内真实 `app-64.7z`，与目录版全部 163 个文件按路径/大小/SHA256 比较，一致；总大小 1031457473 字节，目录摘要 `9DE056F11BE61B636BB14DF54F044C160234568EB97D5C30DAF1790006C779EC`。 |
| sharp 实际负载 | 核对实际 ASAR 内 sharp JS 入口、平台包版本，以及 `.node` 和两项 libvips DLL 的 unpacked 标记、实体及摘要。原生文件齐全；静态完整性不能证明故障机 DLL 能加载。 |
| 其他 Windows 原生依赖 | 实际 sharp/canvas `.node` 和物理 esbuild EXE 均为 Windows x64。两 helper 实体与编译证据摘要一致。 |
| 编译结果 | ASAR 内四个图片入口、共用 imageDecoder、Renderer 入口与 Player 脚本逐字节等于当前构建输出；四个内置包摘要与实际 catalog 一致。 |
| 品牌/解包/签名 | 主应用与 Portable 的产品名/版本及图标资源存在，证书表为空。配置 `portable.unpackDirName: true`，当前 NSIS 模板采用 `$PLUGINSDIR/app`；未做 Windows 并行启动实验。 |
| 通用扫描 | 实际 ASAR 大于原整文件 reader 的 512 MiB 限制。临时检查逐条读取实际 23584 个 ASAR 项及额外资源，使用原导出规则扫描 660923759 字节；38 条命中 / 0 读取失败，原 `artifact-inspection.json` 的 failed 不改写，原限制不放宽。未称原全量 verify-release 通过。 |
| 命中独立复核 | 25 个直接 ASAR 文件、10 个档案容器均与隔离清洁 stage 一致。38 条为产品静态串 2、上游编译路径 1、上游目录元数据/注释 7、JS 文档/字段/fixture 18、Python 档案源文件 10；未发现本机/故障用户数据、真实凭据或私钥。Pillow 的 AWS 形态是默认字体 Base64 随机片段，解码后为 TrueType。上游路径是真实字符串，不能称零命中。 |
| Windows 运行 | **0/10**：两种制品的 Windows 冷启动、Main 中真实 PNG 解码、重叠启动、原故障机和安全日志均未执行。未宣布原间歇故障已根治或 Owner accepted。 |

证据在新制品目录的 `evidence/`：`BUILD_INPUT.json`、`helper-build-evidence.json`、`builtin-package-rebuild.json`、`artifact-inspection.json`、`artifact-findings-classification.json`、`artifact-findings-review.json`、`portable-archive-list.txt`、`portable-resource-metadata.json`、`payload-equivalence.json`；完整文件摘要见 `SHA256SUMS.txt`。

具备 Windows 环境后，可直接对这两个同批制品执行 [既有专项入口](REPAIR_RESULT.md#2-最小制品验证入口)，各 5 次冷启动及真实 PNG 解码，输出到全新的证据目录；原故障机保持正常防护补验。无需为了启动该检查重新构建，不将云端静态检查计入这 10 轮。
