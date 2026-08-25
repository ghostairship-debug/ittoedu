# network-contract-01-remote-dependencies 声明远程资源与 API Origin

- Status / Owner: queued /
- Risk / Hotspot: S2 / contracts-schema
- Outcome / Why now: 当前 V9 只能表达本地 AssetMeta，且没有课程网络声明；增加一个 V9-only additive 合同，使工程能声明资源远程交付 URL 与 Runtime/Component 可连接的精确 origin，为轻量单 HTML、远程媒体和 AI API 奠基。
- Write scope / Baseline: baseline `b967c96`; `src/shared/contracts/course-project-v9/**`、V9 barrel/schema 入口、`docs/contracts/COURSE_PROJECT_V9.md`、对应 generated contract/capability artifacts 与直接 contract/round-trip tests；不得修改 V8 `projectTypes/projectSchema` 语义、Published producer、CSP、Electron session 或具体 Provider。
- Acceptance: 既有 V9 文件原样合法；新增字段全部 optional 且 strict；远程资源仍保留本地作者缓存/离线来源，不伪造 remote-only `path/byteLength`；连接只接受规范化精确 `https`/`wss` origin，拒绝 wildcard、userinfo、path/query/fragment 与危险 scheme；合同没有 Secret 值字段；不新增 V10。
- Focused validation: `npx vitest run tests/unit/courseProjectCoreContract.test.ts tests/unit/courseProjectRoundTrip.test.ts tests/unit/courseProjectTopLevelFields.test.ts`; `npm run generate:contracts && npm run check:contracts && npm run generate:ai-capabilities && npm run check:ai-capabilities`。
- S2 safety / rollback: 回滚起点 `b967c96`；只做 additive 合同与生成物，不改变当前运行行为；若 V9 继续复用共享 V8 AssetMeta 会污染 V8 Schema，必须改为 V9 专属扩展类型而不是修改旧类型。
