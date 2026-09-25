/** Main-only injectable boundary; there is deliberately no plaintext or environment fallback. */
export interface CredentialEncryptionPort {
  isEncryptionAvailable(): boolean | Promise<boolean>
  encryptString(plaintext: string): Uint8Array | Promise<Uint8Array>
  decryptString(ciphertext: Uint8Array): string | Promise<string>
}

/** Call after app.whenReady(). Dynamic loading keeps the storage repository usable headlessly. */
export async function createElectronCredentialEncryption(): Promise<CredentialEncryptionPort> {
  const { safeStorage } = await import('electron')
  const available = async () => {
    // Electron's basic_text backend is not a secure credential store.
    if (process.platform === 'linux' && ['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())) return false
    return safeStorage.isAsyncEncryptionAvailable()
  }
  return {
    isEncryptionAvailable: available,
    async encryptString(plaintext) {
      if (!(await available())) throw new Error('系统安全凭据存储不可用')
      return safeStorage.encryptStringAsync(plaintext)
    },
    async decryptString(ciphertext) {
      if (!(await available())) throw new Error('系统安全凭据存储不可用')
      return (await safeStorage.decryptStringAsync(Buffer.from(ciphertext))).result
    },
  }
}
