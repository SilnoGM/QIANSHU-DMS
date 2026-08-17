import { constants as fileSystemConstants, type Stats } from 'node:fs'
import {
  access,
  lstat,
  realpath,
  statfs,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'

import type { MediaConfiguration } from '../../config/media.config'
import { runRestrictedMediaProcess } from './restricted-media-process'

export interface MediaOperationalCapacity {
  readonly availableBlocks: bigint
  readonly blockSize: bigint
  readonly totalBlocks: bigint
}

export interface MediaOperationalHealthDependencies {
  readonly checkReadAccess: (storageRoot: string) => Promise<boolean>
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

const DEFAULT_DEPENDENCIES: MediaOperationalHealthDependencies = Object.freeze({
  checkReadAccess: (storageRoot: string) => checkDirectories(
    storageRoot,
    ['assets', 'trash'],
    fileSystemConstants.R_OK | fileSystemConstants.X_OK,
  ),
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
 */
export async function collectMediaOperationalHealth(
  configuration: MediaConfiguration,
  dependencies: MediaOperationalHealthDependencies = DEFAULT_DEPENDENCIES,
): Promise<MediaOperationalHealthResult> {
  const [readAvailable, writeAvailable, videoAvailable, rawCapacity] =
    await Promise.all([
      dependencies.checkReadAccess(configuration.storageRoot).catch(() => false),
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
  const write = !writeAvailable || capacityLevel === 'unknown'
    ? capability('down', 'MEDIA_WRITE_UNAVAILABLE')
    : capacityLevel === 'critical'
      ? capability('down', 'MEDIA_CAPACITY_CRITICAL')
      : capacityLevel === 'warning'
        ? capability('up', 'MEDIA_CAPACITY_WARNING')
        : capability('up', 'MEDIA_WRITE_READY')
  const videoValidator = videoAvailable
    ? capability('up', 'MEDIA_VIDEO_VALIDATOR_READY')
    : capability('down', 'MEDIA_VIDEO_VALIDATOR_UNAVAILABLE')
  const status = read.status === 'down'
    ? 'down'
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
