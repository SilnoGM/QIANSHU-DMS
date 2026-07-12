import { randomUUID } from 'node:crypto'
import * as defaultFileSystem from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const FILE_SYSTEM_METHODS = [
  'cp',
  'lstat',
  'mkdir',
  'mkdtemp',
  'readdir',
  'rename',
  'rm',
  'rmdir',
  'writeFile',
]

const SIBLING_NAME_ATTEMPTS = 100

function resolveFileSystem(fileSystem) {
  return Object.fromEntries(FILE_SYSTEM_METHODS.map((method) => {
    const owner = fileSystem?.[method] ? fileSystem : defaultFileSystem
    const implementation = owner[method]
    if (typeof implementation !== 'function') {
      throw new TypeError(`Filesystem method is required: ${method}`)
    }
    return [method, implementation.bind(owner)]
  }))
}

function assertLeafName(value, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value === '.'
    || value === '..'
    || path.basename(value) !== value
  ) {
    throw new TypeError(`${label} must be a non-empty leaf name`)
  }
}

function assertCanonicalAbsolutePath(value, label) {
  if (
    typeof value !== 'string'
    || !path.isAbsolute(value)
    || path.normalize(value) !== value
    || path.resolve(value) !== value
    || value === path.parse(value).root
  ) {
    throw new TypeError(`${label} must be a canonical absolute non-root path`)
  }
}

function assertExactKeys(value, expectedKeys, label) {
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has an unsupported shape`)
  }
}

function portablePathKey(value) {
  return value.normalize('NFC').toLowerCase()
}

function portablePathsOverlap(left, right) {
  return left === right
    || left.startsWith(`${right}${path.sep}`)
    || right.startsWith(`${left}${path.sep}`)
}

function normalizeArtifacts(artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new TypeError('Artifact list must be a non-empty array')
  }

  const normalized = artifacts.map((artifact, index) => {
    const label = `Artifact ${index}`
    if (artifact === null || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new TypeError(`${label} must be an object`)
    }

    if (artifact.kind === 'file') {
      assertExactKeys(artifact, ['kind', 'path', 'contents'], label)
      assertCanonicalAbsolutePath(artifact.path, `${label} target`)
      if (
        typeof artifact.contents !== 'string'
        && !ArrayBuffer.isView(artifact.contents)
      ) {
        throw new TypeError(`${label} contents must be bytes or a string`)
      }
      return { ...artifact }
    }

    if (artifact.kind === 'directory') {
      assertExactKeys(artifact, ['kind', 'path', 'sourcePath'], label)
      assertCanonicalAbsolutePath(artifact.path, `${label} target`)
      assertCanonicalAbsolutePath(artifact.sourcePath, `${label} source`)
      return { ...artifact }
    }

    throw new TypeError(`${label} kind is unsupported`)
  })

  const targets = normalized.map(artifact => artifact.path)
  // 即使当前 checkout 位于大小写敏感、Unicode 不归一化的文件系统，也采用
  // 保守 portable key 拒绝未来复制到常见大小写不敏感文件系统时会别名的目标。
  const portableTargets = targets.map(portablePathKey)
  if (new Set(portableTargets).size !== portableTargets.length) {
    throw new Error('Artifact targets must be unique')
  }

  for (let leftIndex = 0; leftIndex < portableTargets.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < portableTargets.length;
      rightIndex += 1
    ) {
      const left = portableTargets[leftIndex]
      const right = portableTargets[rightIndex]
      if (portablePathsOverlap(left, right)) {
        throw new Error('Artifact targets must not overlap by ancestry')
      }
    }
  }

  return normalized
}

async function lstatIfPresent(fileSystem, entryPath) {
  try {
    return await fileSystem.lstat(entryPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

function absolutePathComponents(absolutePath) {
  const root = path.parse(absolutePath).root
  const components = [root]
  let current = root

  for (const segment of absolutePath.slice(root.length).split(path.sep)) {
    if (segment.length === 0) {
      continue
    }
    current = path.join(current, segment)
    components.push(current)
  }

  return components
}

async function inspectTargetPath(targetPath, fileSystem) {
  const components = absolutePathComponents(targetPath)
  const targetIndex = components.length - 1

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index]
    const stats = await lstatIfPresent(fileSystem, component)

    if (!stats) {
      return {
        targetExists: false,
        missingParents: components.slice(index, targetIndex),
      }
    }

    if (stats.isSymbolicLink()) {
      throw new Error('Artifact target path must not contain symbolic links')
    }

    if (index < targetIndex && !stats.isDirectory()) {
      throw new Error('Every existing artifact target parent must be a directory')
    }
  }

  return { targetExists: true, missingParents: [] }
}

async function assertDirectorySource(sourcePath, fileSystem) {
  const stats = await fileSystem.lstat(sourcePath)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('Directory artifact source must be a real directory')
  }
}

async function chooseSiblingPaths(
  targetPath,
  occupiedPathKeys,
  fileSystem,
  randomUUIDImpl,
) {
  const parent = path.dirname(targetPath)
  const baseName = path.basename(targetPath)

  for (let attempt = 0; attempt < SIBLING_NAME_ATTEMPTS; attempt += 1) {
    const identifier = randomUUIDImpl()
    if (typeof identifier !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(identifier)) {
      throw new TypeError('Transaction UUID must be a filesystem-safe string')
    }

    const prefix = `.${baseName}.${identifier}`
    const tempPath = path.join(parent, `${prefix}.tmp`)
    const backupPath = path.join(parent, `${prefix}.bak`)
    const candidateKeys = [tempPath, backupPath].map(portablePathKey)
    const collidesWithPlan = candidateKeys.some(candidateKey => (
      [...occupiedPathKeys].some(occupiedKey => (
        portablePathsOverlap(candidateKey, occupiedKey)
      ))
    )) || portablePathsOverlap(candidateKeys[0], candidateKeys[1])

    if (
      !collidesWithPlan
      && !await lstatIfPresent(fileSystem, tempPath)
      && !await lstatIfPresent(fileSystem, backupPath)
    ) {
      for (const candidateKey of candidateKeys) {
        occupiedPathKeys.add(candidateKey)
      }
      return { tempPath, backupPath }
    }
  }

  throw new Error('Unable to reserve collision-free sibling artifact paths')
}

async function preflightArtifacts(artifacts, fileSystem, randomUUIDImpl) {
  const occupiedPathKeys = new Set(
    artifacts.map(artifact => portablePathKey(artifact.path)),
  )
  const plans = []

  for (const artifact of artifacts) {
    const targetInspection = await inspectTargetPath(artifact.path, fileSystem)
    if (artifact.kind === 'directory') {
      await assertDirectorySource(artifact.sourcePath, fileSystem)
    }
    plans.push({ artifact, ...targetInspection })
  }

  for (const plan of plans) {
    Object.assign(
      plan,
      await chooseSiblingPaths(
        plan.artifact.path,
        occupiedPathKeys,
        fileSystem,
        randomUUIDImpl,
      ),
      {
        backupOwnership: 'none',
        backupState: plan.targetExists ? 'at-target' : 'not-required',
        installState: 'not-staged',
        recoveryErrors: [],
        tempOwnership: 'none',
      },
    )
  }

  return plans
}

async function createMissingParents(plans, fileSystem, createdParents) {
  const seen = new Set()
  const missingParents = plans.flatMap(plan => plan.missingParents)

  for (const directory of missingParents) {
    if (seen.has(directory)) {
      continue
    }
    seen.add(directory)

    try {
      await fileSystem.mkdir(directory)
      createdParents.push(directory)
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }

      const stats = await fileSystem.lstat(directory)
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error('Concurrent target parent is not a real directory')
      }
    }
  }
}

function addRecoveryError(plan, message) {
  plan.recoveryErrors.push(new Error(message))
}

async function reconcileStagingFailure(plan, fileSystem, stagingError) {
  if (['EEXIST', 'ERR_FS_CP_EEXIST'].includes(stagingError?.code)) {
    // wx/cp 的 destination-exists 失败证明本次 staging 没有取得该路径所有权；
    // 即使 preflight 时路径不存在，也必须将随后出现的 foreign path 原样保留。
    plan.tempOwnership = 'unknown'
    plan.installState = 'ambiguous'
    addRecoveryError(plan, 'Staging destination ownership is ambiguous')
    return
  }

  try {
    const tempStats = await lstatIfPresent(fileSystem, plan.tempPath)
    plan.tempOwnership = tempStats ? 'owned' : 'none'
    plan.installState = tempStats ? 'staged' : 'not-staged'
  } catch {
    plan.tempOwnership = 'unknown'
    plan.installState = 'ambiguous'
    addRecoveryError(plan, 'Staging temp ownership could not be determined')
  }
}

async function stageArtifacts(plans, fileSystem) {
  for (const plan of plans) {
    try {
      if (plan.artifact.kind === 'file') {
        await fileSystem.writeFile(
          plan.tempPath,
          plan.artifact.contents,
          { flag: 'wx' },
        )
      } else {
        await fileSystem.cp(plan.artifact.sourcePath, plan.tempPath, {
          recursive: true,
          errorOnExist: true,
          force: false,
        })
      }
    } catch (error) {
      // writeFile/cp 可能先创建完整或部分 temp 再 reject；通过 lstat 确认后
      // 才取得 cleanup ownership，避免按预先计算的路径盲删非事务文件。
      await reconcileStagingFailure(plan, fileSystem, error)
      throw error
    }

    plan.tempOwnership = 'owned'
    plan.installState = 'staged'
  }
}

async function observeRenameOutcome(source, destination, fileSystem) {
  let sourceExists
  let destinationExists
  let observationFailed = false

  try {
    sourceExists = Boolean(await lstatIfPresent(fileSystem, source))
  } catch {
    observationFailed = true
  }

  try {
    destinationExists = Boolean(await lstatIfPresent(fileSystem, destination))
  } catch {
    observationFailed = true
  }

  if (observationFailed) {
    return { outcome: 'ambiguous', sourceExists, destinationExists }
  }
  if (!sourceExists && destinationExists) {
    return { outcome: 'applied', sourceExists, destinationExists }
  }
  if (sourceExists && !destinationExists) {
    return { outcome: 'not-applied', sourceExists, destinationExists }
  }
  return { outcome: 'ambiguous', sourceExists, destinationExists }
}

function markBackupMoved(plan) {
  plan.backupOwnership = 'owned'
  plan.backupState = 'moved'
}

function markArtifactInstalled(plan) {
  plan.installState = 'installed'
  plan.tempOwnership = 'none'
}

function markArtifactReturnedToTemp(plan) {
  plan.installState = 'staged'
  plan.tempOwnership = 'owned'
}

function markBackupRestored(plan) {
  plan.backupOwnership = 'none'
  plan.backupState = 'at-target'
}

function markBackupOutcomeAmbiguous(plan) {
  plan.backupOwnership = 'unknown'
  plan.backupState = 'ambiguous'
  addRecoveryError(plan, 'Backup rename outcome is ambiguous')
}

function markInstallOutcomeAmbiguous(plan, observation) {
  plan.installState = 'ambiguous'
  if (observation.sourceExists === false) {
    plan.tempOwnership = 'none'
  } else if (observation.sourceExists !== true) {
    plan.tempOwnership = 'unknown'
  }
  addRecoveryError(plan, 'Install rename outcome is ambiguous')
}

async function moveTargetToBackup(plan, fileSystem) {
  try {
    await fileSystem.rename(plan.artifact.path, plan.backupPath)
  } catch (error) {
    const observation = await observeRenameOutcome(
      plan.artifact.path,
      plan.backupPath,
      fileSystem,
    )
    if (observation.outcome === 'applied') {
      markBackupMoved(plan)
    } else if (observation.outcome === 'ambiguous') {
      markBackupOutcomeAmbiguous(plan)
    }
    throw error
  }
  markBackupMoved(plan)
}

async function installTempAtTarget(plan, fileSystem) {
  try {
    await fileSystem.rename(plan.tempPath, plan.artifact.path)
  } catch (error) {
    const observation = await observeRenameOutcome(
      plan.tempPath,
      plan.artifact.path,
      fileSystem,
    )
    if (observation.outcome === 'applied') {
      markArtifactInstalled(plan)
    } else if (observation.outcome === 'ambiguous') {
      markInstallOutcomeAmbiguous(plan, observation)
    }
    throw error
  }
  markArtifactInstalled(plan)
}

async function publishArtifacts(plans, fileSystem) {
  for (const plan of plans) {
    if (plan.targetExists) {
      await moveTargetToBackup(plan, fileSystem)
    }
    await installTempAtTarget(plan, fileSystem)
  }
}

async function moveInstalledTargetBackToTemp(plan, fileSystem) {
  try {
    await fileSystem.rename(plan.artifact.path, plan.tempPath)
  } catch (error) {
    const observation = await observeRenameOutcome(
      plan.artifact.path,
      plan.tempPath,
      fileSystem,
    )
    if (observation.outcome === 'applied') {
      markArtifactReturnedToTemp(plan)
      return
    }
    if (observation.outcome === 'ambiguous') {
      plan.installState = 'ambiguous'
      plan.tempOwnership = observation.destinationExists === true
        ? 'unknown'
        : 'none'
      addRecoveryError(plan, 'Rollback install rename outcome is ambiguous')
    }
    throw error
  }
  markArtifactReturnedToTemp(plan)
}

async function restoreBackupToTarget(plan, fileSystem) {
  try {
    await fileSystem.rename(plan.backupPath, plan.artifact.path)
  } catch (error) {
    const observation = await observeRenameOutcome(
      plan.backupPath,
      plan.artifact.path,
      fileSystem,
    )
    if (observation.outcome === 'applied') {
      markBackupRestored(plan)
      return
    }
    if (observation.outcome === 'ambiguous') {
      markBackupOutcomeAmbiguous(plan)
    }
    throw error
  }
  markBackupRestored(plan)
}

async function rollbackPublishedArtifacts(plans, fileSystem, errors) {
  for (const plan of [...plans].reverse()) {
    if (plan.installState !== 'installed') {
      continue
    }
    try {
      await moveInstalledTargetBackToTemp(plan, fileSystem)
    } catch (error) {
      errors.push(error)
    }
  }

  // backup 只有在 install 明确未生效或已明确退回 owned temp 后才能恢复。
  // 任一歧义都保留可能唯一的旧副本并报告 recovery incomplete。
  for (const plan of [...plans].reverse()) {
    if (plan.backupState !== 'moved') {
      continue
    }
    if (plan.installState !== 'staged') {
      errors.push(new Error('Backup restore skipped because target state is ambiguous'))
      continue
    }
    try {
      await restoreBackupToTarget(plan, fileSystem)
    } catch (error) {
      errors.push(error)
    }
  }
}

async function removeOwnedTemps(plans, fileSystem, errors) {
  for (const plan of plans) {
    if (plan.tempOwnership !== 'owned') {
      continue
    }
    try {
      await fileSystem.rm(plan.tempPath, { recursive: true, force: true })
      plan.tempOwnership = 'none'
    } catch (error) {
      errors.push(error)
    }
  }
}

async function removeCommittedBackups(plans, fileSystem, errors) {
  for (const plan of plans) {
    if (plan.backupOwnership !== 'owned' || plan.backupState !== 'moved') {
      continue
    }
    try {
      await fileSystem.rm(plan.backupPath, { recursive: true, force: true })
      plan.backupOwnership = 'none'
      plan.backupState = 'discarded'
    } catch (error) {
      errors.push(error)
    }
  }
}

async function cleanupCreatedParents(createdParents, fileSystem, errors) {
  const deepestFirst = [...new Set(createdParents)].sort((left, right) => (
    absolutePathComponents(right).length - absolutePathComponents(left).length
    || right.localeCompare(left)
  ))

  for (const directory of deepestFirst) {
    try {
      // rmdir 只会删除空目录，保证不会误删并发写入或既有 canary。
      await fileSystem.rmdir(directory)
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error?.code)) {
        errors.push(error)
      }
    }
  }
}

function throwOperationError(operationError, recoveryErrors) {
  if (recoveryErrors.length === 0) {
    throw operationError
  }

  throw new AggregateError(
    [operationError, ...recoveryErrors],
    'Artifact replacement failed and recovery was incomplete',
    { cause: operationError },
  )
}

function preserveCallbackErrorWithCleanupFailure(callbackError, cleanupError) {
  if (
    (typeof callbackError === 'object' && callbackError !== null)
    || typeof callbackError === 'function'
  ) {
    try {
      // 保留原错误的 prototype、identity 与 exitCode；非枚举属性避免常规日志
      // 意外展开 cleanup 细节，同时让调用方能够明确检查临时目录清理失败。
      Object.defineProperty(callbackError, 'cleanupError', {
        configurable: true,
        enumerable: false,
        value: cleanupError,
      })
      return
    } catch {
      // frozen/non-extensible throwables 无法安全附加属性，转入安全聚合错误。
    }
  }

  throw new AggregateError(
    [callbackError, cleanupError],
    'Temporary directory callback and cleanup both failed',
    { cause: callbackError },
  )
}

export function resolveContractPaths(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    throw new TypeError('Repository root must be a non-empty path')
  }

  const absoluteRoot = path.resolve(repositoryRoot)
  return {
    serverSnapshot: path.join(absoluteRoot, 'server', 'openapi', 'openapi.json'),
    webSnapshot: path.join(absoluteRoot, 'web', 'openapi', 'openapi.json'),
    webGeneratedDirectory: path.join(
      absoluteRoot,
      'web',
      'apps',
      'qsmds-arco',
      'src',
      'api',
      'generated',
    ),
  }
}

export async function withTemporaryDirectory(
  callback,
  {
    temporaryRoot = os.tmpdir(),
    prefix = 'qianshu-contract-',
    fileSystem,
  } = {},
) {
  if (typeof callback !== 'function') {
    throw new TypeError('Temporary directory callback must be a function')
  }
  assertLeafName(prefix, 'Temporary directory prefix')

  const workingFileSystem = resolveFileSystem(fileSystem)
  const directory = await workingFileSystem.mkdtemp(path.join(temporaryRoot, prefix))
  let callbackFailed = false
  let callbackError

  try {
    return await callback(directory)
  } catch (error) {
    callbackFailed = true
    callbackError = error
    throw error
  } finally {
    try {
      await workingFileSystem.rm(directory, { recursive: true, force: true })
    } catch (cleanupError) {
      // callback 原错误比清理错误更接近根因，不能被 finally 覆盖。
      if (!callbackFailed) {
        throw cleanupError
      }
      preserveCallbackErrorWithCleanupFailure(callbackError, cleanupError)
    }
  }
}

export async function assertDirectoryContainsOnlyNonEmptyFile(
  directory,
  fileName,
  { fileSystem } = {},
) {
  assertLeafName(fileName, 'Expected file name')
  const workingFileSystem = resolveFileSystem(fileSystem)
  const directoryStats = await workingFileSystem.lstat(directory)

  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
    throw new Error('Expected a real generated directory')
  }

  const entries = await workingFileSystem.readdir(directory, { withFileTypes: true })
  if (entries.length !== 1 || entries[0].name !== fileName) {
    throw new Error('Generated directory must contain exactly the expected file')
  }

  const fileStats = await workingFileSystem.lstat(path.join(directory, fileName))
  if (fileStats.isSymbolicLink() || !fileStats.isFile() || fileStats.size <= 0) {
    throw new Error('Generated entry must be a non-empty regular file')
  }
}

export async function replaceArtifactsWithRollback(
  artifacts,
  { fileSystem, randomUUIDImpl = randomUUID } = {},
) {
  if (typeof randomUUIDImpl !== 'function') {
    throw new TypeError('randomUUIDImpl must be a function')
  }

  const normalizedArtifacts = normalizeArtifacts(artifacts)
  const workingFileSystem = resolveFileSystem(fileSystem)
  const plans = await preflightArtifacts(
    normalizedArtifacts,
    workingFileSystem,
    randomUUIDImpl,
  )
  const createdParents = []

  try {
    await createMissingParents(plans, workingFileSystem, createdParents)
    await stageArtifacts(plans, workingFileSystem)

    // 单个 artifact 的同目录 rename 具备文件系统原子性；多个 artifact 之间
    // 只提供当前进程内的逆序 rollback，不承诺断电或进程崩溃级事务语义。
    await publishArtifacts(plans, workingFileSystem)
  } catch (operationError) {
    const recoveryErrors = []
    await rollbackPublishedArtifacts(plans, workingFileSystem, recoveryErrors)
    recoveryErrors.push(
      ...plans.flatMap(plan => plan.recoveryErrors),
    )
    await removeOwnedTemps(plans, workingFileSystem, recoveryErrors)
    // 失败路径绝不删除 backup：已恢复的 backup 路径已不存在；仍存在的 owned
    // 或 unknown backup 可能是唯一旧副本，必须原样保留供人工恢复。
    await cleanupCreatedParents(createdParents, workingFileSystem, recoveryErrors)
    throwOperationError(operationError, recoveryErrors)
  }

  const cleanupErrors = []
  await removeOwnedTemps(plans, workingFileSystem, cleanupErrors)
  await removeCommittedBackups(plans, workingFileSystem, cleanupErrors)
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Published artifact cleanup failed')
  }
}
