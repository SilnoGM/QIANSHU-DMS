import 'dotenv/config'
import 'reflect-metadata'

import { createMediaConfiguration } from '../config/media.config'
import {
  createCosObjectClient,
  readCosCredentials,
} from '../modules/media/cos-object-client'
import {
  CosMediaStorage,
  deriveLocalMediaConfiguration,
} from '../modules/media/cos-media-storage'
import { LocalMediaStorage } from '../modules/media/local-media-storage'
import {
  MediaMigrationService,
  type MediaMigrationMode,
  type MediaMigrationResult,
} from '../modules/media/media-migration.service'

export interface MediaMigrationOutput {
  error(message: string): void
  log(message: string): void
}

export interface MediaMigrationProcess {
  exitCode?: number | string | null
}

export interface MediaMigrationReport extends MediaMigrationResult {
  /** 迁移完成并全部校验通过后翻转 storage_driver 的行数；预览或存在失败时为 0。 */
  readonly flipped: number
}

export interface MediaMigrationCliDependencies {
  readonly output: MediaMigrationOutput
  readonly processRef: MediaMigrationProcess
  readonly runMigration: (mode: MediaMigrationMode) => Promise<MediaMigrationReport>
}

const MIGRATION_MODES: readonly MediaMigrationMode[] = ['apply', 'preview']

function parseMode(argv: readonly string[]): MediaMigrationMode {
  if (argv.length !== 1 || !MIGRATION_MODES.includes(argv[0] as MediaMigrationMode)) {
    throw new Error('Media migration command is invalid')
  }
  return argv[0] as MediaMigrationMode
}

function metric(
  name: string,
  value: number,
  labels: Readonly<Record<string, string>>,
): string {
  return JSON.stringify({ kind: 'metric', labels, metric: name, value })
}

/**
 * 迁移目标必须在配置中启用：桶定位与非敏感信息来自 MediaConfiguration，凭据来自进程环境。
 * 源端仍然是本地目录，用与运行期完全一致的派生配置构造，保证目录语义不漂移。
 */
async function defaultRunMigration(
  mode: MediaMigrationMode,
): Promise<MediaMigrationReport> {
  const configuration = createMediaConfiguration(process.env)
  if (configuration.driver !== 'cos') {
    throw new Error('Media migration requires the cos storage driver')
  }
  const client = createCosObjectClient({
    bucket: configuration.cos.bucket,
    region: configuration.cos.region,
    ...readCosCredentials(process.env),
  })
  const source = await LocalMediaStorage.create(
    deriveLocalMediaConfiguration(configuration),
  )
  const target = await CosMediaStorage.create(configuration, client)

  return withPrisma(async (prisma) => {
    const service = new MediaMigrationService({
      client,
      lookupAsset: async (assetId: string) => {
        const record = await prisma.mediaAsset.findFirst({
          where: { id: assetId },
          select: { checksumSha256: true, sizeBytes: true },
        })
        if (
          record === null ||
          record.checksumSha256 === null ||
          record.sizeBytes === null
        ) {
          return null
        }
        return {
          checksumSha256: record.checksumSha256,
          sizeBytes: record.sizeBytes,
        }
      },
      source,
      target,
    })

    const result = await service.run(mode)
    if (mode === 'preview' || result.failed > 0) {
      return { ...result, flipped: 0 }
    }

    // 只有整轮对象全部通过校验才翻转 driver；提前翻转会让未搬迁的对象在切换后读不到。
    const flipped = await prisma.mediaAsset.updateMany({
      data: { storageDriver: 'cos' },
      where: {
        objectKey: { not: null },
        status: { in: ['READY', 'TRASHED'] },
        storageDriver: 'local',
      },
    })
    return { ...result, flipped: flipped.count }
  })
}

async function withPrisma<T>(
  operation: (prisma: import('../infrastructure/database/prisma.service').PrismaService) => Promise<T>,
): Promise<T> {
  const [{ NestFactory }, { AppModule }, { PrismaService }] = await Promise.all([
    import('@nestjs/core'),
    import('../app.module'),
    import('../infrastructure/database/prisma.service'),
  ])
  const application = await NestFactory.createApplicationContext(AppModule, {
    abortOnError: false,
    logger: false,
  })
  try {
    return await operation(application.get(PrismaService))
  }
  finally {
    await application.close().catch(() => undefined)
  }
}

function defaultDependencies(): MediaMigrationCliDependencies {
  return {
    output: console,
    processRef: process,
    runMigration: defaultRunMigration,
  }
}

/**
 * 迁移 CLI 只输出固定 JSON 与低基数计数：原始异常可能包含连接串、桶名或对象键，
 * 因此所有失败都收敛为同一个固定事件，调用方依赖 exitCode 与计数字段定位。
 */
export async function runMediaMigrationCli(
  argv: readonly string[],
  dependencies: MediaMigrationCliDependencies = defaultDependencies(),
): Promise<void> {
  try {
    const mode = parseMode(argv)
    const report = await dependencies.runMigration(mode)
    const status = report.failed > 0 ? 'issues' : 'passed'
    dependencies.output.log(JSON.stringify({
      kind: 'media_migration',
      mode,
      status,
      ...report,
    }))
    for (const [result, value] of [
      ['copied', report.copied],
      ['failed', report.failed],
      ['scanned', report.scanned],
      ['skipped', report.skipped],
    ] as const) {
      dependencies.output.log(metric('media_migration_total', value, {
        mode,
        result,
      }))
    }
    if (report.failed > 0) dependencies.processRef.exitCode = 1
  }
  catch {
    dependencies.output.error(JSON.stringify({
      kind: 'media_migration',
      status: 'failed',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) {
  void runMediaMigrationCli(process.argv.slice(2))
}
