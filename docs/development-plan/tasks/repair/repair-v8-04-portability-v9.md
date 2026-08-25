# repair-v8-04-portability-v9 Windows 可移植性验证改为 V9

- Status / Owner: active / codex/repair-v8-04
- Risk / Hotspot: S2 / none
- Outcome / Why now: `verify:w3-portability` 仍通过 V8 archive/Web package 证明 Windows 路径可移植性，产品打开路径却只支持 V9；CMP-03 已补齐其 Phaser Component 互动行为门，现可把验证改为当前产品事实。
- Write scope / Baseline: baseline `e61cd82d3229b8245f4c8ce126a85b3f4285b2fc`；仅允许修改 `scripts/verify-w3-windows-portability.ts` 及一个必要的专属测试；禁止修改产品 main/preload/renderer/Player、Schema/合同、sample、render-host benchmark、release verifier、package scripts或 generated 输出。
- Acceptance: verifier 在临时目录用真实 V9 factory、组件导入与 Slide component authoring command 创建单页 Phaser counter；保存 archive 后移动到含空格/Unicode 的新目录、删除外部 component source、重开、改名并再次保存；archive 内嵌组件字节且不泄漏源路径；离线单 HTML 与 Web package 均可经 `file://` 点击改变计数，零 `pageerror`、零异常 console、零外部网络；既有 unpacked/portable app 移动验证保持。
- Focused validation: `npm run verify:w3-portability`。
- S2 safety / rollback: 所有工程和导出物只写临时目录，移动/删除前校验路径位于该目录；回滚起点为上述 baseline。若当前 API 无法表达要求，停止并报告，不回接 V8 或修改产品宿主。
