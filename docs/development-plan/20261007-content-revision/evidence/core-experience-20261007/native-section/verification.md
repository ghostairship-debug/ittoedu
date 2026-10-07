# Native Section Player Verification

Candidate result: PASS for the original rev15 answer section. Integration into main and Owner acceptance remain separate.

- Original author file: `D:/果铃工作台/output/content-revision/creation-chain/run-25n5QX/workspace/班级平均分教学课件.h5lesson`; archive `project.json` is schemaVersion 10, revision 15.
- Original delivery: `D:/果铃工作台/output/content-revision/creation-chain/run-25n5QX/workspace/班级平均分教学课件-离线.html`.
- Section: `67a21dc9-5709-46cb-8b60-399da3c15568`, title `显示平均分答案`, `collapsedByDefault=true`, six childIds.
- Published producer already retains instance data and childIds. No schema, source course content, resource, creation, calculation, or paid provider changes were required.

## Focused Check

`npx vitest run tests/unit/r1PublishedPlayer.test.ts -t 'consumes section defaults'`

The original implementation failed because details was null. The final candidate passed one focused test, with six unrelated tests skipped. It checks initial collapse, ordinary summary clicks, retained input node/value, open state after zoom/model refresh, a heading remaining a heading, and unchanged input payload.

`npm run build:player` passed. The existing ignored-rollup-option warning remains non-blocking.

## Original Work In A Real Browser

`prepare.ts` parses the original offline HTML without executing it, reads its full Published JSON, and uses the existing `buildComponentSingleHtml` with the candidate Player bundle. Original files remain untouched. The candidate is `original-rev15-with-candidate-player.html`.

Agent-browser sessions were isolated. The title was scrolled into the viewport before the actual pointer clicks. The original Player had zero details elements and all six children remained visible after clicking the title.

The candidate observations were:

| Action | Details Open | Visible Children | Same Six DOM Nodes |
| --- | --- | --- | --- |
| Initial mount | false | 0 | yes |
| Ordinary title click | true | 6 | yes |
| Second title click | false | 0 | yes |
| Third title click | true | 6 | yes |
| Observation zoom 1.5 | true | 6 | yes |

The three formula nodes rendered; the existing chart image loaded at 1269 by 806 pixels. The Player diagnostic was empty throughout. Both browser sessions were closed.

Visual evidence inspected: `closed.png` shows only the section title; `open.png` shows the title and three formulas; `chart-visible.png` shows the actual existing average-score chart after scrolling it into view.

## Source Review

The source writer was the controller package. The section review found no remaining blocking issue in this bounded change: native details/summary contains the existing child container, `sectionDefaultCollapsed` only resets open when the formal default changes, and unchanged live roots remain in place. The earlier new controller subscription recursion was detected by the focused test and fixed by the source writer before final validation.

This evidence covers the original Flow section and the focused child-input continuity case. It does not claim a full native-component matrix, a new course creation, main integration, release, or Owner acceptance.
