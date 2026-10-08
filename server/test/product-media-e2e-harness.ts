import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'

import { ConfigService } from '@nestjs/config'
import sharp from 'sharp'

import type { MediaConfiguration } from '../src/config/media.config'
import {
  ProductMediaKind,
} from '../src/generated/prisma/enums'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { AuditService } from '../src/modules/audit/audit.service'
import { LocalMediaStorage } from '../src/modules/media/local-media-storage'
import { MediaAssetPersistence } from '../src/modules/media/media-asset.persistence'
import { MediaAssetService } from '../src/modules/media/media-asset.service'
import { MediaContentValidator } from '../src/modules/media/media-content-validator'
import { MediaContentDeliveryService } from '../src/modules/media/media-content-delivery.service'
import { MediaReconciliationPersistence } from '../src/modules/media/media-reconciliation.persistence'
import { MediaReconciliationService } from '../src/modules/media/media-reconciliation.service'
import { MediaAssetReferenceRepository } from '../src/modules/media/media-reference.repository'
import { MediaAssetRetentionService } from '../src/modules/media/media-retention.service'
import { MediaVariantService } from '../src/modules/media/media-variant.service'
import type {
  RestrictedMediaProcessRequest,
  RestrictedMediaProcessResult,
} from '../src/modules/media/restricted-media-process'
import { ProductMediaContentService } from '../src/modules/products/media/product-media-content.service'
import { ProductMediaPersistence } from '../src/modules/products/media/product-media.persistence'
import {
  ProductMediaService,
  type ProductMediaCommandContext,
} from '../src/modules/products/media/product-media.service'

const MINIMAL_MP4_SIGNATURE = Buffer.from([
  0x00, 0x00, 0x00, 0x20,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d,
  0x69, 0x73, 0x6f, 0x32,
  0x61, 0x76, 0x63, 0x31,
  0x6d, 0x70, 0x34, 0x31,
])

function requireDatabaseUrl(): string {
  const value = process.env.DATABASE_URL
  if (!value) throw new Error('DATABASE_URL is required for ProductMedia E2E tests')
  return value
}

function isPathWithin(candidate: string, parent: string): boolean {
  const fromParent = relative(parent, candidate)
  return fromParent === '' || (
    fromParent !== '..'
    && !fromParent.startsWith(`..${sep}`)
    && !isAbsolute(fromParent)
  )
}

/**
 * 媒体 E2E 不能接受任意调用方路径。父目录必须是 ci-postgres 创建的私有、真实、
 * 位于系统临时目录内的 session；即使测试失败，父编排器仍会回收整个 session。
 */
async function requireCiTemporaryRoot(): Promise<string> {
  const rawRoot = process.env.QIANSHU_CI_TEMP_ROOT
  if (typeof rawRoot !== 'string' || !isAbsolute(rawRoot)) {
    throw new Error('QIANSHU_CI_TEMP_ROOT is required for ProductMedia E2E tests')
  }
  const normalized = resolve(rawRoot)
  const [canonical, temporaryRoot, metadata] = await Promise.all([
    realpath(normalized),
    realpath(tmpdir()),
    lstat(normalized),
  ])
  if (
    !metadata.isDirectory()
    || metadata.isSymbolicLink()
    || (metadata.mode & 0o077) !== 0
    || !isPathWithin(canonical, temporaryRoot)
    || !canonical.split(sep).some(segment => segment.startsWith('qianshu-ci-postgres-'))
  ) {
    throw new Error('QIANSHU_CI_TEMP_ROOT is outside the isolated boundary')
  }
  // macOS 的 tmpdir 常以 /var 暴露、realpath 后落在 /private/var；后续一律使用
  // canonical 路径，同时仍由目录权限、basename 和 canonical containment 收口。
  return canonical
}

async function detectFixtureType(sourcePath: string) {
  const object = await readFile(sourcePath)
  if (
    object.length >= 12
    && object.toString('ascii', 0, 4) === 'RIFF'
    && object.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' }
  }
  if (
    object.length >= 12
    && object.toString('ascii', 4, 8) === 'ftyp'
  ) {
    return { ext: 'mp4', mime: 'video/mp4' }
  }
  if (object.toString('ascii', 0, 5) === '%PDF-') {
    return { ext: 'pdf', mime: 'application/pdf' }
  }
  return undefined
}

function deterministicMediaProcess(
  request: RestrictedMediaProcessRequest,
): Promise<RestrictedMediaProcessResult> {
  if (request.executablePath === '/e2e/ffprobe') {
    return Promise.resolve({
      stdout: JSON.stringify({
        format: {
          duration: '1.250',
          format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        },
        streams: [{
          codec_name: 'h264',
          codec_tag_string: 'avc1',
          codec_type: 'video',
          height: 1080,
          width: 1920,
        }, {
          codec_name: 'aac',
          codec_type: 'audio',
        }],
      }),
    })
  }
  const stdout = request.arguments.includes('--show-encryption')
    ? 'File is not encrypted\n'
    : request.arguments.includes('--json=1')
      ? '{"version":1,"attachments":{},"objects":{}}'
      : ''
  return Promise.resolve({ stdout })
}

export async function createE2eImageBuffer(): Promise<Buffer> {
  return sharp({
    create: {
      background: { alpha: 1, b: 30, g: 20, r: 10 },
      channels: 4,
      height: 3,
      width: 5,
    },
  }).webp().toBuffer()
}

export function createE2eVideoBuffer(): Buffer {
  return Buffer.from(MINIMAL_MP4_SIGNATURE)
}

export interface ProductMediaE2eInitialState {
  readonly mediaAssetCount: number
  readonly productMediaCount: number
  readonly productMediaReadPermissionGrantedToSystemAdmin: boolean
}

/**
 * Task 11 的组合根：所有服务使用真实 PostgreSQL 与真实 LocalMediaStorage，只有外部
 * 媒体探测进程替换为确定性、无 shell 的可信输出，确保 CI 不依赖宿主机二进制。
 */
export class ProductMediaE2eHarness {
  readonly assets: MediaAssetService
  readonly content: ProductMediaContentService
  readonly initialState: ProductMediaE2eInitialState
  readonly mediaAssetPersistence: MediaAssetPersistence
  readonly persistence: ProductMediaPersistence
  readonly productMedia: ProductMediaService
  readonly reconciliation: MediaReconciliationService
  readonly reconciliationPersistence: MediaReconciliationPersistence
  readonly references: MediaAssetReferenceRepository
  readonly retention: MediaAssetRetentionService

  private constructor(
    readonly prisma: PrismaService,
    readonly storage: LocalMediaStorage,
    readonly storageRoot: string,
    readonly sandbox: string,
    readonly actorId: string,
    readonly suffix: string,
    initialState: ProductMediaE2eInitialState,
    private currentTime: Date,
  ) {
    this.initialState = Object.freeze({ ...initialState })
    this.mediaAssetPersistence = new MediaAssetPersistence(prisma)
    this.reconciliationPersistence = new MediaReconciliationPersistence(prisma)
    this.references = new MediaAssetReferenceRepository()
    const configuration: MediaConfiguration = {
      contentDeliveryMode: 'application',
      driver: 'local',
      ffmpegPath: '/e2e/ffmpeg',
      ffprobePath: '/e2e/ffprobe',
      qpdfPath: '/e2e/qpdf',
      stagingTtlHours: 24,
      storageEnvironment: 'dev',
      storageRoot,
      trashRetentionDays: 7,
    }
    const now = () => new Date(this.currentTime)
    const validator = new MediaContentValidator(configuration, {
      detectFileType: detectFixtureType,
      runProcess: deterministicMediaProcess,
    })
    this.assets = new MediaAssetService(
      this.mediaAssetPersistence,
      storage,
      validator,
      configuration,
      { now },
    )
    this.retention = new MediaAssetRetentionService(
      this.reconciliationPersistence,
      this.references,
      storage,
      configuration,
      { now },
    )
    this.reconciliation = new MediaReconciliationService(
      this.reconciliationPersistence,
      this.references,
      storage,
      'dev',
      { monotonicNow: () => 0, now },
    )
    this.persistence = new ProductMediaPersistence(prisma)
    this.productMedia = new ProductMediaService(
      prisma,
      this.persistence,
      this.assets,
      this.retention,
      new AuditService(),
      { now },
    )
    const delivery = new MediaContentDeliveryService(storage, 'application')
    this.content = new ProductMediaContentService(
      prisma,
      delivery,
      new MediaVariantService(delivery, configuration),
    )
  }

  static async create(): Promise<ProductMediaE2eHarness> {
    const temporaryRoot = await requireCiTemporaryRoot()
    const sandbox = await mkdtemp(join(temporaryRoot, 'product-media-e2e-'))
    const storageRoot = join(sandbox, 'media')
    await mkdir(storageRoot, { mode: 0o750 })

    const prisma = new PrismaService(
      new ConfigService({ DATABASE_URL: requireDatabaseUrl() }),
    )
    try {
      await prisma.onModuleInit()
      const [mediaAssetCount, productMediaCount, permission] = await Promise.all([
        prisma.mediaAsset.count(),
        prisma.productMedia.count(),
        prisma.permission.findUnique({
          where: { code: 'product-media:read' },
          select: {
            roles: {
              where: { role: { code: 'system_admin' } },
              select: { roleId: true },
            },
          },
        }),
      ])
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
      const actor = await prisma.user.create({
        data: {
          displayName: 'ProductMedia E2E',
          passwordChangedAt: new Date(),
          passwordHash: 'e2e-only-not-a-real-password-hash',
          username: `product-media-e2e-${suffix}`,
          usernameNormalized: `product-media-e2e-${suffix}`,
        },
        select: { id: true },
      })
      const configuration: MediaConfiguration = {
        contentDeliveryMode: 'application',
        driver: 'local',
        ffmpegPath: '/e2e/ffmpeg',
        ffprobePath: '/e2e/ffprobe',
        qpdfPath: '/e2e/qpdf',
        stagingTtlHours: 24,
        storageEnvironment: 'dev',
        storageRoot,
        trashRetentionDays: 7,
      }
      const storage = await LocalMediaStorage.create(configuration, {
        // 生产默认禁止 tmpdir；这里的 root 已由上方 CI session 守卫收口。
        forbiddenRoots: [],
      })
      return new ProductMediaE2eHarness(
        prisma,
        storage,
        storageRoot,
        sandbox,
        actor.id,
        suffix,
        {
          mediaAssetCount,
          productMediaCount,
          productMediaReadPermissionGrantedToSystemAdmin:
            permission !== null && permission.roles.length === 1,
        },
        new Date('2026-08-14T12:00:00.000Z'),
      )
    }
    catch (error) {
      await prisma.onModuleDestroy().catch(() => undefined)
      await rm(sandbox, { force: true, recursive: true }).catch(() => undefined)
      throw error
    }
  }

  context(label: string): ProductMediaCommandContext {
    return {
      actorUserId: this.actorId,
      requestId: `product-media-e2e-${label}`.slice(0, 64),
    }
  }

  async createProduct(label: string): Promise<string> {
    const product = await this.prisma.product.create({
      data: {
        createdByUserId: this.actorId,
        name: `ProductMedia ${label}`,
        productNo: `PM-${this.suffix}-${label}`.slice(0, 64),
        updatedByUserId: this.actorId,
      },
      select: { id: true },
    })
    return product.id
  }

  uploadImage(productId: string, expectedVersion: number, label: string) {
    return createE2eImageBuffer().then(contents => this.productMedia.upload(
      this.context(label),
      productId,
      {
        declaredMimeType: 'image/webp',
        expectedVersion,
        kind: ProductMediaKind.IMAGE,
        originalFilename: `${label}.webp`,
        stream: Readable.from([contents]),
      },
    ))
  }

  uploadVideo(productId: string, expectedVersion: number, label: string) {
    return this.productMedia.upload(this.context(label), productId, {
      declaredMimeType: 'video/mp4',
      expectedVersion,
      kind: ProductMediaKind.VIDEO,
      originalFilename: `${label}.mp4`,
      stream: Readable.from([createE2eVideoBuffer()]),
    })
  }

  setNow(value: Date): void {
    if (!Number.isFinite(value.getTime())) throw new Error('E2E clock is invalid')
    this.currentTime = new Date(value)
  }

  async close(): Promise<void> {
    await this.prisma.onModuleDestroy()
    await rm(this.sandbox, { force: true, recursive: true })
  }
}
