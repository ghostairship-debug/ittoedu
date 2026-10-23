# Runtime performance repair: confirmed scope

This leaf changes software only. It does not modify the v08 GLX, source programs, images, motion routes or final HTML. The parent owns rebuilding and same-condition end-to-end measurements.

## Confirmed hotspots

The independent Chromium CPU profile in `../performance/BASELINE_ATTRIBUTION.md` identifies repeated parent lookup as the main host CPU hotspot. In the desktop baseline, parent lookup self time was 3.225 s during startup and 6.020 s during the scrolling profile; mobile was 3.977 s and 7.016 s. The old artifact's minified `findInstanceParent` is the same full-instance parent scan now called `owningContainer` in source. Each runtime ancestry step enumerated every instance again.

`ComponentRuntimeWorld.setState` also sent every state key through navigation `changed()`. The navigation subscriptions include activity refresh, Flow reading geometry, the teacher controller's DOM reconstruction, Flow TOC activation and HUD placement. A local measurement program subscribing to navigation and publishing its current measurement therefore re-entered unrelated navigation readers for every published state value. This feedback is a generic software defect; the work's own use of stale visual-slot coordinates and route selection remains a separate creative defect.

The resource URL lease also decoded identical data URL strings once per logical ID. The profile's old `webRuntimeResourceTable.update` symbol maps to the current `createWebResourceUrlLease` used by the compiled Player, Sandbox and authored-document bootstrap. Measured main-realm self time was 417 ms desktop and 443 ms mobile. Cross-process tracing additionally found about 5.49 s of startup FunctionCall work across seven runtime realms receiving and eagerly decoding full resource directories; this is not additive to the main-thread CPU figures. Actor image callbacks were 443 ms in that trace, so the startup delay cannot primarily be blamed on the work's image scanning. See `resource-url-lease.md` for the source-decoding repair and its focused verification.

## Implemented behavior

- `src/player/components/runtime/containerScopes.ts` derives a parent index once from the current formal runtime snapshot. Runtime root, container, activity and containment queries reuse the index rather than repeatedly enumerating all instances. It preserves project-root/global/first-parent precedence and cycle termination. New immutable snapshots, Undo/Redo snapshots, a new instance map, revision or root/global array references invalidate the derived index. It stores no second author tree or mutable navigation state.
- `ComponentRuntimeWorld.setState` still snapshots input, delivers every accepted value to exact state subscribers and emits every `__runtime.state` event. Only keys actually referenced by current navigation guards invoke navigation `changed()`. Both `exists` and `compare` dependencies remain live, including replacement of guard definitions. Interaction admission and state-driven visibility keep their existing direct state/event subscriptions. Runtime capability and view/navigation change notifications are untouched.
- `resourceUrlLease.ts` registers the existing resource directory without decoding it. An actual synchronous URL access decodes an exact data URL once into a shared Blob inside the consuming lease. Each logical ID/source version retains a distinct object URL, so authoring identity remains exact. `reverse()` checks already materialized addresses and bindings without touching unused lazy entries. Already issued URLs stay valid through removal/replacement until scope release, preserving authored-program references. Scope release revokes each owned URL once. Different realms retain their own authorized URL leases. The initial shared-URL candidate was rejected by independent review R02 and replaced by this shared-Blob design; see the lease report.
- `ownedDocumentAuthoring.ts` and the two authored parser bootstraps pass the lease's non-materializing reverse lookup into the existing authoring owner. The Sandbox owner makes the same narrow substitution in its file; the compiled Player owner preserves URL property descriptors instead of eagerly spreading their values. Resource field refresh only reads IDs actually named by DOM markers, so it retains synchronous dynamic resource access without decoding the unused directory.
- The geometry owner's new `scope.measure` callback is wired through the World and uses this same parent index when collecting enclosing Flow roots. Its geometry API, helper and tests belong to that leaf's result, not a separate performance platform.

## Focused validation

Executed together:

```powershell
npx vitest run tests/unit/runtimeOwnershipPerformance20261024.test.ts tests/unit/runtimeStateNavigation20261024.test.ts tests/unit/offscreenWorldActivity20261013.test.ts tests/unit/glxContainerWorld20261020.test.ts tests/unit/glxContainerNavigation20261020.test.ts
```

New ownership (4), new state/navigation (2), and existing offscreen lifecycle (3) checks passed. They cover nested/global/missing/cyclic ownership, ancestor visibility, move/Undo/Redo snapshots, 500 repeated runtime resolution rounds with one source-map enumeration, state snapshot isolation and unchanged precise events, absence of unrelated Flow reads, changed guard dependencies, and retained mount/update/suspend/resume/dispose behavior.

The two supplementary `glxContainer*20261020` files had 20 passing and 4 failing assertions. A read-only Vite transform restored only this leaf's parent-lookup and state-notification implementation to HEAD while leaving workspace files intact; it reproduced all four failures (`old-tests-baseline.json`). The failures are pre-existing expectations involving a Flow navigation `kind` argument, Spatial `presentation.set`, inline source-generation changes, and a late native click configured with Spatial presentation state. They were not changed to manufacture a passing result. The ignored `baseline.vitest.config.ts` documents this limited baseline procedure.

Resource lease verification:

```powershell
npx vitest run tests/unit/webResourceContentLease20261024.test.ts tests/unit/webResourceUrlLease20261020.test.ts
```

Final lease revision: 2 files / 8 tests passed. The new 100-entry counter proves registration and reverse lookup consume zero payloads, and consuming one entry decodes one payload. Shared content retains distinct logical URL identities and correct historical URL lifetime.

`npx vitest run tests/unit/ownedDocumentLazyResources20261024.test.ts` also passed 2 tests. They exercise the real parser program installer with 100 registered entries (zero decodes until one actual resource is resolved) and the owned-document authoring factory's callback (a non-consumed entry deliberately throws if enumerated). No broad matrix or release build was run by this leaf. No user-facing speedup is claimed until the parent rebuilds the delivery artifact and repeats the independent desktop/mobile measurements.

## Compiled Player dependency correction

A later independent bundle review found that the compiled Player imported two pure projection helpers from `ModelPlayer.ts` and `publishedPlayer.ts`. Importing those modules pulled in the default native runtime registry, which imported editor authoring through the input barrel and retained Babel/KaTeX initialization in the compiled runtime. The reviewed pre-correction runtime was 1,610,898 bytes. This was a real delivery dependency error, not a request to remove native/Source runtime capabilities.

The two functions were moved without changing their logic into the sole neutral owner `src/player/componentPlatform/publishedProjection.ts`:

- `publishedComponentModel(payload)`
- `resolveModelPlayerPresentation(source, navigation?)`

The new module imports values only from the formal project contract; its Published, resources and navigation types have no runtime imports. ModelPlayer and publishedPlayer consume the new owner, and the old definitions/re-exports were removed. Output capture and three direct test imports/inline bundle entries now reference the new owner. Root made the compiled Player's two imports reference that same module. No runtime, World, native implementation or authoring feature was removed.

Minimum behavior check:

```powershell
npx vitest run tests/unit/publishedProjection20261024.test.ts tests/unit/glxContainerProjection20261020.test.ts -t "projects published|applies parent|keeps the renderer final state"
```

2 files / 3 selected tests passed (11 unrelated tests were not selected). They cover Published resource metadata and logical identity without delivery-URL persistence, parent-before-child nested presentation with source immutability, and the existing renderer state-plus-draft projection consumed by both DOM and World. `git diff --check` passed for the moved modules and directly affected tests. Root owns the one relevant bundle rebuild and actual size comparison; this leaf does not infer the saved bytes from source alone.
