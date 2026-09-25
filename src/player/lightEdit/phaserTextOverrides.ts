import type * as PhaserTypes from 'phaser'
import { normalizeLightEditText, type LightEditTextOverride } from '../../shared/contracts/runtime/lightEdit'
import { isLiveComputedText, lightEditRuleMap, matchLightEditRule, recordTextWrite } from './domTextOverrides'

/** Phaser text has no DOM ancestry; every Text object of one Runtime shares this region. */
export const PHASER_TEXT_REGION = 'phaser'

type PhaserText = PhaserTypes.GameObjects.Text

interface WrappedText {
  /** Text as the Runtime set it. */
  raw: string
  /** Times the Runtime changed it, newest last. */
  writes: number[]
  apply(): void
  restore(): void
}

export interface PhaserTextSample {
  readonly text: PhaserText
  readonly original: string
  readonly shown: string
  readonly rule: LightEditTextOverride | undefined
  readonly live: boolean
}

function rawText(value: unknown): string {
  if (Array.isArray(value)) return value.join('\n')
  return value || value === 0 ? String(value) : ''
}

/**
 * Applies light-edit rules to Phaser Text objects a Runtime creates. Each Text is wrapped
 * once: the Runtime's own setText calls are recorded as its text and shown through the rules.
 */
export class PhaserTextOverrides {
  private readonly wrapped = new Map<PhaserText, WrappedText>()
  private rules: Map<string, LightEditTextOverride>
  private destroyed = false

  constructor(
    private readonly collect: () => Iterable<PhaserTypes.GameObjects.GameObject>,
    private readonly isText: (object: PhaserTypes.GameObjects.GameObject) => object is PhaserText,
    rules: readonly LightEditTextOverride[],
  ) {
    this.rules = lightEditRuleMap(rules)
  }

  setRules(rules: readonly LightEditTextOverride[]): void {
    if (this.destroyed) return
    this.rules = lightEditRuleMap(rules)
    for (const entry of this.wrapped.values()) entry.apply()
  }

  /** Wrap Text objects created since the last scan; returns whether any appeared or left. */
  scan(): boolean {
    if (this.destroyed) return false
    let changed = false
    const alive = new Set<PhaserText>()
    for (const object of this.collect()) {
      if (!this.isText(object)) continue
      alive.add(object)
      if (!this.wrapped.has(object)) { this.wrap(object); changed = true }
    }
    for (const text of [...this.wrapped.keys()]) {
      if (!alive.has(text)) { this.wrapped.delete(text); changed = true }
    }
    return changed
  }

  samples(): PhaserTextSample[] {
    return [...this.wrapped].flatMap(([text, entry]) => {
      const original = normalizeLightEditText(entry.raw)
      if (!original || !text.active || !text.visible) return []
      return [{
        text, original,
        shown: normalizeLightEditText(text.text),
        rule: matchLightEditRule(this.rules, original, PHASER_TEXT_REGION),
        live: isLiveComputedText(original, entry.writes),
      }]
    })
  }

  destroy(): void {
    this.destroyed = true
    for (const entry of this.wrapped.values()) entry.restore()
    this.wrapped.clear()
  }

  private wrap(text: PhaserText): void {
    const prototypeSetText = Object.getPrototypeOf(text).setText as PhaserText['setText']
    const entry: WrappedText = {
      raw: rawText(text.text),
      writes: [],
      apply: () => {
        const original = normalizeLightEditText(entry.raw)
        const rule = original ? matchLightEditRule(this.rules, original, PHASER_TEXT_REGION) : undefined
        prototypeSetText.call(text, rule ? rule.text : entry.raw)
      },
      restore: () => {
        Reflect.deleteProperty(text, 'setText')
        if (text.active) prototypeSetText.call(text, entry.raw)
      },
    }
    Object.defineProperty(text, 'setText', {
      configurable: true,
      writable: true,
      value(this: PhaserText, value: string | string[]) {
        const next = rawText(value)
        if (next !== entry.raw) recordTextWrite(entry.writes)
        entry.raw = next
        entry.apply()
        return this
      },
    })
    this.wrapped.set(text, entry)
    entry.apply()
  }
}
