# 原生 Python、打包减重与参考分发（2026-10-30）

主程序计算已从 Pyodide 切换原生 Python。已有环境优先，保留 user-site；缺少 NumPy/pandas/Matplotlib 时直接补装到所选环境，以已有版本约束安装，真实冲突明确失败，不默认创建 venv、不升级或降级已有库。没有解释器时，按需下载 uv 并由其准备原生 CPython；文件均留在应用用户数据目录，使用系统代理，不写系统 PATH 或用户全局 Python shim。当前自动下载支持 Windows x64/ARM64，实际下载验收为 x64。

原生进程以当前用户身份运行，不再宣称浏览器沙箱。供应商凭据不继承；输入仍由既有 owner 冻结，真实输入/输出位置由环境变量与作业回执提供。取消覆盖等待环境准备、下载/安装及计算进程树；保存、未知恢复和不重放继续由 ComputeJobService/ArtifactDelivery 负责。中文绘图复用系统字体。

旧 Pyodide 执行端、renderer/preload 入口与针对其浏览器策略的旧消费者退出；旧 vendor 文件保留在仓库但不进入两个 Vite 输出或发行包。原生分析/中文 PNG、非零退出不交付、进程树停止、冷恢复不重放与正式 ArtifactDelivery 已通过实际进程验证。安装器可执行文件仅按官方发布校验其下载身份，不将 Hash 当作功能正确性证据。

## 安装包与参考

仅供前端构建使用的依赖移到 devDependencies，去除 npm 原始前端包的第二份载荷；发行排除所有 source map，不再打包已经嵌入 renderer 的 dist-player。应用主进程仍使用的 esbuild、Office、PDF、图像和浏览器工具依赖保持。

参考包保留实际相对路径，包含入口、方法/记录、连续背景源码及 `.h5component`、咖啡正式 GLX/HTML；内置 Skill 返回实际安装根目录，沿现有 file/asset 工具消费。随附根只读，`file.open` 与修改使用同一 mayWrite，避免 full 权限误授原件写权；修改需先复制到工作区。开发历史证据路径仅作来源说明，不随包堆入历史目录。

最近目录包由 1,081,762,397 字节降为 544,210,185 字节，约减少 49.7%；其中随附参考 6,649,696 字节。该数字来自本轮首个目录消费者；后续仅同域细修/最终便携包数字见输出回执，不把目录体积等额换算成压缩 EXE 体积。

最终目录包为 544,428,872 字节，便携 EXE 为 123,240,827 字节（117.53 MiB），旧便携 EXE 为 229,921,580 字节，约减少 46.4%。最终便携 EXE 真实解包启动后，经独立 profile 的正式 MCP 完成参考读取、组件导入、案例打开、复用本机原生 Python、计算/中文图与 artifact.save；已直接查看保存的中文图。最终扫描没有 source map、第二份 dist-player、Pyodide 资源或 Phaser/Mermaid/GrapesJS 的原始 npm 包。

## 已有证据与边界

- `output/native-python-packaging-20261030/packaged-smoke/facts.json`：真正打包 EXE、独立 profile/workspace，经正式 MCP 完成 skills.read → file.read → asset.import/search → file.open → compute.run/job.wait，原生结果 JSON/中文 PNG ready。未调用模型或复制用户模型账号。
- `output/native-python-packaging-20261030/packaged-smoke-final/facts.json` 与 `package-facts.json`：最终便携包的同一消费链与真实 artifact.save written，及包体明细。真实原生进程测试通过 `GUOLING_TEST_PYTHON` 显式选定验证环境，普通测试不触发用户环境安装。
- 同目录 `provision.cjs`/`python.json` 与原始终端回执：候选为空时，通过真实 Electron net.fetch 下载 uv、CPython 3.13.18及13项计算依赖，完成准备；使用系统代理。uv 自己管理的下载解释器需要允许补装其拥有的环境，用户的其他受管理环境不隐式突破其安装限制。
- 定向单测覆盖复用、保留已有版本、安装包排除、排队/正在准备时取消、下载可执行身份损坏、只读参考，以及原作业恢复。真正原生进程覆盖数值、中文图、退出码、进程树停止、正式交付与 ready 冷恢复。
- 主程序与 E2E 类型检查、player/renderer/main 构建通过。额外审计文件中的 CA-214 抽取测试因缺 `freezeComputeInputs` 定义失败；本轮相关 CA-081 单独通过，不宣称全仓测试全绿。
- 依照 DEVELOPMENT 进行了未参与实施者的集中只读复审，修正 user-site、参考打开写权与取消收尾三个实际问题。未提交、推送或对外发行。
