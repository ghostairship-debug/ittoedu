import type { ReactNode } from 'react'

/** Precision consumers prepare their own current text before measuring. */
export function BundledFontBoundary({ children }: { children: ReactNode }) {
  return children
}
