import { describe, expect, it } from 'vitest'
import { PreviewNetworkPolicy } from '@/main/previewNetworkPolicy'

describe('PreviewNetworkPolicy', () => {
  it('unions active leases and revokes them without removing base origins', () => {
    const policy = new PreviewNetworkPolicy()
    policy.replaceBaseOrigins(['http://127.0.0.1:5173', 'ws://127.0.0.1:5173'])
    policy.replacePreviewLease({
      leaseId: 'preview-a',
      connectOrigins: ['https://api.example.com', 'wss://live.example.com:8443'],
      remoteAssetUrls: ['https://cdn.example.com/course/image.png?rev=1'],
    })
    policy.replacePreviewLease({
      leaseId: 'preview-b',
      connectOrigins: ['https://b.example.com'],
      remoteAssetUrls: [],
    })

    expect(policy.allowsRequest('https://api.example.com/v1/data')).toBe(true)
    expect(policy.allowsRequest('wss://live.example.com:8443/socket')).toBe(true)
    expect(policy.allowsRequest('https://cdn.example.com/course/image.png')).toBe(true)
    expect(policy.allowsRequest('https://b.example.com/status')).toBe(true)
    expect(policy.allowsRequest('https://undeclared.example.com/')).toBe(false)

    policy.releasePreviewLease('preview-a')

    expect(policy.allowsRequest('https://api.example.com/v1/data')).toBe(false)
    expect(policy.allowsRequest('wss://live.example.com:8443/socket')).toBe(false)
    expect(policy.allowsRequest('https://cdn.example.com/course/image.png')).toBe(false)
    expect(policy.allowsRequest('https://b.example.com/status')).toBe(true)
    expect(policy.allowsRequest('http://127.0.0.1:5173/assets/app.js')).toBe(true)
    expect(policy.allowsRequest('ws://127.0.0.1:5173/hmr')).toBe(true)

    policy.clearPreviewLeases()
    expect(policy.allowsRequest('https://b.example.com/status')).toBe(false)
    expect(policy.allowsRequest('http://127.0.0.1:5173/base-probe')).toBe(true)
  })

  it.each([
    'https://*.example.com',
    'https://user:secret@example.com',
    'https://api.example.com/path',
    'https://api.example.com?query=1',
    'https://api.example.com/',
    'http://api.example.com',
    'wss://live.example.com/socket',
  ])('rejects non-contract connect origin %s atomically', (invalidOrigin) => {
    const policy = new PreviewNetworkPolicy()
    policy.replacePreviewLease({
      leaseId: 'preview-a',
      connectOrigins: ['https://safe.example.com'],
      remoteAssetUrls: [],
    })

    expect(() => policy.replacePreviewLease({
      leaseId: 'preview-a',
      connectOrigins: ['https://expanded.example.com', invalidOrigin],
      remoteAssetUrls: [],
    })).toThrow()

    expect(policy.allowsRequest('https://safe.example.com/data')).toBe(true)
    expect(policy.allowsRequest('https://expanded.example.com/data')).toBe(false)
  })

  it.each([
    'http://cdn.example.com/image.png',
    'https://user:secret@cdn.example.com/image.png',
    'https://*.example.com/image.png',
  ])('rejects invalid remote asset URL %s without expanding the lease', (invalidUrl) => {
    const policy = new PreviewNetworkPolicy()
    policy.replacePreviewLease({
      leaseId: 'preview-a',
      connectOrigins: [],
      remoteAssetUrls: ['https://safe-cdn.example.com/image.png'],
    })

    expect(() => policy.replacePreviewLease({
      leaseId: 'preview-a',
      connectOrigins: [],
      remoteAssetUrls: ['https://expanded.example.com/image.png', invalidUrl],
    })).toThrow()

    expect(policy.allowsRequest('https://safe-cdn.example.com/image.png')).toBe(true)
    expect(policy.allowsRequest('https://expanded.example.com/image.png')).toBe(false)
  })
})
