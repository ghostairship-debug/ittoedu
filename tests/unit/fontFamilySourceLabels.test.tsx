/**
 * The font picker offers two classes of font with two different bills, so it
 * has to say which is which and what each one costs. These tests pin the
 * labelling, the grouping order and the availability probe for the families we
 * ship — the picker is a public entry point, and a silent choice here turns
 * into a lesson that reflows on another teacher's machine.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUNDLED_FONT_FAMILIES,
  BUNDLED_TEXT_FONT_FAMILY,
} from '@/shared/fonts/bundledFontFamilies'
import { selectActiveScene, useEditorStore } from '@/renderer/store/editorStore'
import {
  detectFontAvailability,
  FONT_FAMILY_OPTIONS,
  FONT_FAMILY_SOURCE_TAGS,
  fontFamilySource,
} from '@/renderer/ui/properties/PropertyControls'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'

/** A system family every option list carries, used as the `system` control. */
const SYSTEM_FAMILY = 'Microsoft YaHei'

/**
 * Stand in for `document.fonts` with the behaviour measured in Chromium: a
 * bundled family answers `true` once its faces are loaded, and the query is
 * always the quoted family plus the preview text.
 */
function stubFontFaceSet(check: (font: string, text?: string) => boolean) {
  const spy = vi.fn(check)
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { check: spy },
  })
  return spy
}

let originalFonts: PropertyDescriptor | undefined

beforeEach(() => {
  originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts')
  useEditorStore.getState().createNewProject()
  useEditorStore.setState({ editorMode: 'professional' })
})

afterEach(() => {
  cleanup()
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts)
  else Reflect.deleteProperty(document, 'fonts')
  vi.restoreAllMocks()
})

describe('font family source classification', () => {
  it('classifies every bundled family as bundled and the rest as system', () => {
    for (const family of BUNDLED_FONT_FAMILIES) {
      expect(fontFamilySource(family)).toBe('bundled')
    }
    expect(fontFamilySource(SYSTEM_FAMILY)).toBe('system')
    expect(fontFamilySource('sans-serif')).toBe('system')
    expect(fontFamilySource('Custom Legacy Font, sans-serif')).toBe('system')
  })

  it('states a cost for both classes', () => {
    expect(FONT_FAMILY_SOURCE_TAGS.bundled.cost).toMatch(/嵌入/)
    expect(FONT_FAMILY_SOURCE_TAGS.bundled.cost).toMatch(/文件更大/)
    expect(FONT_FAMILY_SOURCE_TAGS.system.cost).toMatch(/不嵌入/)
    expect(FONT_FAMILY_SOURCE_TAGS.system.cost).toMatch(/变样/)
  })

  it('offers the bundled families before the system ones', () => {
    const bundledCount = FONT_FAMILY_OPTIONS.filter(
      (option) => fontFamilySource(option.family) === 'bundled',
    ).length
    expect(bundledCount).toBeGreaterThan(0)
    expect(
      FONT_FAMILY_OPTIONS.slice(0, bundledCount).every(
        (option) => fontFamilySource(option.family) === 'bundled',
      ),
    ).toBe(true)
    // The catalog itself must stay intact: grouping reorders, never drops.
    expect(FONT_FAMILY_OPTIONS).toHaveLength(new Set(
      FONT_FAMILY_OPTIONS.map((option) => option.family),
    ).size)
    expect(FONT_FAMILY_OPTIONS.some((option) => option.family === SYSTEM_FAMILY)).toBe(true)
  })
})

describe('font family availability probe', () => {
  it('reports a loaded bundled family as available through the quoted query', () => {
    const check = stubFontFaceSet((font) => font === `16px "${BUNDLED_TEXT_FONT_FAMILY}"`)
    expect(detectFontAvailability(BUNDLED_TEXT_FONT_FAMILY)).toBe('available')
    expect(check).toHaveBeenCalledWith(
      `16px "${BUNDLED_TEXT_FONT_FAMILY}"`,
      '中文字体预览 Aa 123',
    )
  })

  it('keeps reporting an unloaded bundled family as unavailable', () => {
    stubFontFaceSet(() => false)
    expect(detectFontAvailability(BUNDLED_TEXT_FONT_FAMILY)).toBe('unavailable')
  })
})

describe('font family picker labelling', () => {
  function openFontList() {
    const store = useEditorStore.getState()
    store.addTextNode()
    expect(selectActiveScene(useEditorStore.getState()).nodes).toHaveLength(1)
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    fireEvent.focus(screen.getByRole('combobox', { name: '字体' }))
    return screen.getByRole('listbox', { name: '常用字体' })
  }

  it('tags each option with its class and shows the cost of both groups', () => {
    stubFontFaceSet((font) => font.includes(BUNDLED_TEXT_FONT_FAMILY))
    const listbox = openFontList()

    const bundled = screen.getByRole('option', {
      name: new RegExp(`${BUNDLED_TEXT_FONT_FAMILY}，内置字体，可用$`),
    })
    const system = screen.getByRole('option', {
      name: new RegExp(`${SYSTEM_FAMILY}，系统字体，未安装$`),
    })
    expect(bundled).toHaveAttribute('data-font-source', 'bundled')
    expect(bundled).toHaveAttribute('title', FONT_FAMILY_SOURCE_TAGS.bundled.cost)
    expect(system).toHaveAttribute('data-font-source', 'system')
    expect(system).toHaveAttribute('title', FONT_FAMILY_SOURCE_TAGS.system.cost)
    expect(bundled).toHaveTextContent(FONT_FAMILY_SOURCE_TAGS.bundled.badge)
    expect(system).toHaveTextContent(FONT_FAMILY_SOURCE_TAGS.system.badge)

    const bundledGroup = screen.getByTestId('font-family-group-bundled')
    const systemGroup = screen.getByTestId('font-family-group-system')
    expect(bundledGroup).toHaveTextContent(FONT_FAMILY_SOURCE_TAGS.bundled.cost)
    expect(systemGroup).toHaveTextContent(FONT_FAMILY_SOURCE_TAGS.system.cost)
    expect(
      bundledGroup.compareDocumentPosition(systemGroup) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(listbox).toContainElement(bundledGroup)

    // Each class is announced once, not per option.
    expect(screen.getAllByTestId('font-family-group-bundled')).toHaveLength(1)
    expect(screen.getAllByTestId('font-family-group-system')).toHaveLength(1)
  })

  it('repeats the cost of whichever class survives filtering', () => {
    stubFontFaceSet(() => true)
    openFontList()
    fireEvent.change(screen.getByRole('combobox', { name: '字体' }), {
      target: { value: 'Kai' },
    })

    expect(screen.queryByTestId('font-family-group-bundled')).not.toBeInTheDocument()
    expect(screen.getByTestId('font-family-group-system')).toHaveTextContent(
      FONT_FAMILY_SOURCE_TAGS.system.cost,
    )
  })
})
