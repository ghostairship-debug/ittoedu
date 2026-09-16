# 1.9 共用正文首批实施记录

日期：2026-09-15。范围：r19-046 的独立 Shared Domain 模块、源文转换、数学结构、Word 转换与双归属端口。状态：**首批 engineering candidate；未完成整项 1.9，也未开放新 Flow 写入口。**

## 交付

- `src/shared/document/content.ts`：统一 inlines/LaTeX 类型和 strict Schema，覆盖段落、标题、引用与出处、列表、表头/单元格/说明、媒体说明、callout、section、代码、图表和组件。保留 Native TextRunStyle 语义；检查全树身份、表格行列和合并覆盖格。只读文本投影与 Unicode 码点长度不回写正文。
- `markdown.ts` / `resources.ts`：cw-markdown-v1 双向映射，普通 Markdown、样式、公式、链接、代码、列表/表格身份及完整 cw-object-v1。复杂对象、不能普通表达的字段和显著空白通过完整对象片段保留；严格拒绝缺失/额外/冲突资源、重复身份、未知字段、不完整公式和围栏。错误保留原稿并定位，Windows CRLF 位置映射已覆盖。
- `math.ts` / `omml.ts`：显式有限 LaTeX 命令表、派生结构树及 OMML，覆盖九类数学（求和与乘积各一个实例，共 10 个实例）、n-ary 操作数边界、上下限、中文条件、对齐行与矩阵。无旧 AST 转换，没有图像数学后备。
- `ports.ts`：工程 target/revision/epoch、码点选区、文件正文/附件版本、保存结果、外部变更、AI 修改/撤回的纯接口。这里没有实现新的文件 writer、工程 Store 或 History；真实 adapter 分别由 047–049/对应文件 Owner 接入。
- `tests/fixtures/shared-document/`：每类复杂对象均使用实际完整字段，不是说明占位符。

## 选型与依赖

本批固定 `marked@17.0.6`（MIT）和 `entities@8.0.0`（BSD-2-Clause）。采用与 Tiptap Markdown 相同的 Marked tokenizer，加产品自己的 strict 映射，不保存库 JSON，也不经 HTML DOM 读取身份注释。

曾安装并探查 `@tiptap/markdown@3.31.3` 的公开 Manager；默认无扩展解析不会保留本产品表格与 cw 标记。该探查仅说明不能直接采用默认映射，不构成“Tiptap 自定义接口不可用”的结论。本批直接完成底层 tokenizer 到产品合同的适配，移除未被代码消费的 Tiptap 依赖；047 的 Tiptap/ProseMirror 编辑器选型保持，届时根据实际接入锁定版本。CodeMirror、KaTeX 编辑呈现属于后续接入，未宣称已经安装验证。

## 有效证据

| 检查 | 结果 |
|---|---|
| `npx vitest run tests/unit/sharedDocumentMath.test.ts` | 26 项通过；数学结构、操作数边界、limits 和非法输入 |
| `npx vitest run tests/unit/sharedDocumentContent.test.ts` | 18 项通过；完整对象、身份、样式、合并格、资源映射 |
| `npx vitest run tests/unit/sharedDocumentMarkdown.test.ts` | 23 项通过；实际字段语义往返、原文保留、错误位置与 CRLF |
| `npx tsc --noEmit --pretty false` | 通过；主 TypeScript 配置包含 Shared、测试和脚本 |
| Windows 桌面 Word 16.0，build 16.0.20326 | 10 个原生 OMath 实例正常打开；15 个结构参数及关系/数值/条件实际修改，保存、关闭、重开后保留；未修改的矩阵格保持 |
| 真实呈现 | 查看 Word 原稿 2 页与修改稿 2 页，以及 LibreOffice 2 页；公式无截图降级，Word 等号对齐、中文条件、矩阵结构可见 |

纯模块测试合计 **67 项**。未运行完整产品矩阵或真实模型，不把这些局部证据计为新 Flow、真实文件共编或教师验收。

### 可重现的 Word 制品

```powershell
npx tsx scripts/build-shared-document-math-fixture.ts
./scripts/verify-shared-document-word.ps1
```

脚本在 `output/r19-shared-document/` 生成：

- `math-acceptance.docx`：原始九类数学验收文件。
- `math-word-edited.docx`：实际 Word 修改并保存的文件。
- `word-verification.json`：版本、逐项结构参数和重开结果。
- `math-word-original.pdf` / `math-word-edited.pdf`：实际 Word 的原稿及修改稿呈现。
- `content-roundtrip.md`：产品完整对象源文样例；资源路径是 fixture 映射，不声称附件已交付。

`render_docx.py` 已产出 LibreOffice PDF；其 PNG 阶段缺少 PATH 中的 Poppler，改用现有 PyMuPDF 渲染 PDF 并逐页查看。Word 编辑证据来自 Word COM 与 Word 导出，不以 LibreOffice 代替。首个 Windows PowerShell 5 子进程曾停滞，结束本次专用 Word 实例后，当前 PowerShell 完成验证；停滞尝试不计通过。

## 本轮发现及修复

- 列表中的身份注释会被通用 lexer 当成 HTML，导致保存后的列表无法重开：先按合同提取 item 身份，再解析可见正文。
- 代码/对象围栏未闭合时通用 Markdown 会接受到文件末尾：增加明确拒绝，保留草稿。
- 表格内的公式竖线、代码括号、首尾空白、普通 HTML 实体和引用式链接可能损坏源文往返：补产品映射与完整对象表达，命名反例已通过。
- 块元数据不能携带另一份被可见源文覆盖的 content/code/latex 等正文，避免静默接受相互矛盾的两份内容。

## 后续界限

首批独立合同与转换已落地。040 的记录/恢复、042 的课例身份、047 的连续编辑/中文输入法、048 的正式 Flow/V9/Published/Player/导出切换和 049 的真实 Markdown 共编尚未实施。本批 Word 文件验证不等于完整 Flow DOCX 出口完成，也不等于 1.9 art candidate 或 Owner accepted。按实施方案继续推进对应节点，不要求重新作产品选择。
