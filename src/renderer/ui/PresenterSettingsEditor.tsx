import { nanoid } from 'nanoid'
import { useEffect, useMemo, useState } from 'react'
import type {
  PresenterCommand,
  PresenterKeyBinding,
  ProjectPresenterSettings,
} from '../../shared/contracts/playback-v1'

interface DetectedKey {
  key: string
  code: string
  altKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  metaKey: boolean
  repeat: boolean
}

export interface PresenterSettingsEditorProps {
  value: Readonly<ProjectPresenterSettings>
  onChange(value: ProjectPresenterSettings): void
}

function bindingSignature(
  binding: Pick<
    PresenterKeyBinding,
    'key' | 'altKey' | 'ctrlKey' | 'shiftKey' | 'metaKey'
  >,
): string {
  return [
    binding.key,
    binding.altKey,
    binding.ctrlKey,
    binding.shiftKey,
    binding.metaKey,
  ].join('\0')
}

function modifierLabels(binding: DetectedKey | PresenterKeyBinding): string[] {
  return [
    binding.ctrlKey ? 'Ctrl' : '',
    binding.altKey ? 'Alt' : '',
    binding.shiftKey ? 'Shift' : '',
    binding.metaKey ? 'Meta' : '',
  ].filter(Boolean)
}

function displayBinding(binding: DetectedKey | PresenterKeyBinding): string {
  return [...modifierLabels(binding), binding.key].join(' + ')
}

function commandLabel(command: PresenterCommand): string {
  return command === 'next' ? '前进' : '后退'
}

function standardPresenterCommand(binding: DetectedKey): PresenterCommand | null {
  if (
    binding.altKey ||
    binding.ctrlKey ||
    binding.shiftKey ||
    binding.metaKey
  ) return null
  if (binding.key === 'PageDown') return 'next'
  if (binding.key === 'PageUp') return 'previous'
  return null
}

export function PresenterSettingsEditor({
  value,
  onChange,
}: PresenterSettingsEditorProps) {
  const [detecting, setDetecting] = useState(false)
  const [detected, setDetected] = useState<DetectedKey | null>(null)
  const detectedSignature = detected ? bindingSignature(detected) : null
  const existingDetectedBinding = useMemo(
    () => value.additionalBindings.find(
      (binding) => bindingSignature(binding) === detectedSignature,
    ),
    [detectedSignature, value.additionalBindings],
  )

  useEffect(() => {
    if (!detecting) return undefined
    const capture = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setDetecting(false)
        return
      }
      setDetected({
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        repeat: event.repeat,
      })
      if (!event.repeat) setDetecting(false)
    }
    window.addEventListener('keydown', capture, true)
    return () => window.removeEventListener('keydown', capture, true)
  }, [detecting])

  const update = (patch: Partial<ProjectPresenterSettings>): void => {
    onChange({ ...value, ...patch })
  }

  const saveDetected = (command: PresenterCommand): void => {
    if (!detected || detected.repeat) return
    if (standardPresenterCommand(detected)) return
    const nextBinding: PresenterKeyBinding = {
      id: existingDetectedBinding?.id ?? `presenter_binding_${nanoid(10)}`,
      command,
      key: detected.key,
      altKey: detected.altKey,
      ctrlKey: detected.ctrlKey,
      shiftKey: detected.shiftKey,
      metaKey: detected.metaKey,
    }
    update({
      additionalBindings: existingDetectedBinding
        ? value.additionalBindings.map((binding) =>
            binding.id === existingDetectedBinding.id ? nextBinding : binding,
          )
        : [...value.additionalBindings, nextBinding],
    })
  }

  const standardCommand = detected ? standardPresenterCommand(detected) : null

  return (
    <div className="presenter-settings" data-testid="presenter-settings">
      <div className="toggle-row">
        <span>启用翻页笔 PageUp/PageDown</span>
        <label className="toggle">
          <input
            type="checkbox"
            aria-label="启用翻页笔 PageUp/PageDown"
            checked={value.enabled}
            onChange={(event) => update({ enabled: event.currentTarget.checked })}
          />
          <span className="toggle-track" />
        </label>
      </div>
      <div className="form-field">
        <label htmlFor="presenter-strategy">翻页笔推进方式</label>
        <select
          id="presenter-strategy"
          className="form-input"
          aria-label="翻页笔推进方式"
          value={value.strategy}
          disabled={!value.enabled}
          onChange={(event) => update({
            strategy: event.currentTarget.value as ProjectPresenterSettings['strategy'],
          })}
        >
          <option value="scene-navigation">相邻场景导航</option>
          <option value="authored-command">只触发作者规则</option>
        </select>
      </div>
      <p className="property-hint">
        PageDown/PageUp 始终是标准前进/后退键。选择“只触发作者规则”后，没有显式规则时不会自动切幕。
      </p>
      <button
        type="button"
        className="secondary-button"
        disabled={!value.enabled}
        aria-pressed={detecting}
        onClick={() => {
          setDetected(null)
          setDetecting((current) => !current)
        }}
      >
        {detecting ? '等待按键…（Esc 取消）' : '测试或添加翻页笔按键'}
      </button>
      {detected ? (
        <div className="presenter-key-result" role="status" aria-live="polite">
          <strong>收到：{displayBinding(detected)}</strong>
          <small>
            key={detected.key}；code={detected.code || '未提供'}；repeat={String(detected.repeat)}
          </small>
          {standardCommand ? (
            <p className="property-hint">
              已识别为内建“{commandLabel(standardCommand)}”键，无需额外保存。
            </p>
          ) : (
            <div className="property-inline-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={detected.repeat || (
                  !existingDetectedBinding && value.additionalBindings.length >= 32
                )}
                onClick={() => saveDetected('next')}
              >
                保存为前进键
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={detected.repeat || (
                  !existingDetectedBinding && value.additionalBindings.length >= 32
                )}
                onClick={() => saveDetected('previous')}
              >
                保存为后退键
              </button>
            </div>
          )}
          {detected.key === 'F5' ? (
            <p className="property-hint">F5 可能被浏览器用于刷新，不建议作为演示绑定。</p>
          ) : null}
        </div>
      ) : null}
      {value.additionalBindings.length > 0 ? (
        <div className="presenter-binding-list" aria-label="翻页笔附加按键">
          {value.additionalBindings.map((binding) => (
            <div className="presenter-binding-row" key={binding.id}>
              <span>{displayBinding(binding)} → {commandLabel(binding.command)}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`删除附加按键 ${displayBinding(binding)}`}
                onClick={() => update({
                  additionalBindings: value.additionalBindings.filter(
                    (candidate) => candidate.id !== binding.id,
                  ),
                })}
              >
                删除
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
