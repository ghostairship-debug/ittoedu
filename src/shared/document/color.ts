export interface DocumentColorChannels { red: number; green: number; blue: number; alpha: number }

const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(%?)$/i
const channel = (value: string, scale: number): number | undefined => {
  const match = number.exec(value.trim())
  if (!match) return undefined
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(scale, match[1] ? parsed * scale / 100 : parsed)) : undefined
}

/** CSS RGB/alpha forms used by the existing document text parser and renderers. */
export function documentColorChannels(value: string): DocumentColorChannels | undefined {
  const text = value.trim()
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(text)
  if (hex) {
    const full = hex[1]!.length < 5 ? [...hex[1]!].map(character => character + character).join('') : hex[1]!
    return { red: parseInt(full.slice(0, 2), 16), green: parseInt(full.slice(2, 4), 16),
      blue: parseInt(full.slice(4, 6), 16), alpha: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1 }
  }
  if (text.toLowerCase() === 'transparent') return { red: 0, green: 0, blue: 0, alpha: 0 }
  const rgb = /^rgba?\(([^()]*)\)$/i.exec(text)
  if (!rgb) return undefined
  const body = rgb[1]!, comma = body.includes(',')
  const parts = comma ? body.split(',').map(part => part.trim()) : body.split('/').map(part => part.trim())
  if (comma && (parts.length < 3 || parts.length > 4) || !comma && parts.length > 2) return undefined
  const channels = comma ? parts.slice(0, 3) : parts[0]!.split(/\s+/)
  if (channels.length !== 3) return undefined
  const [red, green, blue] = channels.map(part => channel(part, 255))
  const alphaSource = comma ? parts[3] : parts[1]
  const alpha = alphaSource === undefined ? 1 : channel(alphaSource, 1)
  if (red === undefined || green === undefined || blue === undefined || alpha === undefined) return undefined
  return { red, green, blue, alpha }
}

/** Keep exact numeric alpha; byte alpha is retained when the author used hex. */
export function normalizeDocumentColor(value: string): string | undefined {
  const channels = documentColorChannels(value)
  if (!channels) return undefined
  const text = value.trim()
  if (/^#[\da-f]{6}$/i.test(text)) return text
  if (/^#[\da-f]{3}$/i.test(text)) return `#${[...text.slice(1)].map(character => character + character).join('')}`
  if (/^#[\da-f]{4}$/i.test(text)) return `#${[...text.slice(1)].map(character => character + character).join('')}`
  if (/^#[\da-f]{8}$/i.test(text)) return text
  const { red, green, blue, alpha } = channels
  if (alpha === 1 && [red, green, blue].every(Number.isInteger)) return `#${[red, green, blue].map(value => value.toString(16).padStart(2, '0')).join('')}`
  return `rgba(${red},${green},${blue},${alpha})`
}

/** Native file formats consume RGB plus alpha separately, from the same parse. */
export function parseDocumentColor(value: string): { rgb: string; alpha: number } | undefined {
  const channels = documentColorChannels(value)
  if (!channels) return undefined
  return { rgb: [channels.red, channels.green, channels.blue].map(value => Math.round(value).toString(16).padStart(2, '0')).join('').toUpperCase(), alpha: channels.alpha }
}
