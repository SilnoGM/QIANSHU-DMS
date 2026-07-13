import * as defaultFileSystem from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  assertDirectoryContainsOnlyNonEmptyFile,
  replaceArtifactsWithRollback,
  resolveContractPaths,
  withTemporaryDirectory,
} from './contract-files.mjs'
import {
  applyContractFailureToProcess,
  assertOpenApiContract,
  assertSnapshotBytesEqual,
  parseOpenApiSnapshot,
  sha256,
} from './openapi-contract.mjs'
import {
  CommandExecutionError,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptsDirectory, '..')

function resolveFileSystemMethod(fileSystem, method) {
  const owner = typeof fileSystem?.[method] === 'function'
    ? fileSystem
    : defaultFileSystem
  return owner[method].bind(owner)
}

function normalizeRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    throw new TypeError('Repository root must be a non-empty path')
  }
  return path.resolve(repositoryRoot)
}

function normalizeRun(run) {
  if (typeof run !== 'function') {
    throw new TypeError('Contract command runner must be a function')
  }
  return run
}

async function runGenerationCommand(run, command, args, options) {
  const result = await run(command, args, options)
  // runCommand 成功时返回 undefined；测试注入器也可采用常见的 0。任何显式
  // 非零返回值都不能被当作成功，但即便返回 0，后续仍必须校验实际文件树。
  if (result !== undefined && result !== 0) {
    throw new CommandExecutionError(`Command failed: ${command}`, result)
  }
}

export async function canonicalizeTemporaryRoot(temporaryRoot, fileSystem) {
  if (typeof temporaryRoot !== 'string' || temporaryRoot.length === 0) {
    throw new TypeError('Temporary root must be a non-empty path')
  }
  const realpath = resolveFileSystemMethod(fileSystem, 'realpath')
  return realpath(path.resolve(temporaryRoot))
}

export async function readRegularSnapshot(
  snapshotPath,
  label,
  { fileSystem } = {},
) {
  const lstat = resolveFileSystemMethod(fileSystem, 'lstat')
  const readFile = resolveFileSystemMethod(fileSystem, 'readFile')
  const stats = await lstat(snapshotPath)

  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0) {
    throw new Error(`${label} must be a non-empty regular file`)
  }
  return readFile(snapshotPath)
}

export function assertSnapshotIdentity({
  actual,
  expected,
  actualLabel,
  expectedLabel,
}) {
  assertSnapshotBytesEqual({
    actual,
    expected,
    actualLabel,
    expectedLabel,
  })

  // 字节比较与哈希比较都保留为显式断言：前者给出准确语义，后者对应 CI
  // 输出的跨环境 fingerprint，且错误边界绝不包含快照正文。
  if (sha256(actual) !== sha256(expected)) {
    throw new Error(
      `Snapshot hashes differ: ${actualLabel} does not match ${expectedLabel}`,
    )
  }
}

export async function generateContractArtifacts({
  repositoryRoot,
  run,
  temporaryDirectory,
  fileSystem,
  baselineDocument,
}) {
  const serverTemp = path.join(temporaryDirectory, 'openapi.json')
  const webTypesTempDirectory = path.join(temporaryDirectory, 'generated')

  await runGenerationCommand(
    run,
    'pnpm',
    ['-C', 'server', 'openapi:generate', '--output', serverTemp],
    { cwd: repositoryRoot },
  )

  const snapshotBytes = await readRegularSnapshot(
    serverTemp,
    'Generated Server snapshot',
    { fileSystem },
  )
  const document = parseOpenApiSnapshot(
    snapshotBytes,
    'generated Server snapshot',
  )
  assertOpenApiContract(document, { baselineDocument })

  await runGenerationCommand(
    run,
    'pnpm',
    [
      '-C',
      'web',
      'api:generate',
      '--input',
      serverTemp,
      '--output',
      webTypesTempDirectory,
    ],
    { cwd: repositoryRoot },
  )
  await assertDirectoryContainsOnlyNonEmptyFile(
    webTypesTempDirectory,
    'types.gen.ts',
    { fileSystem },
  )

  return {
    document,
    serverTemp,
    snapshotBytes,
    webTypesTempDirectory,
  }
}

export async function contractSync({
  repositoryRoot = defaultRepositoryRoot,
  run = runCommand,
  temporaryRoot = os.tmpdir(),
  fileSystem,
} = {}) {
  const normalizedRepositoryRoot = normalizeRepositoryRoot(repositoryRoot)
  const normalizedRun = normalizeRun(run)
  const canonicalTemporaryRoot = await canonicalizeTemporaryRoot(
    temporaryRoot,
    fileSystem,
  )
  const paths = resolveContractPaths(normalizedRepositoryRoot)

  return withTemporaryDirectory(async (temporaryDirectory) => {
    const {
      snapshotBytes,
      webTypesTempDirectory,
    } = await generateContractArtifacts({
      fileSystem,
      repositoryRoot: normalizedRepositoryRoot,
      run: normalizedRun,
      temporaryDirectory,
    })

    await replaceArtifactsWithRollback([
      {
        kind: 'file',
        path: paths.serverSnapshot,
        contents: snapshotBytes,
      },
      {
        kind: 'file',
        path: paths.webSnapshot,
        contents: snapshotBytes,
      },
      {
        kind: 'directory',
        path: paths.webGeneratedDirectory,
        sourcePath: webTypesTempDirectory,
      },
    ], {
      fileSystem,
      validatePublished: async () => {
        // 最终读回必须在事务 backup 删除前完成，任一不一致
        // 都会由 replaceArtifactsWithRollback 恢复三个旧目标。
        const publishedServerBytes = await readRegularSnapshot(
          paths.serverSnapshot,
          'Published Server snapshot',
          { fileSystem },
        )
        const publishedWebBytes = await readRegularSnapshot(
          paths.webSnapshot,
          'Published Web snapshot',
          { fileSystem },
        )
        assertSnapshotIdentity({
          actual: publishedServerBytes,
          expected: snapshotBytes,
          actualLabel: 'published Server snapshot',
          expectedLabel: 'generated Server snapshot',
        })
        assertSnapshotIdentity({
          actual: publishedWebBytes,
          expected: publishedServerBytes,
          actualLabel: 'published Web snapshot',
          expectedLabel: 'published Server snapshot',
        })
        await assertDirectoryContainsOnlyNonEmptyFile(
          paths.webGeneratedDirectory,
          'types.gen.ts',
          { fileSystem },
        )
      },
      validateStagedDirectory: ({ directory }) => (
        assertDirectoryContainsOnlyNonEmptyFile(
          directory,
          'types.gen.ts',
          { fileSystem },
        )
      ),
    })
  }, {
    fileSystem,
    prefix: 'qianshu-contract-sync-',
    temporaryRoot: canonicalTemporaryRoot,
  })
}

if (isDirectEntry(import.meta.url)) {
  contractSync().catch(error => applyContractFailureToProcess(error))
}
