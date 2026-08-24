# ARCH-5 最终候选与结果复核报告

> 日期：2026-08-24（Asia/Shanghai）
>
> 最终产品/测试候选：`4560c8f`（含 `580f73f`）；候选声明：`966d499`
>
> 结论：`pass / engineering candidate`；不是 `art candidate`、`accepted` 或“发布就绪”声明

## 1. 结论

ARCH-0A 至 ARCH-5 已选工作的最终固定候选通过一次且仅一次完整 V4：能力新鲜度、三组配置的 TypeScript 检查、完整 Vitest、完整 Playwright E2E、Player/Renderer/Electron 构建以及三个代表 V9 工程流程均为 green。随后只对这些已构建字节执行一次 Windows x64 portable/unpacked 打包，并通过真实 packaged executable、production preload/IPC/protocol/security boundary 打开合法 V9 Mixed/Spatial 工程。

自动化与实物证据支持 `engineering candidate`，但不支持更高结论：Mixed Flow 画面仍是 placeholder；Mixed Spatial 有教师控制器遮挡和右下 Runtime 内容裁切；打包截图的初始画布为空，不能单独证明 Spatial 运行画面；ARCH-4 Mixed PDF 只能证明三种 Surface 的交付完整性，夹具内容本身存在叠印、稀疏和近空白页。Windows 二进制也没有 Authenticode 签名。因此本阶段不声明 `art candidate`、教师/产品 `accepted`、视觉验收通过或发布就绪。

## 2. 可审计候选链

| 候选 | 固定边界与结果 | 后续处理 |
|---|---|---|
| Candidate 1 | `7713d99` 声明；`npm run verify` 在首个能力检查即因 `generation-evidence.json` 的 ARCH-4 print source SHA 过期而停止，未进入类型、测试、构建或打包 | 失败由 `0350b4d` 保留；`b3558fa` 只刷新一个确定性 provenance SHA，能力内容未变，独立审查 APPROVE |
| Candidate 2 | `4ec5e5a` 声明；能力与三组配置的 TypeScript 检查通过，完整 Vitest 为 `248 passed / 2 failed` files、`1763 passed / 2 failed` tests（`211.19s`），未进入 E2E/打包 | `406c0b1` 保留失败；`580f73f` 精确断言失败导航 `B → A` 补偿顺序；`4560c8f` 修复缺失教师控制器创建后插入页签保持，最终独立审查 APPROVE；`fb595c5` 关闭修复 |
| Candidate 3 | `966d499` 声明；产品/测试候选 `4560c8f`；唯一完整 V4、打包与结果复核通过 | 本报告的最终候选；没有用 broad retry 获取 green |

Candidate 3 的 `pretest:e2e` 按合同确定性重建 tracked render benchmark，完整 E2E 最后一项针对这些精确字节通过。测试结束后没有再次生成；文件以 `bb7ff5f` 单文件提交，大小 `3,857,301` bytes，SHA256 `45AE90AFEBD0682B50614F63345CED9CF8E72C6989B026351B4BB55F57ED3037`。独立溯源审查确认 generator ownership、pretest-before-test 顺序和 tested-byte identity，结论为 APPROVE；因此没有为了“确认提交”重复生成或重复测试。

## 3. Candidate 3 的唯一完整 V4

执行一次：

```text
npm run verify
```

结果：exit code `0`。

| 门禁 | 结果 |
|---|---|
| AI capability freshness | pass；index `7,235 / 16,384` bytes；component catalog `available` |
| TypeScript | 默认/root（覆盖 Renderer、Player、shared）、Electron、E2E 三组配置全部 pass |
| 完整 Vitest | `250 files / 1,765 tests` 全部通过；`196.15s` |
| E2E pre-build | fresh Player、examples、lesson fixture、render benchmark fixture、component-catalog matrix fixture、Renderer、Electron 全部完成 |
| 完整 Playwright E2E | `30 / 30` 全部通过；`24.6m` |

完整 E2E 包含而未另行重复的代表行为包括：

- 普通图片替换的 Slide 全纵切；
- Flow-heavy 与 Mixed/Spatial 的副本保存重开、切换对应 location 和当前页试运行；
- component catalog matrix；
- render-host benchmark 的五条 render path、100 次切换、25 次 replay、capture readiness、无 host leak、无 page/console error、无外部请求；
- Electron media batch/continuous insertion 路径。

仓库仍存在以 V8 命名的历史 E2E 文件，它们只作为仍有 owner 的兼容/回归证据；当前作者工程结论来自上述合法 V9 代表流程，不恢复或宣称 V8 `.h5lesson` 编辑器导入支持。

## 4. Windows 打包与实物检查

在完整 V4 已产生 fresh build 后只执行一次：

```text
npx electron-builder --win portable dir --x64
```

结果：exit code `0`。

| 产物 | 大小 | SHA256 | 检查结果 |
|---|---:|---|---|
| `release/win-unpacked/ittoedu-courseware-editor.exe` | `225,819,136` bytes | `EBBF279E74FF04C363E15689D7EC256B7E490D18A67B074A7F4F222677E55B1B` | Product/FileDescription `ittoedu Courseware Editor`；FileVersion `1.0.0`；ProductVersion `1.0.0.0`；Company `ittoedu` |
| `release/ittoedu-courseware-editor-portable-1.0.0.exe` | `104,480,573` bytes | `EA2634AB726328BC5D46E493A2CC8927907291F8F1C4B442C7A2124B1091E69D` | PE `MZ`；Product `ittoedu Courseware Editor`；FileVersion/ProductVersion `1.0.0`；Company `ittoedu` |
| `release/win-unpacked/resources/app.asar` | `165,463,445` bytes | `0B6A2AB7EEFBC40D6CAA5F563BAF01EB4D7C1044615AE1323C62526618DF79D1` | 含 Electron main/preload、Player、Renderer 与 package metadata；main 为 `dist-electron/main/index.js` |

两份 EXE 的实际 Windows Authenticode 状态均为 `NotSigned`。electron-builder 输出中的 signing 步骤文字不等于证书签名证据；若对外分发，代码签名与发布决策仍是显式风险/Owner 决策，不能把本产物称为已签名发布包。

### Packaged V9 功能烟测

真实 `win-unpacked` executable 的成功功能烟测断言：

- `isPackaged === true`，`appPath` 指向 `app.asar`，Renderer URL 为 `courseware-editor://app/index.html`；
- `desktopAPI` 存在且被冻结；Renderer 的 `require` / `process` 为 `undefined`；
- `contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`、`webSecurity=true`；
- 通过真实 preload/dialog IPC 打开 `tests/fixtures/architecture-baseline/mixed-spatial.h5lesson`；
- 选择 Spatial location 并进入当前 location 试运行，`spatial-world-html` 可见；
- page error `0`、console error `0`、external request `0`。

`output/playwright/arch-5-packaged-mixed.png`（`373,309` bytes，`2854×1730`）来自 packaged process，证明桌面外壳和 Mixed V9 工程能够打开；捕获的是同进程另一编辑器窗口的初始 Slide，因此不能用它声称已视觉证明 Spatial Runtime。准确的 Spatial 画面证据来自完整 E2E 的 `11-mixed-spatial-try-run.png`。

功能结果与证据采集工具问题分开记录：最初的 CJS harness 在启动前因 top-level await 被拒；之后功能断言已通过，但 locator screenshot 和 page screenshot 分别在持续动画上超时；Electron `capturePage()` 成功却捕获同进程另一窗口；额外 CDP capture 被 offscreen compositor 阻塞后人工终止。以上迭代没有修改产品、固定候选或 source fixture，也没有重跑完整 V4；临时脚本、进程和经过明确根目录/前缀校验的临时 profile 均已清理。Candidate 3 的产品 V4 retry count 仍为 `0 / none`。

## 5. 三份代表 V9 工程与可见结果

源夹具在 V4 后继续与 manifest 精确一致：

| 代表工程 | 大小 | SHA256 |
|---|---:|---|
| `slide-heavy.h5lesson` | `7,050` bytes | `101b8e8186e1fbadbf9f083e5d3273eee9f1166fa3028478f290497537274a7b` |
| `flow-heavy.h5lesson` | `5,358` bytes | `326b1c29d72358d01373af26cbc6f97f396a34ce40e0e057079bbdcd76beeea0` |
| `mixed-spatial.h5lesson` | `6,583` bytes | `939a0d5520fe21a6608a4cb11b8487f87d223a1da15286965803eb4e2aaa66df` |

最新同次 V4 证据目录为 `output/arch-1-vs-06/run-34388`。独立结果审查为 **APPROVE，仅批准 engineering candidate**：

| 证据 | 可见判断 |
|---|---|
| `03-normal-replaced.png` | 编辑器、替换后组件和选中状态完整清晰；工程候选 |
| `09-flow-try-run.png` | Flow 内容完整可读，但上下黑边很大；工程验证外观 |
| `10-mixed-flow-try-run.png` | 大片空白、内容不足且有孤立红点；`placeholder`，不是 art candidate |
| `11-mixed-spatial-try-run.png` | 节点、关系、标签和卡片可见；教师控制器遮挡下部内容，右下 Runtime 区域/文字裁切；工程候选但有明确视觉缺陷 |
| `arch-5-packaged-mixed.png` | packaged 外壳与 Mixed 工程打开证据；中央初始页面为空，不作为 Spatial 画面证据 |

### 复用的 ARCH-4 Mixed PDF

`output/pdf/arch-4-mixed-surface.pdf`：`27,799` bytes，SHA256 `DAF12E21D503D224913533C23C87DF62D110A2FE6709F162E00FE6AEA9DB8653`，3 页 `960×540 pt`，顺序 Slide → Flow → Spatial。它证明真实 Electron → Published artifact → hidden BrowserWindow → `printToPDF` 链完整包含三种 Surface；本阶段没有重复生成。

视觉上，第 1 页左上两组作者同坐标文字明显叠印且不可读；第 2 页可读但稀疏；第 3 页几乎空白，仅有一个“空间节点”框。因此 PDF 结果局部只能归为 `placeholder`，不能描述为视觉无缺陷、art candidate 或 accepted。

## 6. 未执行项及适用性

- 未运行 `scripts/verify-release.ts` 或 `scripts/verify-w3-windows-portability.ts`：两者会构造/打开 Project V8，与当前“非 `schemaVersion: 9` 一律不受支持、不打开 V8 `.h5lesson`”的作者工程合同冲突。它们作为有 owner 的历史 Legacy 保留，不被拿来制造矛盾门禁。
- 未做外部 component catalog 精确数量/许可证审计：外部目录状态不是稳定产品事实；强制门禁已由能力 freshness 和完整 component-catalog E2E 覆盖。
- 未重复性能套件：Candidate 2 的两个修复未改变已登记 hot path、性能工具、fixture 或 build config；Candidate 3 的 render benchmark 已在完整 E2E 中实际运行。
- 未重复 ARCH-4 PDF：现有产物及全页渲染证据仍新鲜，且本阶段没有改变 PDF producer/consumer。

## 7. 独立终审与状态分层

- Pipeline reviewer：候选链、V4 数字、package hash/metadata/`NotSigned`、fixture hash 和 tested-byte provenance 均核对一致；**APPROVE 以第 8 节五项门禁在同一精确收口状态全部通过为生效条件**。
- Outcome reviewer：**APPROVE（仅 engineering candidate）**；确认 Mixed Flow/PDF 局部 placeholder、Spatial 遮挡与裁切、packaged screenshot 的证据边界，不允许升级为视觉验收。

| 维度 | 最终状态 | 边界 |
|---|---|---|
| Pipeline | `pass` | 单次完整 V4、一次 package、packaged V9 功能烟测与最终确定性 closure gates |
| Engineering | `engineering candidate / pass` | V9 代表行为、构建、打包与安全边界成立 |
| Visible outcome | 总体 `engineering candidate`；局部 `placeholder` | Mixed Flow 与 PDF 局部未达到美术候选；Spatial 有遮挡/裁切 |
| Art candidate | `not reached` | 不以自动化 green 替代视觉质量 |
| Accepted | `not claimed` | 仍需真实教师/产品 Owner 对实际课程与发布风险复核 |
| Release ready | `not claimed` | EXE 未签名，且 art/accepted 尚未达到 |

## 8. 最终确定性收口

本报告、最终任务卡、生成任务板与 repo-index 固定后，在同一精确状态执行并通过：

```text
npm run check:contracts
npm run check:task-board
npm run repo:index:check
npm run repo:index:quality
git diff --check
```

收口不重复 `npm run verify`、完整 E2E、打包、性能或 PDF；这些产品证据已由固定 Candidate 3 唯一 V4/实物门禁提供。最终治理生成物不改变产品、测试、fixture、合同或用户数据。

## 9. 剩余风险与 Owner 边界

1. Windows EXE 为 `NotSigned`；对外分发前是否签名以及证书/信誉策略由产品 Owner 决定。
2. Mixed Flow 的信息密度、Mixed Spatial 的控制器遮挡/裁切以及 PDF 夹具的叠印/稀疏/近空白页仍需实际内容与视觉修订，当前只保证工程链成立。
3. 自动化不能授予教师 `accepted` 或最终发布结论；本报告只关闭已激活稳定化计划中的工程任务，不替产品 Owner 做该决定。
