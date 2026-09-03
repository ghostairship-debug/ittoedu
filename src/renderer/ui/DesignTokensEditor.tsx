import { Plus, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { useEffect, useState } from 'react'
import type { ProjectDesignTokens } from '../../shared/contracts/design-v1/types'
import { ColorInput } from './ColorInput'

interface DesignTokensEditorProps {
  value: ProjectDesignTokens
  onChange(value: ProjectDesignTokens): void
}

const MAX_FONT_TOKENS = 16
const MAX_COLOR_TOKENS = 32

function BufferedTokenInput({
  label,
  value,
  tokenId = false,
  onCommit,
}: {
  label: string
  value: string
  tokenId?: boolean
  onCommit(value: string): void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const next = draft.trim()
    if (!next || (tokenId && !/^[a-z][a-z0-9._-]*$/.test(next))) {
      setDraft(value)
      return
    }
    if (next !== value) onCommit(next)
  }
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        className="form-input"
        aria-label={label}
        value={draft}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setDraft(value)
            event.currentTarget.blur()
          }
        }}
      />
    </div>
  )
}

function nextTokenId(prefix: 'font' | 'color'): string {
  const suffix = nanoid(8).toLowerCase().replace(/[^a-z0-9]/g, '') || 'token'
  return `${prefix}_${suffix}`
}

export function DesignTokensEditor({ value, onChange }: DesignTokensEditorProps) {
  const replaceFont = (
    index: number,
    patch: Partial<ProjectDesignTokens['fonts'][number]>,
  ) => onChange({
    ...value,
    fonts: value.fonts.map((token, tokenIndex) => (
      tokenIndex === index ? { ...token, ...patch } : token
    )),
  })
  const replaceColor = (
    index: number,
    patch: Partial<ProjectDesignTokens['colors'][number]>,
  ) => onChange({
    ...value,
    colors: value.colors.map((token, tokenIndex) => (
      tokenIndex === index ? { ...token, ...patch } : token
    )),
  })

  return (
    <section className="property-section design-tokens-editor">
      <h3 className="property-title">字体与色板 Token</h3>
      <p className="property-hint">
        只保存稳定 ID、名称和值，供人类和 AI 统一取色与字体；不承载叙述性美术方向，也不会自动改写已有节点。
      </p>
      <div className="property-subsection-header">
        <strong>字体</strong>
        <button
          type="button"
          className="secondary-button"
          disabled={value.fonts.length >= MAX_FONT_TOKENS}
          onClick={() => onChange({
            ...value,
            fonts: [...value.fonts, {
              id: nextTokenId('font'),
              label: `字体 ${value.fonts.length + 1}`,
              fontFamily: '"Microsoft YaHei", sans-serif',
            }],
          })}
        >
          <Plus size={14} />添加字体
        </button>
      </div>
      {value.fonts.map((token, index) => (
        <div className="design-token-card" key={token.id}>
          <BufferedTokenInput
            label={`字体 Token ${index + 1} ID`}
            value={token.id}
            tokenId
            onCommit={(id) => replaceFont(index, { id })}
          />
          <BufferedTokenInput
            label={`字体 Token ${index + 1} 名称`}
            value={token.label}
            onCommit={(label) => replaceFont(index, { label })}
          />
          <BufferedTokenInput
            label={`字体 Token ${index + 1} 字体族`}
            value={token.fontFamily}
            onCommit={(fontFamily) => replaceFont(index, { fontFamily })}
          />
          <button
            type="button"
            className="icon-button design-token-card__remove"
            aria-label={`删除字体 Token ${token.label}`}
            disabled={value.fonts.length <= 1}
            onClick={() => onChange({
              ...value,
              fonts: value.fonts.filter((_, tokenIndex) => tokenIndex !== index),
            })}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}

      <div className="property-subsection-header">
        <strong>色板</strong>
        <button
          type="button"
          className="secondary-button"
          disabled={value.colors.length >= MAX_COLOR_TOKENS}
          onClick={() => onChange({
            ...value,
            colors: [...value.colors, {
              id: nextTokenId('color'),
              label: `颜色 ${value.colors.length + 1}`,
              color: '#64748b',
            }],
          })}
        >
          <Plus size={14} />添加颜色
        </button>
      </div>
      {value.colors.map((token, index) => (
        <div className="design-token-card design-token-card--color" key={token.id}>
          <BufferedTokenInput
            label={`颜色 Token ${index + 1} ID`}
            value={token.id}
            tokenId
            onCommit={(id) => replaceColor(index, { id })}
          />
          <BufferedTokenInput
            label={`颜色 Token ${index + 1} 名称`}
            value={token.label}
            onCommit={(label) => replaceColor(index, { label })}
          />
          <ColorInput
            id={`design-token-color-${token.id}`}
            label={`颜色 Token ${index + 1} 色值`}
            value={token.color}
            onChange={(color) => replaceColor(index, { color })}
          />
          <button
            type="button"
            className="icon-button design-token-card__remove"
            aria-label={`删除颜色 Token ${token.label}`}
            disabled={value.colors.length <= 1}
            onClick={() => onChange({
              ...value,
              colors: value.colors.filter((_, tokenIndex) => tokenIndex !== index),
            })}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
    </section>
  )
}
