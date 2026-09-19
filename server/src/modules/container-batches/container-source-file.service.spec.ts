import { Readable } from 'node:stream'
import type { PrismaService } from '../../infrastructure/database/prisma.service'
import { MediaAssetLifecycleError, type MediaAssetService } from '../media/media-asset.service'
import type { MediaContentDeliveryService } from '../media/media-content-delivery.service'
import type { SalesOrderDocumentMultipartRequest } from '../sales-orders/documents/sales-order-document-multipart.parser'
import { ContainerSourceFileService } from './container-source-file.service'

const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const asset = { id: 'asset', originalFilename: '来源.xlsx', mimeType: mime, sizeBytes: 4n, mediaType: 'DOCUMENT', uploadPurpose: 'OCEAN_FREIGHT_SOURCE_XLSX', status: 'READY', deletedAt: null, objectKey: 'assets/2026/09/file.xlsx' }
function request(type = mime, name = '来源.xlsx') {
  const stream = Readable.from([Buffer.from(`--source\r\nContent-Disposition: form-data; name="mediaType"\r\n\r\nDOCUMENT\r\n--source\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\nxlsx\r\n--source--\r\n`)])
  return Object.assign(stream, { headers: { 'content-type': 'multipart/form-data; boundary=source' } }) as SalesOrderDocumentMultipartRequest
}
function setup() {
  const prisma = { containerBatch: { findUnique: jest.fn().mockResolvedValue({ sourceFileId: null, sourceFile: asset }) }, mediaAsset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), findUniqueOrThrow: jest.fn().mockResolvedValue(asset) } }
  const media = { prepare: jest.fn(async (input: { stream: Readable }) => { for await (const chunk of input.stream) void chunk; return { id: 'asset', trustedMetadata: { mimeType: mime, sizeBytes: 4n } } }) }
  const delivery = { mode: 'stream', stat: jest.fn().mockResolvedValue({ sizeBytes: 4n }), open: jest.fn().mockResolvedValue({ stream: Readable.from(['xlsx']) }) }
  return { prisma, media, delivery, service: new ContainerSourceFileService(prisma as unknown as PrismaService, media as unknown as MediaAssetService, delivery as unknown as MediaContentDeliveryService) }
}
describe('ContainerSourceFileService', () => {
  it('validates one xlsx through media lifecycle, marks upload purpose without activating or exposing storage key', async () => {
    const { service, media, prisma } = setup()
    const result = await service.upload('actor', 'batch', request())
    expect(result).toEqual({ mediaAssetId: 'asset', originalFilename: '来源.xlsx', mimeType: mime, sizeBytes: '4' })
    expect(media.prepare).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'actor', allowedTypes: ['DOCUMENT'], requestedType: 'DOCUMENT' }))
    expect(prisma.mediaAsset.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { uploadPurpose: 'OCEAN_FREIGHT_SOURCE_XLSX' } }))
    expect(JSON.stringify(result)).not.toContain('objectKey')
  })
  it('blocks replacement and rejects non-xlsx before preparation', async () => {
    const { service, media, prisma } = setup()
    prisma.containerBatch.findUnique.mockResolvedValueOnce({ sourceFileId: 'existing', sourceFile: asset })
    await expect(service.upload('actor', 'batch', request())).rejects.toMatchObject({ code: 'CONTAINER_SOURCE_FILE_LOCKED' })
    await expect(service.upload('actor', 'batch', request('application/pdf', 'file.pdf'))).rejects.toMatchObject({ code: 'CONTAINER_SOURCE_FILE_INVALID' })
    expect(media.prepare).not.toHaveBeenCalled()
  })
  it('maps malformed multipart and validator failures to safe domain errors', async () => {
    const { service, media } = setup()
    media.prepare.mockRejectedValueOnce(new MediaAssetLifecycleError('MEDIA_ASSET_CONTENT_TOO_LARGE'))
    await expect(service.upload('actor', 'batch', request())).rejects.toMatchObject({ code: 'CONTAINER_SOURCE_FILE_TOO_LARGE' })
    const invalid = Object.assign(Readable.from([]), { headers: {} }) as SalesOrderDocumentMultipartRequest
    await expect(service.upload('actor', 'batch', invalid)).rejects.toMatchObject({ code: 'CONTAINER_SOURCE_FILE_INVALID' })
  })
  it('serves only attached READY source media with private attachment headers and handles HEAD', async () => {
    const { service, delivery, prisma } = setup()
    const head = await service.content('batch', 'HEAD')
    expect(head.headers).toMatchObject({ 'Content-Type': mime, 'Cache-Control': 'private, no-store', 'Content-Length': '4' })
    expect(head.headers['Content-Disposition']).toContain('attachment;')
    expect(delivery.open).not.toHaveBeenCalled()
    prisma.containerBatch.findUnique.mockResolvedValueOnce({ sourceFileId: 'asset', sourceFile: { ...asset, status: 'UPLOADING' } })
    await expect(service.metadata('batch')).rejects.toMatchObject({ code: 'CONTAINER_SOURCE_FILE_NOT_FOUND' })
  })
  it('fails closed when stored bytes disappeared or changed size', async () => {
    const { service, delivery } = setup()
    delivery.stat.mockResolvedValueOnce({ sizeBytes: 7n })
    await expect(service.content('batch', 'GET')).rejects.toMatchObject({ code: 'MEDIA_STORAGE_UNAVAILABLE' })
    expect(delivery.open).not.toHaveBeenCalled()
  })
})
