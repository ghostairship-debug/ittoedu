# r11-037h-feature-result-types 把媒体、组件、Runtime、Interaction 结果类型从 root 移到各 Feature 文件

- Status / Owner: queued /
- Outcome / Evidence: 把媒体、组件、Runtime、Interaction 结果类型从 root 移到各 Feature 文件，只有一个定义。
- Write scope: `src/renderer/store/editorStore.ts`、`src/renderer/authoring/courseAuthoringSession.ts`、`src/renderer/media/commitCourseMediaAuthoring.ts`、`src/renderer/components/commitComponentPackageAuthoring.ts`、`src/renderer/runtime/commitRuntimeAuthoring.ts`、`src/renderer/interactions/commitInteractionAuthoring.ts` 及 TypeScript 报出的直接 type importers
- Write locks: none
- Acceptance: 媒体、组件、Runtime、Interaction 结果类型完全下沉到各 Feature 模块，root 仅作为 Zustand composition root；npm run typecheck 通过。
- Validation: `npm run typecheck`
