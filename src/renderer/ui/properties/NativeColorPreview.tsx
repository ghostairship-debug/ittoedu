import { createContext, useContext } from 'react'
import { ColorInput, type ColorInputProps } from '../ColorInput'
import type { PropertiesPatch } from './SlideNativePropertiesPanel'

export const NativeColorPreviewContext = createContext<((patch: PropertiesPatch | null) => void) | undefined>(undefined)

export function NativeColorInput({ previewPatch, ...props }: ColorInputProps & {
  previewPatch: (color: string) => PropertiesPatch
}) {
  const preview = useContext(NativeColorPreviewContext)
  return <ColorInput {...props} onPreviewChange={props.onPreviewChange ?? (preview
    ? color => preview(color === null ? null : previewPatch(color)) : undefined)} />
}
