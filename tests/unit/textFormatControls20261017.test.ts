// @vitest-environment node
import { testContainerInstance } from '../helpers/glxWorkFixture'
import { expect, it } from 'vitest'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { chromium } from 'playwright'
import { componentPropertiesEdits } from '../../src/renderer/ui/properties/componentProperties'
import { authorSpotEdits, authorSpotStyleEdits } from '../../src/core/components/authoring/componentAuthorEdits'
import { authorSpotFormatView, authorSpotStylePatch } from '../../src/renderer/componentPlatform/surfaces/slide/authorSpotFormatting'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { WEB_DEFINITION } from '../../src/components/web/data'
import { formatTextComponentRange, textComponentDataSchema } from '../../src/components/text/data'
import type { ComponentAuthorSpot, CourseProjectV10 } from '../../src/shared/contracts/component-platform'

it('paints the chosen native color and locally formatted HTML text after canonical edits and archive reload', async () => {
  const frozen = JSON.parse(await readFile('tests/fixtures/textLayoutPrecision20261017.json', 'utf8')) as { project: CourseProjectV10; exampleId: string }
  const project = frozen.project, instance = project.instances[frozen.exampleId]!, original = structuredClone(instance)
  const color = '#d2266b', edits = componentPropertiesEdits(instance, project.definitions[instance.definitionId], { style: { color, bold: true, fontFamily: 'SimSun' } })
  const changed = applyComponentOperation(project, captureComponentOperation(project, edits))
  const driver = new CourseV10Driver(), saved = driver.load(driver.serialize({ kind: 'course-v10', project: changed, resources: { assets: {}, components: {} } }))
  if (saved.kind !== 'course-v10') throw new Error('Expected course')
  const next = saved.project.instances[instance.id]!
  const range = { ...original, data: JSON.parse(JSON.stringify(formatTextComponentRange(textComponentDataSchema.parse(original.data), 0, 1, { color: '#0070cd' }))) }
  expect(next.frame).toEqual(original.frame)
  expect(saved.project.instances[frozen.exampleId]!.data).not.toEqual(original.data)
  const special = structuredClone(original)
  special.style = { ...special.style, '-webkit-text-fill-color': '#00ff00', color: '#123e40' }
  const bundle = await build({ stdin: { contents: `export {renderTextComponent} from './src/components/text/render';
    export {textComponentDataSchema} from './src/components/text/data';
    export {applyComponentPaintStyle} from './src/player/components/componentPlacementStyle';
    export {createDomAuthoring} from './src/components/web/authoringDom';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'FormatProbe', target: 'es2022' })
  const browser = await chromium.launch({ headless: true })
  const output = 'output/editability-background-snapshot-repair-20261017/format'
  await mkdir(output, { recursive: true })
  try {
    const page = await browser.newPage()
    await page.setContent('<!doctype html><div id="native"></div><div id="html"></div>')
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
    const native = await page.evaluate((value: unknown) => {
      const { original, next, range, special, definition } = value as { original: typeof instance; next: typeof instance; range: typeof instance; special: typeof instance; definition: unknown }
      const api = (window as any).FormatProbe, host = document.querySelector<HTMLElement>('#native')!
      const paint = (instance: typeof original) => {
        api.applyComponentPaintStyle(host, instance, definition)
        host.replaceChildren(api.renderTextComponent(document, api.textComponentDataSchema.parse(instance.data)))
        const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT), values = []
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const style = getComputedStyle(node.parentElement!)
          values.push({ text: node.textContent, color: style.color, fill: style.webkitTextFillColor, family: style.fontFamily, weight: style.fontWeight })
        }
        return values
      }
      return { before: paint(original), after: paint(next), localRange: paint(range), special: paint(special) }
    }, { original, next, range, special, definition: project.definitions[instance.definitionId] } as unknown)
    expect(native.before.some(value => value.fill !== 'rgb(210, 38, 107)')).toBe(true)
    expect(native.after.length).toBeGreaterThan(0)
    for (const value of native.after) {
      expect(value.color).toBe('rgb(210, 38, 107)')
      expect(value.fill).toBe('rgb(210, 38, 107)')
      expect(value.family).toBe('SimSun')
      expect(value.weight).toBe('700')
    }
    expect(native.localRange.map(value => ({ text: value.text, color: value.color, fill: value.fill }))).toEqual([
      { text: 'P', color: 'rgb(0, 112, 205)', fill: 'rgb(0, 112, 205)' },
      { text: ' = 30 毫米　f = 0.6（60%）　I = 20 毫米', color: 'rgb(18, 62, 64)', fill: 'rgb(18, 62, 64)' },
    ])
    expect(native.special.every(value => value.fill === 'rgb(0, 255, 0)')).toBe(true)
    const actual = JSON.parse(await readFile('tests/fixtures/textFormatAncestorFill20261017.json', 'utf8')) as { headerId: string; parentId: string; project: CourseProjectV10 }
    const actualRanges = formatTextComponentRange(textComponentDataSchema.parse(actual.project.instances[actual.headerId]!.data), 0, 2, { color: '#d2266b' })
    const ancestors = await page.evaluate((value: unknown) => {
      const { fixture, rangeData } = value as { fixture: typeof actual; rangeData: typeof actualRanges }
      const api = (window as any).FormatProbe, project = fixture.project, host = document.querySelector<HTMLElement>('#native')!
      host.removeAttribute('style')
      const paint = (nested: boolean, range: boolean) => {
        host.replaceChildren()
        const parent = project.instances[fixture.parentId]!, header = project.instances[fixture.headerId]!
        const group = document.createElement('div'); host.append(group)
        api.applyComponentPaintStyle(group, parent, project.definitions[parent.definitionId])
        let container = group
        if (nested) {
          container = document.createElement('div'); group.append(container)
          api.applyComponentPaintStyle(container, parent, project.definitions[parent.definitionId])
        }
        const content = document.createElement('div'); container.append(content)
        api.applyComponentPaintStyle(content, header, project.definitions[header.definitionId])
        content.append(api.renderTextComponent(document, api.textComponentDataSchema.parse(range ? rangeData : header.data)))
        const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT), result = []
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const style = getComputedStyle(node.parentElement!)
          result.push({ text: node.textContent, color: style.color, fill: style.webkitTextFillColor })
        }
        return result
      }
      const full = paint(false, false), nested = paint(true, false), localRange = paint(true, true)
      const parent = project.instances[fixture.parentId]!, definition = project.definitions[parent.definitionId]!
      const special = document.createElement('div'), source = document.createElement('div')
      api.applyComponentPaintStyle(special, { ...parent, style: { ...parent.style, '-webkit-text-fill-color': '#00ff00' } }, definition)
      api.applyComponentPaintStyle(source, { ...parent, implementationOverride: { kind: 'source', source: 'export default {}' } }, definition)
      return { full, nested, localRange, specialFill: special.style.webkitTextFillColor, sourceFill: source.style.webkitTextFillColor }
    }, { fixture: actual, rangeData: actualRanges } as unknown)
    const blueHeader = [{ text: '调节条件，看计算怎样改变', color: 'rgb(59, 130, 246)', fill: 'rgb(59, 130, 246)' }]
    expect(ancestors.full).toEqual(blueHeader)
    expect(ancestors.nested).toEqual(blueHeader)
    expect(ancestors.localRange).toEqual([{ text: '调节', color: 'rgb(210, 38, 107)', fill: 'rgb(210, 38, 107)' },
      { text: '条件，看计算怎样改变', color: 'rgb(59, 130, 246)', fill: 'rgb(59, 130, 246)' }])
    expect(ancestors.specialFill).toBe('rgb(0, 255, 0)')
    expect(ancestors.sourceFill).toBe('rgb(23, 49, 62)')
    const html = '<p id="p" data-id="p" style="color:#172331">First <em>neighbor</em> Last</p>'
    const observed = await page.evaluate(html => {
      const api = (window as any).FormatProbe, root = document.querySelector<HTMLElement>('#html')!
      root.innerHTML = html
      const authoring = api.createDomAuthoring(root, { records: () => ({}) })
      const values = authoring.scan(), value = values.find((value: any) => value.initialValue === 'First '), suffix = values.find((value: any) => value.initialValue === ' Last')
      const result = { authorKey: value.authorKey, binding: value.record.binding, scope: value.record.scope, textStyle: value.textStyle, initialValue: value.initialValue,
        suffix: { key: suffix.authorKey, record: { ...suffix.record, overrides: { text: ' End' } } } }
      authoring.dispose()
      return result
    }, html)
    const web = createBlankCourseProjectV10('mixed leaf')
    web.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
    web.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html } }
    web.instances.web.authoring = { records: { [observed.authorKey]: { kind: 'text', binding: observed.binding, scope: observed.scope, overrides: { text: 'Changed ' } }, [observed.suffix.key]: observed.suffix.record } }
    testContainerInstance(web, 0).childIds = ['web']
    const spot: ComponentAuthorSpot = { ...observed, initialValue: 'Changed ', id: 'spot', kind: 'text', instanceId: 'web', mountGeneration: 1,
      bindingStatus: 'bound', localBounds: { width: 30, height: 20, transform: [1, 0, 0, 1, 0, 0] },
      fieldScope: 'authoring', dataPath: ['records', observed.authorKey, 'overrides', 'text'] }
    const local = applyComponentOperation(web, captureComponentOperation(web, authorSpotStyleEdits(web, spot, { color, 'font-weight': '700', 'font-family': 'SimSun' })))
    const reopened = driver.load(driver.serialize({ kind: 'course-v10', project: local, resources: { assets: {}, components: {} } }))
    if (reopened.kind !== 'course-v10') throw new Error('Expected course')
    const localResult = await page.evaluate((value: unknown) => {
      const instance = value as typeof next
      const api = (window as any).FormatProbe, root = document.querySelector<HTMLElement>('#html')!
      root.innerHTML = (instance.data as any).html
      const authoring = api.createDomAuthoring(root, { records: () => instance.authoring!.records })
      authoring.refresh()
      const leaf = root.querySelector('span')!, neighbor = root.querySelector('em')!, paragraph = root.querySelector('p')!
      const result = { text: paragraph.textContent, leaf: { color: getComputedStyle(leaf).color, weight: getComputedStyle(leaf).fontWeight,
        family: getComputedStyle(leaf).fontFamily }, neighbor: { text: neighbor.textContent, color: getComputedStyle(neighbor).color,
        tag: neighbor.tagName }, parentColor: getComputedStyle(paragraph).color, records: authoring.scan().map((value: any) => ({ value: value.initialValue, key: value.authorKey, status: value.bindingStatus })) }
      authoring.dispose()
      return result
    }, reopened.project.instances.web as unknown)
    expect(localResult.text).toBe('Changed neighbor End')
    expect(localResult.leaf).toEqual({ color: 'rgb(210, 38, 107)', weight: '700', family: 'SimSun' })
    expect(localResult.neighbor).toEqual({ text: 'neighbor', color: 'rgb(23, 35, 49)', tag: 'EM' })
    expect(localResult.parentColor).toBe('rgb(23, 35, 49)')
    expect(localResult.records).toContainEqual({ value: 'Changed ', key: spot.authorKey, status: 'bound' })
    expect(localResult.records).toContainEqual({ value: ' End', key: observed.suffix.key, status: 'bound' })
    const svgHtml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 220"><path id="arrow" d="M20 90L440 90" stroke="#172331"/><text data-id="roof" x="20" y="40" fill="#276e57">屋顶/走道</text><text x="200" y="140" fill="#276e57">未硬化土壤</text><text x="310" y="190" fill="#276e57">可能地表流动</text></svg>'
    const svgObservation = await page.evaluate(html => {
      const api = (window as any).FormatProbe, root = document.querySelector<HTMLElement>('#html')!
      root.innerHTML = html
      const authoring = api.createDomAuthoring(root, { records: () => ({}) })
      const value = authoring.scan().find((value: any) => value.initialValue === '屋顶/走道')
      const result = { authorKey: value.authorKey, binding: value.record.binding, scope: value.record.scope, textStyle: value.textStyle, initialValue: value.initialValue }
      authoring.dispose(); return result
    }, svgHtml)
    const svgProject = createBlankCourseProjectV10('SVG local text')
    svgProject.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
    svgProject.instances.web = { id: 'web', definitionId: WEB_DEFINITION.id, data: { html: svgHtml } }
    testContainerInstance(svgProject, 0).childIds = ['web']
    const svgStart = svgHtml.indexOf('屋顶/走道'), svgSpot: ComponentAuthorSpot = { ...svgObservation, kind: 'text', id: 'svg-spot', instanceId: 'web', mountGeneration: 1,
      bindingStatus: 'bound', localBounds: spot.localBounds, sourceRegion: { kind: 'data', path: ['html'], start: svgStart, end: svgStart + '屋顶/走道'.length, encoding: 'html-text' } }
    const renamedSvg = applyComponentOperation(svgProject, captureComponentOperation(svgProject, authorSpotEdits(svgProject, svgSpot, '屋顶与走道', { assets: {}, components: {} })))
    const renamedSpot = { ...svgSpot, initialValue: '屋顶与走道', binding: { ...svgSpot.binding!, baseline: '屋顶与走道' },
      sourceRegion: { ...svgSpot.sourceRegion!, end: svgStart + '屋顶与走道'.length } }
    const svgView = authorSpotFormatView(renamedSvg, renamedSpot)!
    expect(svgView.style.color).toBe('rgb(39, 110, 87)')
    expect(svgView.alignment).toBe(false); expect(svgView.highlight).toBe(false); expect(svgView.lineSpacing).toBe(false)
    const svgEdits = authorSpotStyleEdits(renamedSvg, renamedSpot, authorSpotStylePatch(renamedSpot, svgView, { style: { color, fontFamily: 'SimSun', fontSize: 28, bold: true, italic: true } }))
    const styledSvg = applyComponentOperation(renamedSvg, captureComponentOperation(renamedSvg, svgEdits))
    const reopenedSvg = driver.load(driver.serialize({ kind: 'course-v10', project: styledSvg, resources: { assets: {}, components: {} } }))
    if (reopenedSvg.kind !== 'course-v10') throw new Error('Expected course')
    const svgResult = await page.evaluate((value: unknown) => {
      const instance = value as typeof next, api = (window as any).FormatProbe, root = document.querySelector<HTMLElement>('#html')!
      root.innerHTML = (instance.data as any).html
      const authoring = api.createDomAuthoring(root, { records: () => instance.authoring!.records }); authoring.refresh()
      const target = root.querySelector('tspan')!, style = getComputedStyle(target)
      const result = { tag: target.localName, namespace: target.namespaceURI, text: target.textContent,
        fill: style.fill, family: style.fontFamily, weight: style.fontWeight, italic: style.fontStyle, size: style.fontSize,
        neighbors: [...root.querySelectorAll('text')].slice(1).map(node => ({ text: node.textContent, fill: getComputedStyle(node).fill })),
        path: root.querySelector('#arrow')!.getAttribute('d'), statuses: authoring.scan().map((value: any) => ({ text: value.initialValue, status: value.bindingStatus })) }
      authoring.dispose(); return result
    }, reopenedSvg.project.instances.web as unknown)
    expect(svgResult).toEqual({ tag: 'tspan', namespace: 'http://www.w3.org/2000/svg', text: '屋顶与走道', fill: 'rgb(210, 38, 107)', family: 'SimSun', weight: '700', italic: 'italic', size: '28px',
      neighbors: [{ text: '未硬化土壤', fill: 'rgb(39, 110, 87)' }, { text: '可能地表流动', fill: 'rgb(39, 110, 87)' }], path: 'M20 90L440 90',
      statuses: [{ text: '屋顶与走道', status: 'bound' }, { text: '未硬化土壤', status: 'bound' }, { text: '可能地表流动', status: 'bound' }] })
    await writeFile(`${output}/paint-facts.json`, JSON.stringify({ native, ancestors, local: localResult, svg: svgResult }, null, 2))
  } finally { await browser.close() }
}, 30_000)
