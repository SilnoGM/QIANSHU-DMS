import { Readable } from 'node:stream'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

import type { MediaConfiguration } from '../../config/media.config'
import { MediaType } from '../../generated/prisma/enums'
import { LocalMediaStorage } from './local-media-storage'
import type {
  MediaAssetPersistence,
  PreparedMediaAssetPersistenceInput,
} from './media-asset.persistence'
import { MediaAssetService } from './media-asset.service'
import { MediaContentValidator } from './media-content-validator'
import type {
  RestrictedMediaProcessRequest,
  RestrictedMediaProcessResult,
} from './restricted-media-process'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const STAGING_RANDOM_ID = '00000000-0000-4000-8000-000000000654'
const ACTOR_ID = '00000000-0000-4000-8000-000000000987'
const NOW = new Date('2026-08-13T08:09:10.000Z')

function configuration(storageRoot: string): MediaConfiguration {
  return {
    contentDeliveryMode: 'application',
    driver: 'local',
    ffprobePath: '/usr/bin/ffprobe',
    qpdfPath: '/usr/bin/qpdf',
    stagingTtlHours: 24,
    storageEnvironment: 'dev',
    storageRoot,
    trashRetentionDays: 7,
  }
}

async function detectFixtureType(sourcePath: string) {
  const object = await import('node:fs/promises').then(({ readFile }) => readFile(sourcePath))
  if (
    object.length >= 12 &&
    object.toString('ascii', 0, 4) === 'RIFF' &&
    object.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' }
  }
  if (object.toString('ascii', 0, 5) === '%PDF-') {
    return { ext: 'pdf', mime: 'application/pdf' }
  }
  return undefined
}

function qpdfSuccess(
  request: RestrictedMediaProcessRequest,
): Promise<RestrictedMediaProcessResult> {
  const stdout = request.arguments.includes('--show-encryption')
    ? 'File is not encrypted\n'
    : request.arguments.includes('--json=1')
      ? '{"version":1,"attachments":{},"objects":{}}'
      : ''
  return Promise.resolve({ stdout })
}

function persistenceFixture() {
  const markPrepared = jest.fn<
    Promise<boolean>,
    [PreparedMediaAssetPersistenceInput]
  >().mockResolvedValue(true)
  const failUploading = jest.fn().mockResolvedValue(true)
  const persistence = {
    createUploading: jest.fn().mockResolvedValue({ id: ASSET_ID }),
    failUploading,
    markPrepared,
  } as unknown as MediaAssetPersistence
  return { failUploading, markPrepared, persistence }
}

async function consume(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

describe('MediaAssetService with LocalMediaStorage', () => {
  let sandbox: string
  let storageRoot: string

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'qianshu-media-asset-integration-'))
    storageRoot = join(sandbox, 'media')
    await mkdir(storageRoot, { mode: 0o750 })
  })

  afterEach(async () => {
    await rm(sandbox, { force: true, recursive: true })
  })

  async function createService() {
    const mediaConfiguration = configuration(storageRoot)
    const storage = await LocalMediaStorage.create(mediaConfiguration, {
      forbiddenRoots: [],
      randomUuid: () => STAGING_RANDOM_ID,
    })
    const validator = new MediaContentValidator(mediaConfiguration, {
      detectFileType: detectFixtureType,
      runProcess: qpdfSuccess,
    })
    const persistence = persistenceFixture()
    return {
      ...persistence,
      service: new MediaAssetService(
        persistence.persistence,
        storage,
        validator,
        mediaConfiguration,
        { now: () => new Date(NOW) },
      ),
      storage,
    }
  }

  it('prepares an IMAGE through real streaming storage and full decoding', async () => {
    const fixture = await createService()
    const contents = await sharp({
      create: {
        background: { alpha: 1, b: 3, g: 2, r: 1 },
        channels: 4,
        height: 3,
        width: 5,
      },
    }).webp().toBuffer()

    const prepared = await fixture.service.prepare({
      actorUserId: ACTOR_ID,
      allowedTypes: [MediaType.IMAGE],
      declaredMimeType: 'image/webp',
      originalFilename: 'photo.webp',
      pool: 'product',
      requestedType: MediaType.IMAGE,
      stream: Readable.from([contents]),
    })

    expect(prepared).toMatchObject({
      id: ASSET_ID,
      mediaType: MediaType.IMAGE,
      objectKey: `assets/dev/product/2026/08/${ASSET_ID}.webp`,
      trustedMetadata: {
        height: 3,
        mediaType: 'IMAGE',
        mimeType: 'image/webp',
        sizeBytes: BigInt(contents.length),
        width: 5,
      },
    })
    const stored = await fixture.storage.open(prepared.objectKey)
    await expect(consume(stored.stream)).resolves.toEqual(contents)
    expect(fixture.markPrepared).toHaveBeenCalledTimes(1)
    expect(fixture.failUploading).not.toHaveBeenCalled()
  })

  it('prepares DOCUMENT only for an explicit internal policy and leaves no Product concern', async () => {
    const fixture = await createService()
    const contents = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\nstartxref\n0\n%%EOF\n',
    )

    const prepared = await fixture.service.prepare({
      actorUserId: ACTOR_ID,
      allowedTypes: [MediaType.DOCUMENT],
      declaredMimeType: 'application/pdf',
      originalFilename: 'manual.pdf',
      pool: 'bill',
      requestedType: MediaType.DOCUMENT,
      stream: Readable.from([contents]),
    })

    expect(prepared).toMatchObject({
      mediaType: MediaType.DOCUMENT,
      objectKey: `assets/dev/bill/2026/08/${ASSET_ID}.pdf`,
      trustedMetadata: {
        mediaType: 'DOCUMENT',
        mimeType: 'application/pdf',
        sizeBytes: BigInt(contents.length),
      },
    })
    const persistenceInput = fixture.markPrepared.mock.calls[0]?.[0]
    expect(persistenceInput).toMatchObject({
      assetId: ASSET_ID,
      objectKey: `assets/dev/bill/2026/08/${ASSET_ID}.pdf`,
    })
    expect(persistenceInput).not.toHaveProperty('productId')
    expect(persistenceInput).not.toHaveProperty('ownerType')
    expect(persistenceInput).not.toHaveProperty('ownerId')
  })
})
