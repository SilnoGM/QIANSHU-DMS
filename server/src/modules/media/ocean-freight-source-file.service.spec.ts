import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { Prisma } from '../../generated/prisma/client'
import type { MediaAssetService } from './media-asset.service'
import type { MediaContentDeliveryService } from './media-content-delivery.service'
import { OceanFreightSourceFileService } from './ocean-freight-source-file.service'

const ID = '00000000-0000-4000-8000-000000000321'
const OWNER = '00000000-0000-4000-8000-000000000322'
const content = Buffer.from('trusted workbook')
function fixture(overrides: Record<string, unknown> = {}) {
  const asset = {
    id: ID, createdByUserId: OWNER, status: 'UPLOADING', mediaType: 'DOCUMENT',
    uploadPurpose: 'OCEAN_FREIGHT_SOURCE_XLSX', deletedAt: null,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    objectKey: 'assets/book.xlsx', sizeBytes: BigInt(content.length),
    checksumSha256: createHash('sha256').update(content).digest('hex'),
    uploadExpiresAt: new Date(Date.now() + 60_000), ...overrides,
  }
  const tx = { $queryRaw: jest.fn().mockResolvedValue([{ id: ID }]), mediaAsset: { findUnique: jest.fn().mockResolvedValue(asset) } }
  const activate = jest.fn().mockResolvedValue(undefined)
  const delivery = {
    stat: jest.fn().mockResolvedValue({ sizeBytes: BigInt(content.length) }),
    open: jest.fn().mockImplementation(() => Promise.resolve({ stream: Readable.from([content]) })),
  }
  const service = new OceanFreightSourceFileService({ activate } as unknown as MediaAssetService, delivery as unknown as MediaContentDeliveryService)
  return { service, tx: tx as unknown as Prisma.TransactionClient, activate, delivery }
}

describe('OceanFreightSourceFileService', () => {
  it('leaves null sources untouched and activates an owned verified upload in caller transaction', async () => {
    const f = fixture()
    await f.service.attach(f.tx, null, OWNER)
    expect(f.tx.$queryRaw).not.toHaveBeenCalled()
    await f.service.attach(f.tx, ID, OWNER)
    expect(f.activate).toHaveBeenCalledWith(f.tx, ID)
  })
  it('accepts an owned ready source without reactivating', async () => {
    const f = fixture({ status: 'READY', uploadExpiresAt: null })
    await f.service.attach(f.tx, ID, OWNER)
    expect(f.activate).not.toHaveBeenCalled()
  })
  it.each([
    { createdByUserId: 'another-user' }, { uploadPurpose: 'PAYMENT_RECIPIENT_QR' },
    { status: 'TRASHED' }, { deletedAt: new Date() }, { mediaType: 'IMAGE' },
    { mimeType: 'application/pdf' }, { objectKey: null }, { sizeBytes: 0n },
    { checksumSha256: null }, { uploadExpiresAt: new Date(0) },
  ])('rejects unavailable source metadata %p', async overrides => {
    const f = fixture(overrides)
    await expect(f.service.attach(f.tx, ID, OWNER)).rejects.toMatchObject({ status: 422 })
    expect(f.activate).not.toHaveBeenCalled()
    expect(f.delivery.open).not.toHaveBeenCalled()
  })
  it('rejects missing or altered content before activation', async () => {
    for (const mode of ['missing', 'size', 'digest']) {
      const f = fixture()
      if (mode === 'missing') f.delivery.stat.mockResolvedValue(null)
      if (mode === 'size') f.delivery.stat.mockResolvedValue({ sizeBytes: 1n })
      if (mode === 'digest') f.delivery.open.mockImplementation(() => Promise.resolve({ stream: Readable.from([Buffer.alloc(content.length)]) }))
      await expect(f.service.attach(f.tx, ID, OWNER)).rejects.toMatchObject({ status: 422 })
      expect(f.activate).not.toHaveBeenCalled()
    }
  })
  it('sanitizes storage errors and fails closed', async () => {
    const f = fixture()
    f.delivery.stat.mockRejectedValue(new Error('private storage path'))
    await expect(f.service.attach(f.tx, ID, OWNER)).rejects.toMatchObject({ status: 503 })
    expect(f.activate).not.toHaveBeenCalled()
  })
})
