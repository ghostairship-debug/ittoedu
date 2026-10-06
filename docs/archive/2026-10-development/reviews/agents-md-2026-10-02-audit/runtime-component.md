> 历史原文：仅对应当时范围；不表示当前任务、授权或实现状态。当前读[CURRENT_STATUS](../../../../development-plan/CURRENT_STATUS.md)。

# Runtime与Component 审计报告（AGENTS.md 2026-10-02 原则违反）

来源：子智能体只读审计；运行 ID：aea82082544870a14

# Audit Report: Runtime/Component/HTML Import Staging & Admission

Read thoroughly: `AGENTS.md`, `src/main/workbench/build/ControlledBuildService.ts`, `src/main/workbench/build/ElectronBuildAdmission.ts`, `src/main/dynamicAdmission.ts`, `src/main/workbench/htmlImport/*`, `src/shared/runtimeSourceValidation.ts`, `src/core/drivers/codecs/importComponentPackage.ts`, `src/shared/projectDynamicTargets.ts`, `src/player/RuntimeRegistry.ts`, `src/player/surfaces/runtime/publishedSurfaceRuntimeMount.ts`, `src/player/surfaces/runtime/publishedSurfaceRuntimeAuthoringTargets.ts`, `src/player/RuntimeAuthoringTargetRegistry.ts`. `src/main/workbench/runtimeAdmission/` does **not** exist — the runtime admission logic lives in `src/main/workbench/build/` and `src/main/dynamicAdmission.ts`.

Findings ordered by user-visible friction severity.

---

## 1. Same runtime / component source is validated against the same protocol four times along one import

`importComponentPackage.ts:240` (`validateComponentRuntimeSource` on unzip) → `ControlledBuildService.ts:246` (`this.syntax()` calls `validateComponentRuntimeSource` / `validateRuntimeSource` again) → `ControlledBuildService.ts:280` (`this.syntax(...)` called once more from `this.model()` for every layer item, despite `this.syntax()` having already been called as part of the `build.syntax` step the orchestrator may run) → `prepareHtmlCourseCandidate.ts:162` and `:222` (`validateRuntimeSource` once more on the *wrapped* HTML source before submission) → `runtime registry`: `src/player/RuntimeRegistry.ts:55` and `src/player/surfaces/runtime/publishedSurfaceRuntimeMount.ts:148` re-validate the exact same source again at mount in the admission host.

The pattern is identical in all four call sites: same `import`-/`export`-/`require` regexes, same empty-source guard. None caches the verdict per `(source, kind)`.

- Violates: "最小充分验证…命中现有门时先证明它保护的当前属性和失败方式；同义重复通过即停止".
- User friction: every regenerate→check round trips the same static check four times, latency added per call. For HTML imports the source is wrapped by `createHtmlDocumentRuntimeSource(...)` between the second and third validation, but the wrapping *cannot* introduce `import`/`export`/`require`, so the post-wrap check is duplicate.

---

## 2. Hard-coded "AI-sized" resource budgets have no traceable origin in real failures

`ControlledBuildService.ts:32`
```ts
const DEFAULT_BUDGET: BuildBudget = { maxBytes: 256 * 1024 * 1024, maxFiles: 16384, maxWrites: null, maxChecks: null, maxSameSourceChecks: null, maxDurationMs: 10 * 60_000 }
```

The `256 MB / 16384 files / 10 min` values appear nowhere in `AGENTS.md` or contract docs; they look like AI-picked round numbers, not measured responses. Compare the same round numbers used pervasively across unrelated features: `delegation`, `compute`, `media`, `attachments`, `attachmentsDesktopService` all use `256 * 1024 * 1024` and `10 * 60_000`.

`src/player/RuntimeAuthoringTargetRegistry.ts:39` and `src/player/ComponentAuthoringTargetRegistry.ts:21`: `const MAX_AUTO_TARGETS = 400` — even more clearly an AI-guess ("about 70 texts" comment on line 38) — but it caps the **auto-detection of text edit targets**. A courseware slide with >400 text spans simply stops exposing edit handles with no UI affordance to say so.

`dynamicAdmission.ts:87,106` `setTimeout(..., 20_000)` per target with absolute cap `20 * 60_000`: a slow Surface runtime that takes >20 s to compute first frame on a real machine gets killed. No comment ties this to a real failure; the implications are a teacher's complex animation gets blocked at import.

- Violates: "非必要不增加核验门…仅预防性、格式偏好、无法对应实际错写的门应删除或改成不阻断的诊断".
- User friction: import a 270 MB HTML package / 17000 files / 41st auto-edit-target / video-editor slow-motion animation import — all hard-fail with no remediation path in the UI. There is no "raise limit" or "override and continue" affordance anywhere in the staging pipeline.

---

## 3. HTML import has a static "reasonable HTML only" gate with no user-level retry path

`prepareHtmlCourseCandidate.ts:69-70`
```ts
const errors = diagnostics.filter(item => item.level === 'error')
if (errors.length) throw new UserFacingError('HTML 导入失败', errors.map(item => item.message).join('\n'), '请修正列出的不受支持或不安全资源后重试。')
```

This is thrown *before* `build.create` is even called, and bubbles up via `HtmlImportService.prepare(/import/)` to the user as a hard error. The full set of error codes that goes through here includes diagnostics in `extractHtmlResources.ts`, many of which are pure static guesses rather than runtime-impossible situations:

- `extractHtmlResources.ts:667` — `unsupported-module-graph`: HTML using `import`/`import()` (very common ESM) is rejected
- `extractHtmlResources.ts:780` — `unsupported-network-sink`: any `fetch`/`WebSocket`/`Worker`/`XMLHttpRequest` call rejects the whole import
- `extractHtmlResources.ts:1007` — `<script>` inside dynamically-emitted HTML rejects the whole import
- `extractHtmlResources.ts:1008` — `<iframe>` anywhere rejects
- `extractHtmlResources.ts:1031` — `modulepreload` rejects (Vite output standard)
- `extractHtmlResources.ts:1063` — external script with `defer`/`async` rejects
- `extractHtmlResources.ts:1065` — any `https://` script reference rejects
- `remoteHtmlReferences.ts:25-28` — remote stylesheet / remote font / remote script rejects (only `image`/`media` are warned, lines 21-24)

The suggested remedy (`'请修正列出的不受支持或不安全资源后重试'`) tells the user **to repair the HTML by hand**. There is no "continue as static fallback", no "paste the portion you don't support as a screenshot/iframe placeholder", no software-side auto-strip-and-import. `validateHtmlImport` runs statically; the real player is never reached.

- Violates: AGENTS.md "导入优先让内容成功进入并使用……局部不支持或可修复缺口提供清楚诊断和后续修复入口，不据此拒绝整份可用内容，也不静默静态化" — currently it neither imports nor preserves that section as a fallback or partial image; it just refuses.
- User friction: AI daily generates React/Vite builds, helper scripts with `fetch(                                         ./data.json)`, `<link rel="stylesheet" href="https://cdn…">` etc. Every one of those is rejected wholesale before it ever reaches admission. The remedy path is to rewrite the AI's HTML by hand or ask AI to regenerate without those primitives — high friction.

---

## 4. Origin / asset closure is workspace-scoped in an unusual way

`ControlledBuildService.ts:253-254`
```ts
for (const origin of project.network?.connectOrigins ?? []) if (!job.allowedOrigins.includes(origin)) throw new ControlledBuildError('origin-not-authorized', `构建未获准连接该精确来源：${origin}`)
for (const asset of Object.values(project.assets)) if (asset.remote && !job.allowedOrigins.includes(new URL(asset.remote.url).origin)) throw new ControlledBuildError('origin-not-authorized', '外部素材来源未获当前构建授权')
```

The only writer of `job.allowedOrigins` is `createOnce` (line 210), which reads `input.allowedOrigins`. `input.allowedOrigins` is sourced from `HtmlImportNetworkGrants.register(...)` in `HtmlImportService.ts:106-108`, which only registers origins auto-collected from `closure.remoteReferences` filtered to `usage === 'image' || usage === 'media'` (`remoteHtmlReferences.ts:33-38`). If the AI *manually* wants to use a font or connect endpoint, the only path is to register the origin into a separately-authorized list before prepare starts — for fonts and scripts this is impossible because `extractHtmlResources` already errored them out (see #3). No courseware-side UI allows the teacher to add an extra origin during admission.

Also `readHtmlClosure.ts:32,17-19`: `confined(root, target)` uses path normalization; if user picked `D:\work\lesson1\page.html` and the assets live in `D:\work\shared\` (a sibling folder), the `..` traversal `page.html → ../shared/foo.png` succeeds within `dirname(page.html)` but fails `confined`, so the closure reader drops the asset silently (line 46 `continue`). Combined with the static diagnostic `missing-relative-resource` (line 220 of `extractHtmlResources`), the import then fails in #3 with "找不到相对资源" rather than letting user pick a root override UI.

- Violates: "资源引用…实际可运行的才在相应边界明确失败"; the path-confined check uses a static default rather than the actual common user pattern of a workspace folder shared between multiple courseware.
- User friction: AI puts asset in workspace sibling – import errors out with "找不到相对资源", no way to override rootDir from the chat flow.

---

## 5. Re-admission after editing an already-admitted Runtime is full, not incremental

`ControlledBuildService.ts:315`
```ts
const targets = projectDynamicTargets(model.project, baseline.project, documentDigest(model.resources) !== documentDigest(baseline.resources))
```

`projectDynamicTargets` in `src/shared/projectDynamicTargets.ts`:

- (lines 32-34) If *any* surface geometry changed (canvas size, layout mode, presentation states, even flow `blocks` JSON), `layoutChanged=true` and **every** runtime/component instance on the surface is re-admitted. Just resizing a slide canvas re-runs the full admission matrix on every runtime on that surface.
- (line 13) If `documentDigest(model.resources) !== documentDigest(baseline.resources)` — i.e. *any* asset byte changed — every single component package on the project is re-collected into the dynamic target set. Drop in one new icon and every other runtime instance gets re-admitted.

Worse, `ControlledBuildService.check()` never passes a "skip already-passed instances" hint to the admission host; the full set is dumped into `dynamicAdmissionPayloadSchema` and re-run inside the host browser process. Each targeted instance costs up to `20_000` ms (`dynamicAdmission.ts:106`). A course that has 30 admitted components on one slide – one asset change re-runs 30 × 20 s sequential scans if each is at the boundary.

- Violates: AGENTS.md "只进行最小充分验证……扩大验证必须有相关变化、可信失败、新假设或真实集成属性". An unrelated layout change is not a "可信失败" for a runtime that has already passed and has unchanged source.
- User friction: AI just wants to fix one minor text edit; the user waits through a full re-admission cycle.

---

## 6. Compilation and protocol checks are not deduplicated across job slices either

Even inside one `build.check` call, the same runtime source passes through these stages unconditionally:

1. `ControlledBuildService.syntax()` line 246 — schema validation AND `new Script(source)` compilation gate.
2. `ControlledBuildService.model()` line 261 then 280 — calls `this.syntax()` once per component package and once per layer item.
3. `dynamicAdmissionPayloadSchema.parse` (line 320) — schema re-validation of the full project + every component file in base64.
4. Inside the host runner (out of audit scope here): `RuntimeRegistry.executeRuntime` / `publishedSurfaceRuntimeMount` calls `validateRuntimeSource` again.
5. After admission returns: `applyDynamicInstanceCaptures` (line 332) calls `parseComponentPackageFiles(...)` for every component again (line 330-331), re-running the same `validateComponentRuntimeSource` (inside `parseComponentPackageFiles` at `importComponentPackage.ts:240`).

That is five runs of the same regex/parse for one source, none of them keyed to `runtimeSource` digest.

- User friction: `check` latency grows linearly with project size *and* with every component package count even when the source is unchanged because the digest check (line 289) is only used to skip the fast-path (`status === 'ready'`), not the re-validation work inside.

---

## 7. Lifecycle: a single failed admission forces the entire job back to "failed" state with no instance-level retry

`ControlledBuildService.ts:360` — if `admission.ok === false` for any single target, the whole job flips to `failed`. There is no per-instance replay: to retry, the user must call `build.check` again, which recomputes ALL targets, not just the failing ones. The cached "ready / artifact" state is destroyed on each `write` (line 242 `delete job.artifact; delete job.artifactId`) — even an unrelated write to a different file of the scratch drops the previously-admitted artifact.

This interacts badly with #5: any subsequent write triggers a fresh full-cycle re-admission.

- Violates: "最小充分设计"; the lifecycle should be: per-instance admission verdict cache + targeted re-admission of modified instances only.

---

## 8. HTML format gate ALSO fires on `readHtmlClosure` returning early during draft exploration

`readHtmlClosure.ts:25` throws `'未绑定 HTML 只能从当前正文导入自包含资源'` when `htmlPath` is not absolute. In `HtmlImportToolService.import()` line 88 the rootDir is `path.dirname(source.binding.path)` — an AI pointing to a draft HTML in-memory document with no file binding gets this hard error with no alternative continuation.

Couples to issue 3: hard-blocking at the format gate instead of letting the standard `build.create` / admission cycle evaluate the dynamic section.

---

## Non-issues (verified compliant with AGENTS.md so_Not_ listed as findings)

- `publishedSurfaceRuntimeAuthoringTargets.ts:44-47,255-257`: `data-courseware-edit-key` is an **optional declarative override** — auto-recognition via `RuntimeAuthoringTargetRegistry` (lines 428-... `#samples()`) runs first and skips only nodes already covered by declarative keys. AI does NOT have to add the markers for text/images to be editable. `#assertKnownKey` only throws when Runtime source explicitly calls `registerText({key})` with a key that wasn't declared in `content.values` — which AI can predeclare by writing `content.values` itself or rely on auto-detection.
- `dynamicAdmission.ts` itself correctly isolates the candidate to a sandboxed `BrowserWindow` with no node and no preload — this is the hardening AGENTS.md preserves.
- Electron sandbox, realpath closure inside the scratch (`ControlledBuildService.safeRoot`, `scratch`), and no candidate-supplied preload/URL claims are appropriate hardening, not blockers.

---

## Summary table of the most user-visible blockers

| # | File:line | Static gate / duplication | User-visible friction |
|---|---|---|---|
| 3 | `prepareHtmlCourseCandidate.ts:69-70` + `extractHtmlResources.ts` (many lines) | Any `import`/`fetch`/`iframe`/`modulepreload`/remote stylesheet/script in HTML fails the whole import | AI-generated modern React/Vite/HTML5 page gets rejected at the front door |
| 1 | `ControlledBuildService.ts:246,280` + `prepareHtmlCourseCandidate.ts:162,222` + `RuntimeRegistry.ts:55` | `validateRuntimeSource` 4× on same bytes | Slow import for no protective gain |
| 2 | `ControlledBuildService.ts:32`, `RuntimeAuthoringTargetRegistry.ts:39`, `dynamicAdmission.ts:87` | 256MB / 16384 files / 400 auto-text-targets / 20 s per-target, no justification | Hard fail with no override |
| 5 | `projectDynamicTargets.ts:13,32-34` | Layout change re-admits every instance on the surface; asset change re-admits entire surface | One icon correction forces full re-admission cycle |
| 7 | `ControlledBuildService.ts:242,360` | Single failure poisons whole job; cache destroyed on any write | No per-instance retry; reset to scratch |
| 4 | `ControlledBuildService.ts:253-254`, `readHtmlClosure.ts:17-19,32` | Origin grant list locked at create; sibling-folder workspace assets silently dropped | "找不到相对资源" with no remediation |
| 6 | `ControlledBuildService.ts:330-332` | `parseComponentPackageFiles` re-runs after admission | Latency scales linearly |
| 8 | `readHtmlClosure.ts:25` | Non-absolute HTML path refuses outright | Draft exploration dead-end |
