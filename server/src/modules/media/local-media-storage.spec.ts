import { createHash } from 'node:crypto'
import { finished } from 'node:stream/promises'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  type FileHandle,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { MediaConfiguration } from '../../config/media.config'
import {
  MediaStorageError,
  normalizeMediaObjectKey,
} from './media-storage'
import {
  LocalMediaStorage,
  type LocalMediaStorageDependencies,
} from './local-media-storage'

const ASSET_ID = '00000000-0000-4000-8000-000000000321'
const SECOND_ASSET_ID = '00000000-0000-4000-8000-000000000322'
const RANDOM_ID = '00000000-0000-4000-8000-000000000654'
const OBJECT_KEY = `assets/2026/08/${ASSET_ID}.webp`
const TRASH_KEY = `trash/2026/08/${ASSET_ID}.webp`

function configuration(storageRoot: string): MediaConfiguration {
  return {
    driver: 'local',
    ffprobePath: '/usr/bin/ffprobe',
    qpdfPath: '/usr/bin/qpdf',
    storageRoot,
    stagingTtlHours: 24,
    trashRetentionDays: 7,
  }
}

function testDependencies(
  overrides: Partial<LocalMediaStorageDependencies> = {},
): Partial<LocalMediaStorageDependencies> {
  return {
    // 真实默认边界必须拒绝系统临时目录；文件行为测试显式把自身一次性 sandbox
    // 视为可信测试根，避免为测试放宽生产路径策略。
    forbiddenRoots: [],
    randomUuid: () => RANDOM_ID,
    ...overrides,
  }
}

async function expectStorageError(
  action: () => Promise<unknown>,
  code: MediaStorageError['code'],
  sensitiveCanary?: string,
): Promise<void> {
  try {
    await action()
    throw new Error('Expected media storage operation to fail')
  }
  catch (error) {
    expect(error).toBeInstanceOf(MediaStorageError)
    expect((error as MediaStorageError).code).toBe(code)
    if (sensitiveCanary) {
      expect((error as Error).message).not.toContain(sensitiveCanary)
    }
  }
}

describe('LocalMediaStorage', () => {
  let sandbox: string
  let storageRoot: string

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), 'qianshu-media-storage-test-'))
    storageRoot = join(sandbox, 'media')
    await mkdir(storageRoot, { mode: 0o750 })
  })

  afterEach(async () => {
    await rm(sandbox, { force: true, recursive: true })
  })

  it('rejects default system-temp, source/release descendants and symlink roots', async () => {
    const defaultHealth = await LocalMediaStorage.checkHealth(
      configuration(storageRoot),
    )
    expect(defaultHealth).toEqual({
      code: 'MEDIA_STORAGE_ROOT_UNSAFE',
      status: 'down',
    })

    const forbiddenParent = join(sandbox, 'release')
    const forbiddenRoot = join(forbiddenParent, 'media')
    await mkdir(forbiddenRoot, { mode: 0o750, recursive: true })
    expect(
      await LocalMediaStorage.checkHealth(
        configuration(forbiddenRoot),
        testDependencies({ forbiddenRoots: [forbiddenParent] }),
      ),
    ).toEqual({
      code: 'MEDIA_STORAGE_ROOT_UNSAFE',
      status: 'down',
    })

    const realRoot = join(sandbox, 'real-media')
    const linkedRoot = join(sandbox, 'linked-media')
    await mkdir(realRoot, { mode: 0o750 })
    await symlink(realRoot, linkedRoot, 'dir')
    expect(
      await LocalMediaStorage.checkHealth(
        configuration(linkedRoot),
        testDependencies(),
      ),
    ).toEqual({
      code: 'MEDIA_STORAGE_ROOT_UNSAFE',
      status: 'down',
    })
  })

  it('creates same-filesystem private directories and reports a fixed healthy result', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )

    await expect(storage.checkHealth()).resolves.toEqual({
      code: 'MEDIA_STORAGE_READY',
      status: 'up',
    })
    for (const directory of ['staging', 'assets', 'trash']) {
      const metadata = await stat(join(storageRoot, directory))
      expect(metadata.isDirectory()).toBe(true)
      expect(metadata.mode & 0o777).toBe(0o750)
    }
  })

  it('exposes only a verified staging path inside the validation callback', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    const staging = await storage.createStagingWrite(ASSET_ID)
    staging.stream.end('trusted')
    await finished(staging.stream)

    const result = await storage.withStagingValidationSource(
      staging.key,
      async (sourcePath) => {
        expect(sourcePath).toBe(join(
          await realpath(storageRoot),
          ...staging.key.split('/'),
        ))
        return readFile(sourcePath, 'utf8')
      },
    )
    expect(result).toBe('trusted')

    await expectStorageError(
      () => storage.withStagingValidationSource(
        OBJECT_KEY,
        () => Promise.resolve(undefined),
      ),
      'MEDIA_STORAGE_INVALID_KEY',
    )
  })

  it('fails closed when the root or a managed directory is writable by untrusted users', async () => {
    await chmod(storageRoot, 0o777)
    expect(
      await LocalMediaStorage.checkHealth(
        configuration(storageRoot),
        testDependencies(),
      ),
    ).toEqual({
      code: 'MEDIA_STORAGE_ROOT_UNSAFE',
      status: 'down',
    })

    await chmod(storageRoot, 0o750)
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    await chmod(join(storageRoot, 'assets'), 0o777)
    await expect(storage.checkHealth()).resolves.toEqual({
      code: 'MEDIA_STORAGE_ROOT_UNSAFE',
      status: 'down',
    })
  })

  it('returns sanitized health failures for unavailable, cross-device and insufficient storage', async () => {
    const sensitivePath = `${storageRoot}/do-not-print`
    const unavailable = await LocalMediaStorage.checkHealth(
      configuration(storageRoot),
      testDependencies({
        access: jest.fn().mockRejectedValue(
          Object.assign(new Error(sensitivePath), { code: 'EACCES' }),
        ),
      }),
    )
    expect(unavailable).toEqual({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
      status: 'down',
    })
    expect(JSON.stringify(unavailable)).not.toContain(sensitivePath)

    const realRootMetadata = await lstat(storageRoot)
    const crossDevice = await LocalMediaStorage.checkHealth(
      configuration(storageRoot),
      testDependencies({
        lstat: async (path) => {
          const metadata = await lstat(path)
          if (path.endsWith('/assets')) {
            return Object.assign(metadata, { dev: realRootMetadata.dev + 1 })
          }
          return metadata
        },
      }),
    )
    expect(crossDevice).toEqual({
      code: 'MEDIA_STORAGE_FILESYSTEM_MISMATCH',
      status: 'down',
    })

    const insufficient = await LocalMediaStorage.checkHealth(
      configuration(storageRoot),
      testDependencies({
        statFileSystem: jest.fn().mockResolvedValue({
          availableBlocks: 1n,
          blockSize: 4_096n,
          totalBlocks: 100n,
        }),
      }),
      4_097n,
    )
    expect(insufficient).toEqual({
      code: 'MEDIA_STORAGE_INSUFFICIENT_SPACE',
      status: 'down',
    })
  })

  it('streams into a random private staging file and cancellation removes partial bytes', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    const stagingWrite = await storage.createStagingWrite(ASSET_ID)

    expect(stagingWrite.key).toBe(
      `staging/${ASSET_ID}.${RANDOM_ID}.part`,
    )
    stagingWrite.stream.write(Buffer.from('partial-content'))
    await stagingWrite.cancel()

    await expect(storage.stat(stagingWrite.key)).resolves.toBeNull()
  })

  it('fails closed for new writes below 10 percent free space while existing reads continue', async () => {
    let capacity = {
      availableBlocks: 50n,
      blockSize: 4_096n,
      totalBlocks: 100n,
    }
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies({
        statFileSystem: jest.fn(() => Promise.resolve(capacity)),
      }),
    )
    const stagingWrite = await storage.createStagingWrite(ASSET_ID)
    stagingWrite.stream.end(Buffer.from('readable-after-critical'))
    await finished(stagingWrite.stream)
    await storage.finalize(stagingWrite.key, OBJECT_KEY)

    capacity = {
      availableBlocks: 9n,
      blockSize: 4_096n,
      totalBlocks: 100n,
    }

    await expectStorageError(
      () => storage.createStagingWrite(SECOND_ASSET_ID),
      'MEDIA_STORAGE_INSUFFICIENT_SPACE',
    )
    const readable = await storage.open(OBJECT_KEY)
    const chunks: Buffer[] = []
    for await (const chunk of readable.stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString('utf8')).toBe(
      'readable-after-critical',
    )
  })

  it('finalizes without buffering, preserves file mode and refuses a target conflict', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    const stagingWrite = await storage.createStagingWrite(ASSET_ID)
    stagingWrite.stream.end(Buffer.from('trusted-content'))
    await finished(stagingWrite.stream)

    await storage.finalize(stagingWrite.key, OBJECT_KEY)
    expect(await readFile(join(storageRoot, OBJECT_KEY), 'utf8')).toBe(
      'trusted-content',
    )
    expect((await stat(join(storageRoot, OBJECT_KEY))).mode & 0o777).toBe(0o640)
    await expect(storage.stat(stagingWrite.key)).resolves.toBeNull()

    const conflictingWrite = await storage.createStagingWrite(ASSET_ID)
    conflictingWrite.stream.end(Buffer.from('must-remain-staging'))
    await finished(conflictingWrite.stream)
    await expectStorageError(
      () => storage.finalize(conflictingWrite.key, OBJECT_KEY),
      'MEDIA_STORAGE_CONFLICT',
    )
    expect(await readFile(join(storageRoot, OBJECT_KEY), 'utf8')).toBe(
      'trusted-content',
    )
    expect(
      await readFile(join(storageRoot, conflictingWrite.key), 'utf8'),
    ).toBe('must-remain-staging')
    await conflictingWrite.cancel()
  })

  it('supports streaming range reads, trash, restore, stat and idempotent purge', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    const stagingWrite = await storage.createStagingWrite(ASSET_ID)
    stagingWrite.stream.end(Buffer.from('0123456789'))
    await finished(stagingWrite.stream)
    await storage.finalize(stagingWrite.key, OBJECT_KEY)

    const expectedChecksum = createHash('sha256')
      .update(Buffer.from('0123456789'))
      .digest('hex')
    await expect(storage.checksumSha256(OBJECT_KEY)).resolves.toBe(
      expectedChecksum,
    )

    const readable = await storage.open(OBJECT_KEY, { end: 6, start: 3 })
    const chunks: Buffer[] = []
    for await (const chunk of readable.stream) {
      chunks.push(Buffer.from(chunk))
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('3456')
    expect(readable).toMatchObject({
      contentLength: 4n,
      sizeBytes: 10n,
    })

    await storage.moveToTrash(OBJECT_KEY, TRASH_KEY)
    await expect(storage.checksumSha256(TRASH_KEY)).resolves.toBe(
      expectedChecksum,
    )
    await expect(storage.stat(OBJECT_KEY)).resolves.toBeNull()
    await expect(storage.stat(TRASH_KEY)).resolves.toMatchObject({ sizeBytes: 10n })

    await storage.restoreFromTrash(TRASH_KEY, OBJECT_KEY)
    await expect(storage.stat(TRASH_KEY)).resolves.toBeNull()
    await expect(storage.stat(OBJECT_KEY)).resolves.toMatchObject({ sizeBytes: 10n })

    await storage.purge(OBJECT_KEY)
    await storage.purge(OBJECT_KEY)
    await expect(storage.stat(OBJECT_KEY)).resolves.toBeNull()

    await expectStorageError(
      () => storage.checksumSha256(stagingWrite.key),
      'MEDIA_STORAGE_INVALID_KEY',
    )
  })

  it('inventories managed objects with a bounded opaque cursor and namespace prefix', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    const staging = await storage.createStagingWrite(ASSET_ID)
    staging.stream.end('inventory')
    await finished(staging.stream)
    const secondKey = `staging/${SECOND_ASSET_ID}.${RANDOM_ID}.part`
    await writeFile(join(storageRoot, secondKey), 'next', { mode: 0o640 })

    const first = await storage.inventory({
      limit: 1,
      namespace: 'staging',
      prefix: `staging/${ASSET_ID}.`,
    })
    expect(first.objects).toHaveLength(1)
    expect(first.objects[0]).toMatchObject({
      key: staging.key,
      sizeBytes: 9n,
    })
    expect(first.objects[0]?.modifiedAt).toBeInstanceOf(Date)
    expect(first.nextCursor).toBeNull()

    const firstPage = await storage.inventory({
      limit: 1,
      namespace: 'staging',
    })
    expect(firstPage.objects.map(object => object.key)).toEqual([staging.key])
    expect(firstPage.nextCursor).toBe(staging.key)
    const nextCursor = firstPage.nextCursor
    if (nextCursor === null) throw new Error('Expected inventory cursor')
    const secondPage = await storage.inventory({
      cursor: nextCursor,
      limit: 1,
      namespace: 'staging',
    })
    expect(secondPage.objects.map(object => object.key)).toEqual([secondKey])
    expect(secondPage.nextCursor).toBeNull()

    await expect(storage.inventory({
      cursor: OBJECT_KEY,
      limit: 1,
      namespace: 'staging',
    })).rejects.toMatchObject({ code: 'MEDIA_STORAGE_INVALID_KEY' })
    await expect(storage.inventory({
      limit: 0,
      namespace: 'staging',
    })).rejects.toMatchObject({ code: 'MEDIA_STORAGE_INVALID_KEY' })
  })

  it.each([
    '',
    '/assets/file.webp',
    '../assets/file.webp',
    'assets/../file.webp',
    'assets//file.webp',
    'assets\\file.webp',
    'assets/./file.webp',
    'assets/file name.webp',
    'assets/file.webp\0ignored',
  ])('rejects a non-canonical object key without resolving it: %p', (key) => {
    expect(() => normalizeMediaObjectKey(key)).toThrow(MediaStorageError)
  })

  it('rejects stat and purge outside the managed storage namespaces', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    const unmanagedKey = 'configuration/runtime.json'

    await expectStorageError(
      () => storage.stat(unmanagedKey),
      'MEDIA_STORAGE_INVALID_KEY',
    )
    await expectStorageError(
      () => storage.purge(unmanagedKey),
      'MEDIA_STORAGE_INVALID_KEY',
    )
  })

  it('rejects an unsafe symlink component without reading or deleting its target', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    const externalDirectory = join(sandbox, 'external')
    const externalCanary = join(externalDirectory, 'canary.webp')
    await mkdir(externalDirectory)
    await writeFile(externalCanary, 'external-canary', 'utf8')
    await rm(join(storageRoot, 'assets'), { recursive: true })
    await symlink(externalDirectory, join(storageRoot, 'assets'), 'dir')

    await expectStorageError(
      () => storage.stat('assets/canary.webp'),
      'MEDIA_STORAGE_PATH_UNSAFE',
      externalCanary,
    )
    expect(await readFile(externalCanary, 'utf8')).toBe('external-canary')
  })

  it('revalidates the staging parent before opening a new write', async () => {
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies(),
    )
    const externalDirectory = join(sandbox, 'external-staging')
    await mkdir(externalDirectory)
    await rm(join(storageRoot, 'staging'), { recursive: true })
    await symlink(externalDirectory, join(storageRoot, 'staging'), 'dir')

    await expectStorageError(
      () => storage.createStagingWrite(ASSET_ID),
      'MEDIA_STORAGE_PATH_UNSAFE',
    )
    expect((await lstat(externalDirectory)).isDirectory()).toBe(true)
    expect(await readdir(externalDirectory)).toEqual([])
  })

  it('closes the opened file handle before rejecting an invalid byte range', async () => {
    let captureReadHandle = false
    let readHandle: FileHandle | undefined
    let closeSpy: jest.SpyInstance | undefined
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies({
        open: async (path, flags, mode) => {
          const handle = await open(path, flags, mode)
          if (captureReadHandle) {
            readHandle = handle
            closeSpy = jest.spyOn(handle, 'close')
          }
          return handle
        },
      }),
    )
    const stagingWrite = await storage.createStagingWrite(ASSET_ID)
    stagingWrite.stream.end(Buffer.from('short'))
    await finished(stagingWrite.stream)
    await storage.finalize(stagingWrite.key, OBJECT_KEY)
    captureReadHandle = true

    await expectStorageError(
      () => storage.open(OBJECT_KEY, { end: 99, start: 0 }),
      'MEDIA_STORAGE_INVALID_RANGE',
    )
    expect(readHandle).toBeDefined()
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('keeps the staging source after an atomic move failure and hides the OS error', async () => {
    const sensitiveCanary = `${storageRoot}/sensitive-target`
    const storage = await LocalMediaStorage.create(
      configuration(storageRoot),
      testDependencies({
        rename: jest.fn().mockRejectedValue(
          Object.assign(new Error(sensitiveCanary), { code: 'EXDEV' }),
        ),
      }),
    )
    const stagingWrite = await storage.createStagingWrite(ASSET_ID)
    stagingWrite.stream.end(Buffer.from('retained-source'))
    await finished(stagingWrite.stream)

    await expectStorageError(
      () => storage.finalize(stagingWrite.key, OBJECT_KEY),
      'MEDIA_STORAGE_FILESYSTEM_MISMATCH',
      sensitiveCanary,
    )
    expect(await readFile(join(storageRoot, stagingWrite.key), 'utf8')).toBe(
      'retained-source',
    )
    await stagingWrite.cancel()
  })
})
