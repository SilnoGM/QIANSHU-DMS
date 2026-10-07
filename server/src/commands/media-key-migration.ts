import 'dotenv/config'
import 'reflect-metadata'

import { pipeline } from 'node:stream/promises'

import {
  createMediaConfiguration,
  type CosMediaConfiguration,
  type MediaConfiguration,
} from '../config/media.config'
import {
  createCosObjectClient,
  readCosCredentials,
  type CosObjectClient,
} from '../modules/media/cos-object-client'
import {
  CosMediaStorage,
  deriveLocalMediaConfiguration,
} from '../modules/media/cos-media-storage'
import { LocalMediaStorage } from '../modules/media/local-media-storage'
import type { MediaStorage } from '../modules/media/media-storage'
import {
  MediaKeyMigrationCopyService,
  type MediaKeyMigrationCopyClient,
  type MediaKeyMigrationCopyOperations,
  type MediaKeyMigrationCopySource,
  type MediaKeyMigrationCopyTarget,
} from '../modules/media/media-key-migration-copy.service'
import {
  MediaKeyMigrationService,
  type MediaKeyMigrationOperations,
  type MediaKeyMigrationStorage,
} from '../modules/media/media-key-migration.service'

/** 单批改键行数：500 行/事务在锁持有时间与往返次数之间取平衡（规范 6.3 阶段 4 建议值）。 */
const APPLY_BATCH_SIZE = 500
/**
 * 单次命令最多执行的批数：一轮最多切 5 万行，超出的部分由下一次运行继续。
 * 命令本身幂等（已应用的登记行不会再被选中），因此分批上限只影响一轮的工作量，不影响正确性。
 */
const MAXIMUM_APPLY_BATCHES = 100
/** 单批复制对象数：与改键同量级，便于把「复制了多少、改了多少」按同一节奏对齐。 */
const COPY_BATCH_SIZE = 500

export type MediaKeyMigrationMode = 'apply' | 'copy' | 'preview'

/** preview 与 apply 共用的报告：两者都在回答「登记与改键推进到哪一步」。 */
export type MediaKeyMigrationPlanMode = Exclude<MediaKeyMigrationMode, 'copy'>

export interface MediaKeyMigrationReport {
  readonly applied: number
  readonly conflicts: number
  readonly missingTarget: number
  readonly registered: number
  readonly scanned: number
  readonly skipped: number
}

export interface MediaKeyMigrationCopyReport {
  readonly copied: number
  readonly failed: number
  readonly scanned: number
  readonly skipped: number
}

export interface MediaKeyMigrationOutput {
  error(message: string): void
  log(message: string): void
}

export interface MediaKeyMigrationProcess {
  exitCode?: number | string | null
}

export interface MediaKeyMigrationCliDependencies {
  readonly output: MediaKeyMigrationOutput
  readonly processRef: MediaKeyMigrationProcess
  readonly runCopy: () => Promise<MediaKeyMigrationCopyReport>
  readonly runMigration: (mode: MediaKeyMigrationPlanMode) => Promise<MediaKeyMigrationReport>
}

const MIGRATION_MODES: readonly MediaKeyMigrationMode[] = ['apply', 'copy', 'preview']

/**
 * 既有存储实现（cos 与 local）同时满足：改键前的目标对象核对、复制阶段的源/目标读取与复核。
 */
type MediaKeyMigrationStorages = MediaKeyMigrationStorage
  & MediaKeyMigrationCopySource
  & MediaKeyMigrationCopyTarget
  /** 本地复制端复用上传管线的两步落位；对象存储端不需要，但端口类型必须涵盖两者。 */
  & Pick<MediaStorage, 'createStagingWrite' | 'finalize'>

interface MediaKeyMigrationStoragePorts {
  readonly cosClient: CosObjectClient | null
  readonly ports: MediaKeyMigrationStorages
}

function parseMode(argv: readonly string[]): MediaKeyMigrationMode {
  if (argv.length !== 1 || !MIGRATION_MODES.includes(argv[0] as MediaKeyMigrationMode)) {
    throw new Error('Media key migration command is invalid')
  }
  return argv[0] as MediaKeyMigrationMode
}

/**
 * preview 只读：只统计候选与登记进度，不写库。输出里的 scanned 表达「需要改名的候选行数」——
 * 预览要回答的是工作量，而不是扫描成本。
 */
export async function runPreviewMigration(
  operations: MediaKeyMigrationOperations,
): Promise<MediaKeyMigrationReport> {
  const summary = await operations.previewSummary()
  return Object.freeze({
    applied: summary.applied,
    conflicts: 0,
    missingTarget: 0,
    registered: summary.alreadyRegistered,
    scanned: summary.candidates,
    skipped: 0,
  })
}

/**
 * apply 分两阶段：先登记键对（幂等、可复核），再分批改键。
 *
 * 分离的理由：触发器只放行登记过的键对，登记是审计面、改键是数据面。登记阶段一行键都不动，
 * 回滚只需删除登记行（规范 6.5）；把两个动作混在一起，失败时就说不清「登记了哪些、改到哪一步」。
 * 冲突（同一 asset 已登记不同键对）说明计划与登记表漂移，必须人工核对，因此直接停在改键阶段之前。
 */
export async function runApplyMigration(
  operations: MediaKeyMigrationOperations,
): Promise<MediaKeyMigrationReport> {
  const plan = await operations.planCandidates()
  const registration = await operations.registerPlan(plan.candidates)
  if (registration.conflicts > 0) {
    return Object.freeze({
      applied: 0,
      conflicts: registration.conflicts,
      missingTarget: 0,
      registered: registration.registered,
      scanned: plan.scanned,
      skipped: 0,
    })
  }

  let applied = 0
  let missingTarget = 0
  let skipped = 0
  for (let batch = 0; batch < MAXIMUM_APPLY_BATCHES; batch += 1) {
    const result = await operations.applyBatch(APPLY_BATCH_SIZE)
    applied += result.applied
    missingTarget += result.missingTarget
    skipped += result.skipped
    // 本批一行都没改成即停止：待应用行是按 asset_id 升序取前 N 条，未被应用的行（目标缺失、键已漂移）
    // 不会退出待应用集合，继续迭代只会重复统计同一批行、把计数放大成批数倍。
    // 任一批抛错都会向上传播，命令不再继续下一批。
    if (result.applied === 0) break
  }

  return Object.freeze({
    applied,
    conflicts: registration.conflicts,
    missingTarget,
    registered: registration.registered,
    scanned: plan.scanned,
    skipped,
  })
}

/**
 * copy 只复制字节、不写数据库，是 apply 的前置阶段。
 *
 * 三个阶段必须按 preview → copy → apply 顺序执行：apply 只在目标对象存在且长度一致时才改键
 * （缺失会失败关闭并计入 missingTarget），跳过 copy 直接 apply 只会得到一批拒绝改键的行。
 * 输出里的 scanned 与 preview 同口径：需要复制的候选对象数。
 */
export async function runCopyMigration(
  planning: Pick<MediaKeyMigrationOperations, 'planCandidates'>,
  copy: MediaKeyMigrationCopyOperations,
): Promise<MediaKeyMigrationCopyReport> {
  const plan = await planning.planCandidates()

  let copied = 0
  let failed = 0
  let skipped = 0
  for (let index = 0; index < plan.candidates.length; index += COPY_BATCH_SIZE) {
    const result = await copy.copyBatch(
      plan.candidates.slice(index, index + COPY_BATCH_SIZE),
    )
    copied += result.copied
    failed += result.failed
    skipped += result.skipped
  }

  return Object.freeze({
    copied,
    failed,
    scanned: plan.candidates.length,
    skipped,
  })
}

function createMigrationService(
  prisma: import('../infrastructure/database/prisma.service').PrismaService,
  configuration: MediaConfiguration,
  storage: MediaKeyMigrationStorages,
): MediaKeyMigrationService {
  return new MediaKeyMigrationService({
    database: {
      $queryRaw: query => prisma.$queryRaw(query),
      $transaction: operation => prisma.$transaction(transaction => operation({
        $queryRaw: query => transaction.$queryRaw(query),
      })),
    },
    storage,
    storageEnvironment: configuration.storageEnvironment,
  })
}

/**
 * 改键前要核对目标键上的对象，因此 apply 也要装配存储：cos 用对象存储，local 用本地目录。
 * cos 客户端同时被复制阶段复用（返回它以免重复装配）。
 */
async function createStoragePorts(
  configuration: MediaConfiguration,
  environment: Record<string, unknown>,
): Promise<MediaKeyMigrationStoragePorts> {
  if (configuration.driver !== 'cos') {
    return {
      cosClient: null,
      ports: await LocalMediaStorage.create(deriveLocalMediaConfiguration(configuration)),
    }
  }
  const cosClient = createCosClient(configuration, environment)
  return {
    cosClient,
    ports: await CosMediaStorage.create(configuration, cosClient),
  }
}

/**
 * 本地驱动的复制端：把源字节写进 staging，再用 finalize 落位到目标键。
 *
 * 本地端口刻意没有「按任意键写入 assets」的原语（写入与投递都只认受控入口），因此复制复用上传管线的
 * 两步：staging 独占写入 + rename 原子落位。目标已存在时 finalize 抛 `MEDIA_STORAGE_CONFLICT`，
 * 与对象存储端「不覆盖任何已有对象」的语义一致；源对象始终保留。
 */
export function createLocalCopyClient(ports: MediaKeyMigrationStorages): MediaKeyMigrationCopyClient {
  return {
    putObject: async ({ assetId, key, stream }) => {
      const staging = await ports.createStagingWrite(assetId)
      try {
        await pipeline(stream, staging.stream)
        await ports.finalize(staging.key, key)
      }
      catch (error) {
        await staging.cancel().catch(() => undefined)
        throw error
      }
    },
  }
}

function createCosClient(
  configuration: CosMediaConfiguration,
  environment: Record<string, unknown>,
): CosObjectClient {
  return createCosObjectClient({
    bucket: configuration.cos.bucket,
    region: configuration.cos.region,
    ...readCosCredentials(environment),
  })
}

/**
 * 迁移只改数据库里的对象键：不搬字节、不删对象、不写 storage_driver，因此只需要 Prisma、
 * MEDIA_STORAGE_ENV 与目标对象的核对端口。
 */
async function defaultRunMigration(
  mode: MediaKeyMigrationPlanMode,
): Promise<MediaKeyMigrationReport> {
  const configuration = createMediaConfiguration(process.env)
  const { ports } = await createStoragePorts(configuration, process.env)
  return withPrisma((prisma) => {
    const operations = createMigrationService(prisma, configuration, ports)
    return mode === 'preview' ? runPreviewMigration(operations) : runApplyMigration(operations)
  })
}

/**
 * copy 的装配：只读候选（数据库）＋ 跨键复制（对象存储或本地目录）。
 *
 * 两种驱动都受支持，但复制端的实现不同：cos 直写对象存储并落下 `x-cos-meta-sha256` 元数据；
 * local 走 staging + finalize（本地端口没有按任意键写入的原语）。两者都只复制、不写数据库、不删源。
 */
export async function runCopyMigrationFromEnvironment(
  environment: Record<string, unknown>,
): Promise<MediaKeyMigrationCopyReport> {
  const configuration = createMediaConfiguration(environment)
  const { cosClient, ports } = await createStoragePorts(configuration, environment)
  const client = cosClient ?? createLocalCopyClient(ports)
  return withPrisma((prisma) => runCopyMigration(
    createMigrationService(prisma, configuration, ports),
    new MediaKeyMigrationCopyService({ client, source: ports, target: ports }),
  ))
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

function defaultDependencies(): MediaKeyMigrationCliDependencies {
  return {
    output: console,
    processRef: process,
    runCopy: () => runCopyMigrationFromEnvironment(process.env),
    runMigration: defaultRunMigration,
  }
}

/**
 * 命令只输出固定 JSON 事件：原始异常可能带连接串、桶名或对象键，因此失败一律收敛为同一个事件，
 * 调用方依赖 exitCode 与计数字段定位问题。
 */
export async function runMediaKeyMigrationCli(
  argv: readonly string[],
  dependencies: MediaKeyMigrationCliDependencies = defaultDependencies(),
): Promise<void> {
  try {
    const mode = parseMode(argv)

    if (mode === 'copy') {
      const report = await dependencies.runCopy()
      const status = report.failed > 0 ? 'issues' : 'passed'
      dependencies.output.log(JSON.stringify({
        kind: 'media_key_migration',
        status,
        scanned: report.scanned,
        copied: report.copied,
        skipped: report.skipped,
        failed: report.failed,
      }))
      if (status !== 'passed') dependencies.processRef.exitCode = 1
      return
    }

    const report = await dependencies.runMigration(mode)
    // 冲突、未应用的登记、缺失的目标对象都意味着迁移门禁（已切换 + 未切换 = 总数）不成立，
    // 需要运维介入，不能报成成功。
    const status = report.conflicts > 0 || report.missingTarget > 0 || report.skipped > 0
      ? 'issues'
      : 'passed'
    dependencies.output.log(JSON.stringify({
      kind: 'media_key_migration',
      status,
      scanned: report.scanned,
      registered: report.registered,
      applied: report.applied,
      skipped: report.skipped,
      missingTarget: report.missingTarget,
      conflicts: report.conflicts,
    }))
    if (status !== 'passed') dependencies.processRef.exitCode = 1
  }
  catch {
    dependencies.output.error(JSON.stringify({
      kind: 'media_key_migration',
      status: 'failed',
    }))
    dependencies.processRef.exitCode = 1
  }
}

if (require.main === module) {
  void runMediaKeyMigrationCli(process.argv.slice(2))
}
