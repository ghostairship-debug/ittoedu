# TypeScript 7 索引生成器与薄适配层

## 1. 已核实前提

仓库固定 `typescript: 7.0.2`。包根主导出不提供传统 `createProgram/createSourceFile/ScriptTarget` API。可编程能力位于 `typescript/unstable/sync` 等子路径。

因此，任何直接复制 TypeScript 5 Compiler API 示例的实现都不成立。

## 2. 先行 spike

ARCH-0B 第一张卡只验证：

- 分别载入 `tsconfig.json`、`tsconfig.electron.json`、`tsconfig.e2e.json`；
- 枚举三个 project 的文件并生成并集；
- 对 main/preload、renderer/player/shared、unit/integration/e2e 完成覆盖检查；
- 共享文件按规范化相对路径去重，同时保留所属 project 列表；
- 读取 import/export；
- 获取顶层声明和行号；
- 处理 alias、barrel、type import、dynamic import；
- 在 Windows 路径下稳定运行；
- 连续两次输出相同。

Spike 不创建完整 schema，不改产品代码。

## 3. 推荐实现

```text
scripts/repo-index/typescriptAdapter.ts
  唯一允许 import typescript/unstable/* 的文件

scripts/repo-index/model.ts
scripts/repo-index/scanFiles.ts
scripts/repo-index/scanTypescript.ts
scripts/repo-index/scanTests.ts
scripts/repo-index/writeGenerated.ts
scripts/generate-repo-index.ts
```

适配层可在内部组合 `typescript/unstable/sync` 与 `typescript/unstable/ast` 等必要子路径；`unstable/sync` 本身不提供完整 SyntaxKind 与节点判断工具。其他代码只依赖适配层的稳定内部接口，不得直接 import 任一 unstable 子路径。

## 4. 适配层接口

```ts
interface IndexedSourceFile {
  path: string
  projects: string[]
  imports: IndexedImport[]
  exports: IndexedExport[]
  symbols: IndexedTopLevelSymbol[]
  tests: IndexedTestCase[]
}

interface TypeScriptIndexAdapter {
  loadProjects(tsconfigPaths: readonly string[]): Promise<void> | void
  listFiles(): readonly { path: string; projects: readonly string[] }[]
  scanFile(path: string): IndexedSourceFile
  dispose(): void
}
```

不把 TS7 unstable AST 对象泄漏到生成器其他模块。

## 5. V1 识别范围

必须支持：

- static import；
- `import type`；
- export/re-export；
- dynamic `import()`；
- 顶层 function/class/interface/type/const；
- `describe/it/test` 字面量名称；
- 行号；
- JSDoc 第一段。

可选启发式：React 组件、Zod Schema。识别失败不能影响 import/export 和普通符号索引。

## 6. 备选与停手条件

只有出现以下情况才考虑新依赖：

- TS7 adapter 无法可靠获取 V1 必需信息；
- 跨平台行为无法稳定；
- 官方 API 变动导致维护成本明显高于一个独立解析依赖。

备选顺序：

1. scanner/文本启发式补足小缺口；
2. 独立、锁版本、仅用于索引器的解析依赖；
3. 最后才考虑 ts-morph。

不得未经 ADR 同时安装第二套 TypeScript 和 ts-morph。

## 7. 测试

- API smoke；
- alias；
- barrel；
- type import；
- dynamic import；
- 三个 tsconfig 的覆盖与共享文件去重；
- CRLF/LF 输入产生同一规范化文本 hash 和逐字节一致的 generated 输出；
- Windows 路径大小写归一；
- 顶层符号行号；
- test 名称；
- dispose 后无资源残留。
