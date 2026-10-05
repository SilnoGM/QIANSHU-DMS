import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as defaultFileSystem from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'

import {
  inspectTarGzipArchive,
  validateReleaseTree,
} from './release-package.mjs'
import { STABLE_TAG_PATTERN, parseStableVersion } from './release-version.mjs'
import {
  CommandExecutionError,
  getTrustedCommandExitCode,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptsDirectory, '..')
const supportedPlatform = 'linux/amd64'
const imageArch = 'x64'
const imagePlatform = 'linux'
const metadataFileName = 'release-images.json'
const commandOutputLimit = 1024 * 1024

/*
 * 镜像归档是发布附件的一部分，因此这里的输入约束与 release-package 保持一致：
 * 只接受稳定 Tag、精确的归档命名，并复用同一套归档解析/解包校验，
 * 保证镜像内容与已校验的发布附件完全同源。
 */
const imageDefinitions = Object.freeze({
  server: Object.freeze({
    contextDirectory: 'server-app',
    dockerfile: 'Dockerfile.server',
    kind: 'server',
  }),
  web: Object.freeze({
    contextDirectory: 'web-app',
    dockerfile: 'Dockerfile.web',
    kind: 'web',
  }),
})
const imageOrder = Object.freeze(['server', 'web'])
const stagedDockerAssets = Object.freeze([
  'Dockerfile.server',
  'Dockerfile.web',
  'entrypoint',
  'nginx',
])

export const RELEASE_IMAGES_FAILURE_CODES = Object.freeze({
  archiveInspect: 'RELEASE_IMAGES_ARCHIVE_INSPECT_FAILED',
  imageBuild: 'RELEASE_IMAGES_BUILD_FAILED',
  imageSave: 'RELEASE_IMAGES_SAVE_FAILED',
  metadataWrite: 'RELEASE_IMAGES_METADATA_WRITE_FAILED',
  outputPrepare: 'RELEASE_IMAGES_OUTPUT_PREPARE_FAILED',
  stageCleanup: 'RELEASE_IMAGES_STAGE_CLEANUP_FAILED',
  stagePrepare: 'RELEASE_IMAGES_STAGE_PREPARE_FAILED',
  unknown: 'RELEASE_IMAGES_UNKNOWN_FAILED',
})

// 只有本模块构造的错误才允许把 code 传给报告器；公开属性可以被外部伪造。
const stageErrorCodes = new WeakMap()

function commandExecutionExitCode(error) {
  return getTrustedCommandExitCode(error) ?? 1
}

export class ReleaseImagesStageError extends Error {
  constructor(code, cause) {
    super('Release images stage failed', { cause })
    this.name = 'ReleaseImagesStageError'
    stageErrorCodes.set(this, code)
    Object.defineProperty(this, 'exitCode', {
      enumerable: true,
      value: commandExecutionExitCode(cause),
    })
  }
}

async function withStage(code, operation) {
  try {
    return await operation()
  } catch (cause) {
    if (cause instanceof ReleaseImagesStageError) {
      throw cause
    }
    throw new ReleaseImagesStageError(code, cause)
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has an unsupported shape`)
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function assertStableTag(value) {
  if (typeof value !== 'string' || !STABLE_TAG_PATTERN.test(value)) {
    throw new TypeError('Release tag must be a stable vX.Y.Z tag')
  }
  parseStableVersion(value.slice(1))
  return value
}

function assertDigest(value, label) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`)
  }
  return value
}

function deepFreeze(value) {
  if (isRecord(value) || Array.isArray(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}

function resolveFileSystemMethod(fileSystem, method) {
  const owner = typeof fileSystem?.[method] === 'function'
    ? fileSystem
    : defaultFileSystem
  return owner[method].bind(owner)
}

function defaultRunCapture(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd: options?.cwd, env: options?.env, encoding: 'utf8', maxBuffer: commandOutputLimit },
      (error, stdout) => {
        if (error) {
          reject(new CommandExecutionError(`Command failed: ${command}`, 1, error))
          return
        }
        resolve(stdout)
      },
    )
  })
}

async function defaultSaveImage({ destination, reference }) {
  const child = spawn('docker', ['save', reference], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const status = new Promise(resolve => {
    child.once('error', () => resolve({ exitCode: 1 }))
    child.once('exit', (code, signal) => {
      if (code === null) {
        resolve({ exitCode: 1, signal })
        return
      }
      resolve({ exitCode: code === 0 ? 0 : code })
    })
  })
  try {
    await pipeline(
      child.stdout,
      createGzip({ level: 9 }),
      createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
    )
  } catch (error) {
    // 落盘失败时先结束子进程，避免它继续向已关闭的管道写入。
    child.kill('SIGTERM')
    await status
    throw new CommandExecutionError('Image archive write failed', 1, error)
  }
  const result = await status
  if (result.exitCode !== 0) {
    throw new CommandExecutionError('docker save failed', result.exitCode)
  }
}

function normalizeDependencies(dependencies = {}) {
  if (!isRecord(dependencies)) {
    throw new TypeError('Release Images dependencies must be an object')
  }
  const run = dependencies.run ?? runCommand
  const runCapture = dependencies.runCapture ?? defaultRunCapture
  const saveImage = dependencies.saveImage ?? defaultSaveImage
  const stageApplications = dependencies.stageApplications ?? stageApplicationTrees
  if (
    typeof run !== 'function'
    || typeof runCapture !== 'function'
    || typeof saveImage !== 'function'
    || typeof stageApplications !== 'function'
  ) {
    throw new TypeError('Release Images dependencies are incomplete')
  }
  return {
    fileSystem: dependencies.fileSystem,
    repositoryRoot: path.resolve(dependencies.repositoryRoot ?? defaultRepositoryRoot),
    run,
    runCapture,
    saveImage,
    stageApplications,
    temporaryRoot: path.resolve(dependencies.temporaryRoot ?? os.tmpdir()),
  }
}

function normalizeBuildInput(input) {
  assertExactKeys(
    input,
    ['outputDirectory', 'platform', 'serverArchivePath', 'tag', 'webArchivePath'],
    'Image build input',
  )
  const platform = assertNonEmptyString(input.platform, 'Image platform')
  if (platform !== supportedPlatform) {
    throw new TypeError('Image platform is unsupported')
  }
  return deepFreeze({
    outputDirectory: path.resolve(
      assertNonEmptyString(input.outputDirectory, 'Image output directory'),
    ),
    platform,
    serverArchivePath: path.resolve(
      assertNonEmptyString(input.serverArchivePath, 'Server archive path'),
    ),
    tag: assertStableTag(input.tag),
    webArchivePath: path.resolve(
      assertNonEmptyString(input.webArchivePath, 'Web archive path'),
    ),
  })
}

export function imageArtifactNames(tag) {
  const normalizedTag = assertStableTag(tag)
  return deepFreeze({
    server: `qsmds-server-image-${normalizedTag}-linux-x64.tar.gz`,
    web: `qsmds-web-image-${normalizedTag}-linux-x64.tar.gz`,
  })
}

export function imageReferences(tag) {
  const normalizedTag = assertStableTag(tag)
  return deepFreeze({
    server: `qsmds-server:${normalizedTag}`,
    web: `qsmds-web:${normalizedTag}`,
  })
}

function archivePolicyFor(kind, tag) {
  return {
    kind,
    topLevelName: kind === 'web'
      ? `qsmds-web-${tag}`
      : `qsmds-server-${tag}-linux-x64`,
  }
}

async function runStep(run, command, args, options) {
  const result = await run(command, args, options)
  if (result !== undefined && result !== 0) {
    throw new CommandExecutionError(`Command failed: ${command}`, result)
  }
}

async function hashFile(filePath, fileSystem) {
  const open = resolveFileSystemMethod(fileSystem, 'open')
  const handle = await open(filePath, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.alloc(1024 * 1024)
    let size = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null)
      if (bytesRead === 0) {
        break
      }
      hash.update(buffer.subarray(0, bytesRead))
      size += bytesRead
    }
    return { sha256: hash.digest('hex'), size }
  } finally {
    await handle.close()
  }
}

async function prepareOutputDirectory(directory, fileSystem) {
  const lstat = resolveFileSystemMethod(fileSystem, 'lstat')
  const mkdir = resolveFileSystemMethod(fileSystem, 'mkdir')
  const readdir = resolveFileSystemMethod(fileSystem, 'readdir')
  try {
    await lstat(directory)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
    await mkdir(directory, { mode: 0o700 })
  }
  const stats = await lstat(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Image output must be a real directory')
  }
  if ((await readdir(directory)).length !== 0) {
    throw new Error('Image output directory must start empty')
  }
}

async function stageApplicationTrees(input, stageRoot, dependencies) {
  const { run } = dependencies
  const rename = resolveFileSystemMethod(dependencies.fileSystem, 'rename')
  const archives = {
    server: input.serverArchivePath,
    web: input.webArchivePath,
  }
  for (const kind of imageOrder) {
    const policy = archivePolicyFor(kind, input.tag)
    // 先按 policy 审计原始 tar header，再解包到全新目录，最后复核解包结果。
    await inspectTarGzipArchive(archives[kind], policy, dependencies)
    await runStep(
      run,
      'tar',
      [
        '--extract',
        '--gzip',
        '--file',
        archives[kind],
        '--no-same-owner',
        '--no-same-permissions',
        '--directory',
        stageRoot,
      ],
      { cwd: dependencies.repositoryRoot },
    )
    const extractedRoot = path.join(stageRoot, policy.topLevelName)
    await validateReleaseTree(extractedRoot, policy, dependencies)
    // 固定目录名让 Dockerfile 的 COPY 保持静态；校验已在改名之前完成。
    await rename(extractedRoot, path.join(stageRoot, imageDefinitions[kind].contextDirectory))
  }
}

async function prepareStageRoot(input, dependencies) {
  const mkdtemp = resolveFileSystemMethod(dependencies.fileSystem, 'mkdtemp')
  const cp = resolveFileSystemMethod(dependencies.fileSystem, 'cp')
  const stageRoot = await mkdtemp(
    path.join(dependencies.temporaryRoot, 'qianshu-image-stage-'),
  )
  await dependencies.stageApplications(input, stageRoot, dependencies)
  for (const asset of stagedDockerAssets) {
    await cp(
      path.join(dependencies.repositoryRoot, 'deploy', 'docker', asset),
      path.join(stageRoot, asset),
      { recursive: true },
    )
  }
  return stageRoot
}

async function buildImage(kind, input, stageRoot, outputDirectory, dependencies) {
  const definition = imageDefinitions[kind]
  const reference = imageReferences(input.tag)[kind]
  const artifactName = imageArtifactNames(input.tag)[kind]
  await runStep(
    dependencies.run,
    'docker',
    [
      'build',
      '--platform',
      input.platform,
      '--tag',
      reference,
      '--file',
      path.join(stageRoot, definition.dockerfile),
      stageRoot,
    ],
    { cwd: dependencies.repositoryRoot },
  )
  const imageId = String(
    await dependencies.runCapture(
      'docker',
      ['image', 'inspect', '--format', '{{.Id}}', reference],
      { cwd: dependencies.repositoryRoot },
    ),
  ).trim()
  const digest = assertDigest(imageId, 'Image digest')
  const archivePath = path.join(outputDirectory, artifactName)
  await dependencies.saveImage({ destination: archivePath, reference })
  const hashed = await hashFile(archivePath, dependencies.fileSystem)
  return deepFreeze({
    reference,
    digest,
    archive: artifactName,
    platform: imagePlatform,
    arch: imageArch,
    sha256: `sha256:${hashed.sha256}`,
    size: hashed.size,
  })
}

export async function buildReleaseImages(input, dependencies = {}) {
  const normalizedInput = normalizeBuildInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const rm = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'rm')
  await withStage(
    RELEASE_IMAGES_FAILURE_CODES.outputPrepare,
    () => prepareOutputDirectory(
      normalizedInput.outputDirectory,
      normalizedDependencies.fileSystem,
    ),
  )
  let stageRoot
  let primaryError
  try {
    stageRoot = await withStage(
      RELEASE_IMAGES_FAILURE_CODES.stagePrepare,
      () => prepareStageRoot(normalizedInput, normalizedDependencies),
    )
    const images = {}
    for (const kind of imageOrder) {
      images[kind] = await withStage(
        RELEASE_IMAGES_FAILURE_CODES.imageBuild,
        () => buildImage(
          kind,
          normalizedInput,
          stageRoot,
          normalizedInput.outputDirectory,
          normalizedDependencies,
        ),
      )
    }
    const metadata = {
      schemaVersion: 1,
      tag: normalizedInput.tag,
      images: deepFreeze({ server: images.server, web: images.web }),
    }
    const metadataPath = path.join(
      normalizedInput.outputDirectory,
      metadataFileName,
    )
    await withStage(
      RELEASE_IMAGES_FAILURE_CODES.metadataWrite,
      () => resolveFileSystemMethod(
        normalizedDependencies.fileSystem,
        'writeFile',
      )(
        metadataPath,
        `${JSON.stringify(metadata, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 },
      ),
    )
    return deepFreeze({ metadata, metadataPath })
  } catch (error) {
    primaryError = error instanceof ReleaseImagesStageError
      ? error
      : new ReleaseImagesStageError(
          RELEASE_IMAGES_FAILURE_CODES.unknown,
          error,
        )
    // 失败时不得留下可被误当作发布附件的半成品；输出目录里的名字是确定的。
    for (const artifactName of Object.values(imageArtifactNames(normalizedInput.tag))) {
      await rm(
        path.join(normalizedInput.outputDirectory, artifactName),
        { force: true },
      ).catch(() => {})
    }
    await rm(
      path.join(normalizedInput.outputDirectory, metadataFileName),
      { force: true },
    ).catch(() => {})
    throw primaryError
  } finally {
    let cleanupError
    if (stageRoot !== undefined) {
      try {
        await rm(stageRoot, { force: true, recursive: true })
      } catch (error) {
        cleanupError = error
      }
    }
    if (primaryError === undefined && cleanupError !== undefined) {
      // 没有业务失败时，清理失败本身才是本次调用的稳定原因。
      throw new ReleaseImagesStageError(
        RELEASE_IMAGES_FAILURE_CODES.stageCleanup,
        cleanupError,
      )
    }
  }
}

export function parseReleaseImagesArguments(argv, cwd = process.cwd()) {
  if (!Array.isArray(argv)) {
    throw new TypeError('Release Images arguments must be an array')
  }
  const flags = [
    '--tag',
    '--platform',
    '--server-archive',
    '--web-archive',
    '--output',
  ]
  const usage = 'Usage: release-images --tag vX.Y.Z --platform linux/amd64 --server-archive file --web-archive file --output directory'
  if (argv.length !== flags.length * 2) {
    throw new TypeError(usage)
  }
  const values = {}
  for (let index = 0; index < flags.length; index += 1) {
    const flag = argv[index * 2]
    const value = argv[index * 2 + 1]
    if (flag !== flags[index] || typeof value !== 'string' || value.length === 0) {
      throw new TypeError(usage)
    }
    values[flag] = value
  }
  const normalizedCwd = path.resolve(assertNonEmptyString(cwd, 'Invocation cwd'))
  return deepFreeze({
    outputDirectory: path.resolve(normalizedCwd, values['--output']),
    platform: values['--platform'],
    serverArchivePath: path.resolve(normalizedCwd, values['--server-archive']),
    tag: values['--tag'],
    webArchivePath: path.resolve(normalizedCwd, values['--web-archive']),
  })
}

export async function runReleaseImagesCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  dependencies = {},
  stdout = process.stdout,
} = {}) {
  if (typeof stdout?.write !== 'function') {
    throw new TypeError('Release Images stdout must provide write()')
  }
  const input = parseReleaseImagesArguments(argv, cwd)
  const result = await buildReleaseImages(input, dependencies)
  stdout.write(`${JSON.stringify(result.metadata)}\n`)
  return result
}

export function applyReleaseImagesFailure(
  error,
  processRef = process,
  consoleRef = console,
) {
  processRef.exitCode = error instanceof ReleaseImagesStageError
    ? error.exitCode
    : commandExecutionExitCode(error)
  const code = stageErrorCodes.get(error)
    ?? RELEASE_IMAGES_FAILURE_CODES.unknown
  consoleRef.error(`Release images failed [code=${code}]`)
}

if (isDirectEntry(import.meta.url)) {
  runReleaseImagesCli().catch(error => applyReleaseImagesFailure(error))
}
