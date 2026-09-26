import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AvailableComponentCatalogPackage, ComponentCatalogSnapshot } from '@/shared/componentCatalog'
import type { ComponentPackageData } from '@/shared/componentTypes'
import type { ComponentLibraryPorts } from '@/renderer/app/useComponentLibrary'

const SHA = 'a'.repeat(64)
const probe = vi.hoisted(() => ({ hash: vi.fn(), importPackage: vi.fn() }))
vi.mock('@/core/drivers/codecs/importComponentPackage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/drivers/codecs/importComponentPackage')>()
  return { ...actual, componentPackageSha256: probe.hash, importComponentPackageAsync: probe.importPackage }
})
import { useComponentLibrary } from '@/renderer/app/useComponentLibrary'

const entry = (): AvailableComponentCatalogPackage => ({
  sourceId: 'built-in', sourceLabel: '内置', sourceTrust: 'built-in', packageId: 'com.test.widget', version: '1.0.0', sha256: SHA,
  name: 'Widget', description: 'Widget', subject: [], schoolStage: [], tags: [], packagePath: 'widget.h5component', thumbnailPath: 'widget.png',
  componentSchemaVersion: 4, runtimeApiVersion: 4, renderMode: 'dom', supportedScopes: ['scene'], quality: 'stable', maintainer: 'Test', verifiedCases: [],
})
const packageData = (): ComponentPackageData => ({ manifest: { id: 'com.test.widget', version: '1.0.0' }, provenance: { sha256: SHA, importedAt: '2026-09-27T00:00:00.000Z', sourceLabel: '内置' } }) as ComponentPackageData
const catalog = (items: AvailableComponentCatalogPackage[]): ComponentCatalogSnapshot => ({ sources: [], packages: items, issues: [] })

function harness(selected = entry(), installed: ComponentPackageData | null = null) {
  const identity = { projectId: 'p1', revision: 1, sessionGeneration: 1, locationId: 'L1', surfaceId: 'S1', owner: 'surface', ownerKey: 'S1' }
  let snapshot = catalog([selected])
  const errors: unknown[] = []
  const writes = { insertPackages: vi.fn(), replacePackageAtTarget: vi.fn(), commitStatus: vi.fn() }
  const readCatalogPackage = vi.fn(async () => ({ bytes: new Uint8Array([1, 2]), sha256: SHA }))
  const readInstalledPackages = vi.fn(() => installed ? { [selected.packageId]: installed } : {})
  const ports = {
    ...writes, captureIdentity: () => ({ ...identity }), desktopAvailable: () => true,
    loadCatalog: vi.fn(async () => snapshot), readCatalogPackage, readInstalledPackages,
    runBusy: async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
      try { return await operation() } catch (error) { errors.push(error); return undefined }
    },
    reportError: vi.fn(),
  } as unknown as ComponentLibraryPorts
  const setCatalog = (next: ComponentCatalogSnapshot) => { snapshot = next }
  return { ports, identity, errors, writes, readCatalogPackage, readInstalledPackages, setCatalog }
}

afterEach(() => {
  probe.hash.mockReset()
  probe.importPackage.mockReset()
})

describe('M16 catalog component preparation', () => {
  it('returns an installed matching version and hash without reading or writing', async () => {
    const selected = entry(), installed = packageData(), h = harness(selected, installed)
    const { result } = renderHook(() => useComponentLibrary(h.ports))
    await waitFor(() => expect(result.current.componentCatalog.packages).toHaveLength(1))
    expect(await result.current.prepareCatalogPackage(selected)).toBe(installed)
    expect(h.readCatalogPackage).not.toHaveBeenCalled()
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('reads, hashes and parses an uninstalled package with frozen ID, version and source', async () => {
    const selected = entry(), h = harness(selected), imported = packageData()
    probe.hash.mockResolvedValue(SHA)
    probe.importPackage.mockResolvedValue(imported)
    const { result } = renderHook(() => useComponentLibrary(h.ports))
    await waitFor(() => expect(result.current.componentCatalog.packages).toHaveLength(1))
    expect(await result.current.prepareCatalogPackage(selected)).toBe(imported)
    expect(h.readCatalogPackage).toHaveBeenCalledWith({ sourceId: 'built-in', packageId: selected.packageId, version: '1.0.0' })
    expect(probe.hash).toHaveBeenCalledWith(new Uint8Array([1, 2]))
    expect(probe.importPackage).toHaveBeenCalledWith(new Uint8Array([1, 2]), expect.objectContaining({
      expectedId: selected.packageId, expectedVersion: '1.0.0', provenance: expect.objectContaining({ sha256: SHA, sourceLabel: '内置' }),
    }))
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('rejects a changed session after asynchronous catalog read without writing', async () => {
    const selected = entry(), h = harness(selected)
    let release!: (value: { bytes: Uint8Array<ArrayBuffer>; sha256: string }) => void
    h.readCatalogPackage.mockImplementation(() => new Promise(resolve => { release = resolve }))
    probe.hash.mockResolvedValue(SHA)
    probe.importPackage.mockResolvedValue(packageData())
    const { result } = renderHook(() => useComponentLibrary(h.ports))
    await waitFor(() => expect(result.current.componentCatalog.packages).toHaveLength(1))
    const pending = result.current.prepareCatalogPackage(selected)
    await waitFor(() => expect(h.readCatalogPackage).toHaveBeenCalledTimes(1))
    h.identity.sessionGeneration = 2
    release({ bytes: new Uint8Array([1, 2]), sha256: SHA })
    expect(await pending).toBeNull()
    expect(h.errors).toHaveLength(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('rejects a changed catalog entry after asynchronous read without writing', async () => {
    const selected = entry(), h = harness(selected)
    let release!: (value: { bytes: Uint8Array<ArrayBuffer>; sha256: string }) => void
    h.readCatalogPackage.mockImplementation(() => new Promise(resolve => { release = resolve }))
    probe.hash.mockResolvedValue(SHA)
    probe.importPackage.mockResolvedValue(packageData())
    const { result } = renderHook(() => useComponentLibrary(h.ports))
    await waitFor(() => expect(result.current.componentCatalog.packages).toHaveLength(1))
    const pending = result.current.prepareCatalogPackage(selected)
    await waitFor(() => expect(h.readCatalogPackage).toHaveBeenCalledTimes(1))
    h.setCatalog(catalog([{ ...selected, sha256: 'b'.repeat(64) }]))
    act(() => result.current.refreshCatalog())
    await waitFor(() => expect(result.current.componentCatalog.packages[0]?.sha256).toBe('b'.repeat(64)))
    release({ bytes: new Uint8Array([1, 2]), sha256: SHA })
    expect(await pending).toBeNull()
    expect(h.errors).toHaveLength(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('rejects a mismatched package hash', async () => {
    const selected = entry(), h = harness(selected)
    probe.hash.mockResolvedValue('b'.repeat(64))
    const { result } = renderHook(() => useComponentLibrary(h.ports))
    await waitFor(() => expect(result.current.componentCatalog.packages).toHaveLength(1))
    expect(await result.current.prepareCatalogPackage(selected)).toBeNull()
    expect(probe.importPackage).not.toHaveBeenCalled()
    expect(h.errors).toHaveLength(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })

  it('rejects an installed version with a conflicting hash without reading the catalog package', async () => {
    const selected = entry(), installed = packageData()
    installed.provenance!.sha256 = 'b'.repeat(64)
    const h = harness(selected, installed)
    const { result } = renderHook(() => useComponentLibrary(h.ports))
    await waitFor(() => expect(result.current.componentCatalog.packages).toHaveLength(1))
    expect(await result.current.prepareCatalogPackage(selected)).toBeNull()
    expect(h.readCatalogPackage).not.toHaveBeenCalled()
    expect(h.errors).toHaveLength(1)
    Object.values(h.writes).forEach(write => expect(write).not.toHaveBeenCalled())
  })
})
