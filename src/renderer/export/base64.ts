const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    // A multiple of three prevents padding from appearing between chunks.
    const chunkSize = 24_576
    let output = ''
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const end = Math.min(offset + chunkSize, bytes.length)
      let binary = ''
      for (let index = offset; index < end; index += 1) {
        binary += String.fromCharCode(bytes[index] ?? 0)
      }
      output += globalThis.btoa(binary)
    }
    return output
  }

  let output = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const packed = (first << 16) | (second << 8) | third

    output += BASE64_ALPHABET[(packed >>> 18) & 63]
    output += BASE64_ALPHABET[(packed >>> 12) & 63]
    output += index + 1 < bytes.length ? BASE64_ALPHABET[(packed >>> 6) & 63] : '='
    output += index + 2 < bytes.length ? BASE64_ALPHABET[packed & 63] : '='
  }

  return output
}

export function jsonToBase64(value: unknown): string {
  return bytesToBase64(new TextEncoder().encode(JSON.stringify(value)))
}

export function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`
}

/** Portable Builder context encoding; strings are UTF-8 in both hosts. */
export function encodeBase64(value: Uint8Array | string): string {
  return bytesToBase64(typeof value === 'string' ? new TextEncoder().encode(value) : value)
}
