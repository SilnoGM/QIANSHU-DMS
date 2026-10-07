import { createHash, randomUUID } from 'node:crypto'
import { constants as fileSystemConstants, type Stats } from 'node:fs'
import {
  access,
  lstat,
  realpath,
  statfs,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'

import type { MediaConfiguration } from '../../config/media.config'
import {
  CosObjectClientError,
  type CosObjectClient,
  createCosObjectClient,
  readCosCredentials,
} from './cos-object-client'
import { runRestrictedMediaProcess } from './restricted-media-process'

export interface MediaOperationalCapacity {
  readonly availableBlocks: bigint
  readonly blockSize: bigint
  readonly totalBlocks: bigint
}

export interface MediaOperationalHealthDependencies {
  readonly checkReadAccess: (storageRoot: string) => Promise<boolean>
  /** COS 驱动专用：桶可达性与对象级读取权限。 */
  readonly checkRemoteReadAccess: (configuration: MediaConfiguration) => Promise<boolean>
  /** COS 驱动专用：桶写入权限。 */
  readonly checkRemoteWriteAccess: (configuration: MediaConfiguration) => Promise<boolean>
  readonly checkVideoValidator: (executablePath: string) => Promise<boolean>
  readonly checkWriteAccess: (storageRoot: string) => Promise<boolean>
  readonly inspectCapacity: (storageRoot: string) => Promise<MediaOperationalCapacity>
}

export interface MediaOperationalHealthResult {
  readonly capabilities: {
    readonly read: MediaOperationalHealthCapability
    readonly videoValidator: MediaOperationalHealthCapability
    readonly write: MediaOperationalHealthCapability
  }
  readonly capacity: {
    readonly freePercent: number | null
    readonly level: 'critical' | 'ok' | 'unknown' | 'warning'
  }
  readonly status: 'degraded' | 'down' | 'healthy'
}

interface MediaOperationalHealthCapability {
  readonly code:
    | 'MEDIA_CAPACITY_CRITICAL'
    | 'MEDIA_CAPACITY_WARNING'
    | 'MEDIA_READ_READY'
    | 'MEDIA_READ_UNAVAILABLE'
    | 'MEDIA_VIDEO_VALIDATOR_READY'
    | 'MEDIA_VIDEO_VALIDATOR_UNAVAILABLE'
    | 'MEDIA_WRITE_READY'
    | 'MEDIA_WRITE_UNAVAILABLE'
  readonly status: 'down' | 'up'
}

const CAPACITY_CRITICAL_PERCENT = 10
const CAPACITY_WARNING_PERCENT = 20

function hasTrustedDirectoryPermissions(metadata: Stats): boolean {
  return (metadata.mode & 0o027) === 0
}

async function checkDirectories(
  storageRoot: string,
  children: readonly string[],
  accessMode: number,
): Promise<boolean> {
  try {
    for (const candidate of [storageRoot, ...children.map(name => join(storageRoot, name))]) {
      const normalized = resolve(candidate)
      const [metadata, canonical] = await Promise.all([
        lstat(normalized),
        realpath(normalized),
      ])
      if (
        metadata.isSymbolicLink() ||
        !metadata.isDirectory() ||
        canonical !== normalized ||
        !hasTrustedDirectoryPermissions(metadata)
      ) {
        return false
      }
      await access(normalized, accessMode)
    }
    return true
  }
  catch {
    return false
  }
}

/**
 * 桶探针键前缀，必须带环境段。
 *
 * 探针刻意放在 assets/staging/trash 三个命名空间之外：对账只扫描这三个命名空间，探针对象既不
 * 会被计成 orphan，也不会污染「零 mismatch」判定；进程在 PUT 与 DELETE 之间崩溃留下的残留由桶上
 * 针对 `_ops/` 的生命周期规则回收。
 *
 * 共桶形态下环境段不可省略：写探针是「PUT 后立即 DELETE」，若两个环境共用同一个键，一个环境的
 * 探活会删掉另一个环境正在使用的探针对象。
 */
function bucketProbePrefix(configuration: MediaConfiguration): string {
  return `_ops/${configuration.storageEnvironment}/health-probe-`
}

function createDefaultRemoteProbes(): Pick<
  MediaOperationalHealthDependencies,
  'checkRemoteReadAccess' | 'checkRemoteWriteAccess'
> {
  const clientFor = (configuration: MediaConfiguration): CosObjectClient => {
    if (configuration.driver !== 'cos') {
      // 只有 cos 驱动会调用这两个探针；本地驱动误入时失败关闭而不是伪造结论。
      throw new CosObjectClientError('COS_CLIENT_CONFIGURATION_INVALID')
    }
    const credentials = readCosCredentials(process.env)
    return createCosObjectClient({
      bucket: configuration.cos.bucket,
      region: configuration.cos.region,
      ...credentials,
    })
  }

  return {
    checkRemoteReadAccess: async (configuration: MediaConfiguration) => {
      const client = clientFor(configuration)
      await client.headBucket()
      // HEAD 一个固定探针键：对象不存在（null）同样证明对象级读取链路与权限可用。
      await client.headObject(`${bucketProbePrefix(configuration)}read`)
      return true
    },
    checkRemoteWriteAccess: async (configuration: MediaConfiguration) => {
      const client = clientFor(configuration)
      const contents = Buffer.from('probe')
      const key = `${bucketProbePrefix(configuration)}${randomUUID()}`
      await client.putObject({
        contentLength: contents.length,
        key,
        sha256: createHash('sha256').update(contents).digest('hex'),
        stream: Readable.from([contents]),
      })
      // 探针必须自清理，避免每次探活都在桶里留下对象。
      await client.deleteObject(key)
      return true
    },
  }
}

const DEFAULT_DEPENDENCIES: MediaOperationalHealthDependencies = Object.freeze({
  checkReadAccess: (storageRoot: string) => checkDirectories(
    storageRoot,
    ['assets', 'trash'],
    fileSystemConstants.R_OK | fileSystemConstants.X_OK,
  ),
  ...createDefaultRemoteProbes(),
  checkVideoValidator: async (executablePath: string) => {
    try {
      await runRestrictedMediaProcess({
        arguments: ['-version'],
        executablePath,
        stderrLimitBytes: 64 * 1024,
        stdoutLimitBytes: 64 * 1024,
        timeoutMs: 5_000,
      })
      return true
    }
    catch {
      return false
    }
  },
  checkWriteAccess: (storageRoot: string) => checkDirectories(
    storageRoot,
    ['staging'],
    fileSystemConstants.W_OK | fileSystemConstants.X_OK,
  ),
  inspectCapacity: async (storageRoot: string) => {
    const capacity = await statfs(storageRoot, { bigint: true })
    return {
      availableBlocks: capacity.bavail,
      blockSize: capacity.bsize,
      totalBlocks: capacity.blocks,
    }
  },
})

function capability(
  status: MediaOperationalHealthCapability['status'],
  code: MediaOperationalHealthCapability['code'],
): MediaOperationalHealthCapability {
  return Object.freeze({ code, status })
}

function capacityPercent(capacity: MediaOperationalCapacity): number | null {
  if (
    capacity.availableBlocks < 0n ||
    capacity.blockSize <= 0n ||
    capacity.totalBlocks <= 0n ||
    capacity.availableBlocks > capacity.totalBlocks
  ) {
    return null
  }
  // 两位小数已经足够支持 20/10 告警，同时避免把底层块计数带入日志。
  return Number(
    capacity.availableBlocks * 10_000n / capacity.totalBlocks,
  ) / 100
}

/**
 * 媒体部署探针与公开 `/api/health` 分离：结果只含固定 capability/code 和容量百分比，
 * 不包含 root、可执行路径或文件名。read 独立于 write，确保容量 critical 不会误报读取中断。
 *
 * 驱动差异：本地驱动的读取只看目录权限；COS 驱动的读取走桶探针，写入还要额外证明桶可写，
 * 因此 COS 下缺少凭证或权限会在启动前就暴露，而不是等到第一次上传才失败。
 */
export async function collectMediaOperationalHealth(
  configuration: MediaConfiguration,
  dependencies: MediaOperationalHealthDependencies = DEFAULT_DEPENDENCIES,
): Promise<MediaOperationalHealthResult> {
  const remote = configuration.driver === 'cos'
  const [readAvailable, remoteWriteAvailable, writeAvailable, videoAvailable, rawCapacity] =
    await Promise.all([
      (remote
        ? dependencies.checkRemoteReadAccess(configuration)
        : dependencies.checkReadAccess(configuration.storageRoot)
      ).catch(() => false),
      remote
        ? dependencies.checkRemoteWriteAccess(configuration).catch(() => false)
        : Promise.resolve(true),
      dependencies.checkWriteAccess(configuration.storageRoot).catch(() => false),
      dependencies.checkVideoValidator(configuration.ffprobePath).catch(() => false),
      dependencies.inspectCapacity(configuration.storageRoot).catch(() => null),
    ])
  const freePercent = rawCapacity === null ? null : capacityPercent(rawCapacity)
  const capacityLevel = freePercent === null
    ? 'unknown'
    : freePercent < CAPACITY_CRITICAL_PERCENT
      ? 'critical'
      : freePercent < CAPACITY_WARNING_PERCENT
        ? 'warning'
        : 'ok'
  const read = readAvailable
    ? capability('up', 'MEDIA_READ_READY')
    : capability('down', 'MEDIA_READ_UNAVAILABLE')
  const write = !writeAvailable || !remoteWriteAvailable || capacityLevel === 'unknown'
    ? capability('down', 'MEDIA_WRITE_UNAVAILABLE')
    : capacityLevel === 'critical'
      ? capability('down', 'MEDIA_CAPACITY_CRITICAL')
      : capacityLevel === 'warning'
        ? capability('up', 'MEDIA_CAPACITY_WARNING')
        : capability('up', 'MEDIA_WRITE_READY')
  const videoValidator = videoAvailable
    ? capability('up', 'MEDIA_VIDEO_VALIDATOR_READY')
    : capability('down', 'MEDIA_VIDEO_VALIDATOR_UNAVAILABLE')
  // COS 模式的读取依赖外部服务，物理上不存在「读取不可用时保留读取」的降级路径，
  // 因此读取不可用不再阻止进程启动（preflight 只拦 down），而是以 degraded 让 health
  // 继续以非零退出码告警。本地驱动保持原合同：读取不可用即拒绝启动。
  const status = read.status === 'down'
    ? (remote ? 'degraded' : 'down')
    : write.status === 'down' ||
        videoValidator.status === 'down' ||
        capacityLevel === 'warning'
      ? 'degraded'
      : 'healthy'

  return Object.freeze({
    capabilities: Object.freeze({ read, videoValidator, write }),
    capacity: Object.freeze({ freePercent, level: capacityLevel }),
    status,
  })
}
