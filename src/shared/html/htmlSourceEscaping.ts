export function escapeHtmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeHtmlAttribute(value: string, quote: '"' | "'" | ''): string {
  const encoded = escapeHtmlText(value)
  if (quote === '"') return encoded.replace(/"/g, '&quot;')
  if (quote === "'") return encoded.replace(/'/g, '&#39;')
  return encoded.replace(/\s/g, match => `&#${match.charCodeAt(0)};`).replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
