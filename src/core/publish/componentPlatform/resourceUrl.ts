const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Works in browser and headless producers without Node or renderer imports. */
export function componentAssetDataUrl(bytes: Uint8Array, mimeType = 'application/octet-stream'): string {
  let encoded = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const value = (bytes[index]! << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0)
    encoded += alphabet[(value >>> 18) & 63]! + alphabet[(value >>> 12) & 63]!
      + (index + 1 < bytes.length ? alphabet[(value >>> 6) & 63]! : '=')
      + (index + 2 < bytes.length ? alphabet[value & 63]! : '=')
  }
  return `data:${mimeType};base64,${encoded}`
}
