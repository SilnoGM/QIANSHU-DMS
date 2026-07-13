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

function normalizeOptionalCallback(callback, label) {
  if (callback !== undefined && typeof callback !== 'function') {
    throw new TypeError(`${label} must be a function when provided`)
  }
  return callback
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

function entryType(stats) {
  if (stats.isFile()) {
    return 'file'
  }
  if (stats.isDirectory()) {
    return 'directory'
  }
  if (stats.isSymbolicLink()) {
    return 'symbolic-link'
  }
  return 'other'
}

function entryIdentity(stats) {
  return { dev: stats.dev, ino: stats.ino, type: entryType(stats) }
}

function sameEntryIdentity(left, right) {
  return (
    left.dev === right.dev
    && left.ino === right.ino
    && left.type === right.type
  )
}

function assertRealDirectoryStats(stats, label) {
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must not become a symbolic link or non-directory`)
  }
}

function rememberTrustedDirectory(
  trustedDirectories,
  directory,
  stats,
  label,
) {
  assertRealDirectoryStats(stats, label)
  const identity = entryIdentity(stats)
  const existingIdentity = trustedDirectories.get(directory)
  if (existingIdentity && !sameEntryIdentity(existingIdentity, identity)) {
    throw new Error(`${label} identity changed during preflight`)
  }
  trustedDirectories.set(directory, identity)
}

async function assertDirectoryIdentity(
  directory,
  expectedIdentity,
  fileSystem,
  label,
) {
  const stats = await fileSystem.lstat(directory)
  assertRealDirectoryStats(stats, label)
  if (!sameEntryIdentity(entryIdentity(stats), expectedIdentity)) {
    throw new Error(`${label} identity changed`)
  }
  return stats
}

async function assertTrustedDirectories(
  trustedDirectories,
  fileSystem,
  label,
) {
  for (const [directory, identity] of trustedDirectories) {
    await assertDirectoryIdentity(
      directory,
      identity,
      fileSystem,
      label,
    )
  }
}

async function assertTrustedTargetParents(trustedDirectories, fileSystem) {
  return assertTrustedDirectories(
    trustedDirectories,
    fileSystem,
    'Artifact target parent',
  )
}

async function readEntryIdentity(entryPath, fileSystem) {
  const stats = await fileSystem.lstat(entryPath)
  if (stats.isSymbolicLink()) {
    throw new Error('Owned artifact leaf must not be a symbolic link')
  }
  return entryIdentity(stats)
}

async function readEntryIdentityIfPresent(entryPath, fileSystem) {
  const stats = await lstatIfPresent(fileSystem, entryPath)
  if (!stats) {
    return undefined
  }
  return entryIdentity(stats)
}

async function assertEntryIdentity(
  entryPath,
  expectedIdentity,
  fileSystem,
  label,
) {
  const actualIdentity = await readEntryIdentity(entryPath, fileSystem)
  if (!sameEntryIdentity(actualIdentity, expectedIdentity)) {
    throw new Error(`${label} identity changed`)
  }
  return actualIdentity
}

async function assertEntryMissing(entryPath, fileSystem, label) {
  if (await lstatIfPresent(fileSystem, entryPath)) {
    throw new Error(`${label} must remain absent`)
  }
}

async function inspectTargetPath(
  targetPath,
  fileSystem,
  trustedDirectories,
) {
  const components = absolutePathComponents(targetPath)
  const targetIndex = components.length - 1

  let originalTargetIdentity
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

    if (index < targetIndex) {
      rememberTrustedDirectory(
        trustedDirectories,
        component,
        stats,
        'Artifact target parent',
      )
    } else {
      originalTargetIdentity = entryIdentity(stats)
    }
  }

  return { originalTargetIdentity, targetExists: true, missingParents: [] }
}

async function inspectDirectorySource(sourcePath, fileSystem) {
  const trustedDirectories = new Map()
  for (const component of absolutePathComponents(sourcePath)) {
    const stats = await fileSystem.lstat(component)
    rememberTrustedDirectory(
      trustedDirectories,
      component,
      stats,
      'Directory artifact source parent',
    )
  }
  return trustedDirectories
}

async function assertDirectorySourceIdentity(plan, fileSystem) {
  await assertTrustedDirectories(
    plan.sourceDirectories,
    fileSystem,
    'Directory artifact source parent',
  )
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
  const trustedDirectories = new Map()

  for (const artifact of artifacts) {
    const targetInspection = await inspectTargetPath(
      artifact.path,
      fileSystem,
      trustedDirectories,
    )
    let sourceDirectories
    if (artifact.kind === 'directory') {
      sourceDirectories = await inspectDirectorySource(
        artifact.sourcePath,
        fileSystem,
      )
    }
    plans.push({ artifact, sourceDirectories, ...targetInspection })
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
        backupIdentity: undefined,
        backupOwnership: 'none',
        backupState: plan.targetExists ? 'at-target' : 'not-required',
        installedIdentity: undefined,
        installState: 'not-staged',
        recoveryErrors: [],
        stagedIdentity: undefined,
        tempOwnership: 'none',
      },
    )
  }

  return { plans, trustedDirectories }
}

async function createMissingParents(
  plans,
  fileSystem,
  createdParents,
  trustedDirectories,
) {
  const seen = new Set()
  const missingParents = plans.flatMap(plan => plan.missingParents)

  for (const directory of missingParents) {
    if (seen.has(directory)) {
      continue
    }
    seen.add(directory)

    // mkdir 之前复核已存在的父目录链，避免在 preflight 与
    // 创建缺失层级之间跟随新出现的 symlink。
    await assertTrustedDirectories(
      trustedDirectories,
      fileSystem,
      'Artifact target parent',
    )

    try {
      await fileSystem.mkdir(directory)
      createdParents.push(directory)
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error
      }
      // 并发创建的真实目录可以被接管，但下方仍会记录
      // 其 dev/ino，后续每个 mutation 边界都必须复核同一身份。
    }

    const stats = await fileSystem.lstat(directory)
    assertRealDirectoryStats(stats, 'Concurrent target parent')
    rememberTrustedDirectory(
      trustedDirectories,
      directory,
      stats,
      'Artifact target parent',
    )
    await assertTrustedDirectories(
      trustedDirectories,
      fileSystem,
      'Artifact target parent',
    )
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
    plan.stagedIdentity = tempStats ? entryIdentity(tempStats) : undefined
  } catch {
    plan.tempOwnership = 'unknown'
    plan.installState = 'ambiguous'
    addRecoveryError(plan, 'Staging temp ownership could not be determined')
  }
}

async function stageArtifacts(
  plans,
  fileSystem,
  trustedDirectories,
  validateStagedDirectory,
) {
  for (const plan of plans) {
    await assertTrustedTargetParents(trustedDirectories, fileSystem)
    if (plan.artifact.kind === 'directory') {
      await assertDirectorySourceIdentity(plan, fileSystem)
    }

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
    await assertTrustedTargetParents(trustedDirectories, fileSystem)

    const stagedStats = await fileSystem.lstat(plan.tempPath)
    const expectedStagedType = plan.artifact.kind === 'file'
      ? 'file'
      : 'directory'
    if (
      stagedStats.isSymbolicLink()
      || entryType(stagedStats) !== expectedStagedType
    ) {
      plan.tempOwnership = 'unknown'
      plan.installState = 'ambiguous'
      addRecoveryError(plan, 'Staged artifact leaf ownership is ambiguous')
      throw new Error('Staged artifact has an unexpected leaf type')
    }
    plan.stagedIdentity = entryIdentity(stagedStats)

    if (plan.artifact.kind === 'directory') {
      // cp 前后的 source inode 必须一致；暂存目录本身也要在
      // 严格内容校验前后保持同一个真实目录身份。
      await assertDirectorySourceIdentity(plan, fileSystem)
      if (validateStagedDirectory) {
        await validateStagedDirectory({
          artifact: plan.artifact,
          directory: plan.tempPath,
        })
      }

      await assertDirectoryIdentity(
        plan.tempPath,
        plan.stagedIdentity,
        fileSystem,
        'Staged directory',
      )
    }
  }
}

async function observeRenameOutcome(
  source,
  destination,
  expectedIdentity,
  fileSystem,
) {
  let sourceIdentity
  let destinationIdentity
  let observationFailed = false

  try {
    sourceIdentity = await readEntryIdentityIfPresent(source, fileSystem)
  } catch {
    observationFailed = true
  }

  try {
    destinationIdentity = await readEntryIdentityIfPresent(
      destination,
      fileSystem,
    )
  } catch {
    observationFailed = true
  }

  if (observationFailed) {
    return { outcome: 'ambiguous', sourceIdentity, destinationIdentity }
  }
  if (
    !sourceIdentity
    && destinationIdentity
    && sameEntryIdentity(destinationIdentity, expectedIdentity)
  ) {
    return { outcome: 'applied', sourceIdentity, destinationIdentity }
  }
  if (
    sourceIdentity
    && sameEntryIdentity(sourceIdentity, expectedIdentity)
    && !destinationIdentity
  ) {
    return { outcome: 'not-applied', sourceIdentity, destinationIdentity }
  }
  return { outcome: 'ambiguous', sourceIdentity, destinationIdentity }
}

function markBackupMoved(plan) {
  plan.backupOwnership = 'owned'
  plan.backupState = 'moved'
  plan.backupIdentity = plan.originalTargetIdentity
}

function markArtifactInstalled(plan) {
  plan.installState = 'installed'
  plan.tempOwnership = 'none'
  plan.installedIdentity = plan.stagedIdentity
}

function markArtifactReturnedToTemp(plan) {
  plan.installState = 'staged'
  plan.tempOwnership = 'owned'
}

function markBackupRestored(plan) {
  plan.backupOwnership = 'none'
  plan.backupState = 'at-target'
}

function markBackupOutcomeAmbiguous(
  plan,
  message = 'Backup rename outcome is ambiguous',
) {
  plan.backupOwnership = 'unknown'
  plan.backupState = 'ambiguous'
  addRecoveryError(plan, message)
}

function markInstallOutcomeAmbiguous(
  plan,
  observation,
  message = 'Install rename outcome is ambiguous',
) {
  plan.installState = 'ambiguous'
  if (!observation.sourceIdentity) {
    plan.tempOwnership = 'none'
  } else if (
    !sameEntryIdentity(observation.sourceIdentity, plan.stagedIdentity)
  ) {
    plan.tempOwnership = 'unknown'
  }
  addRecoveryError(plan, message)
}

function markOriginalTargetOwnershipLost(plan) {
  plan.backupState = 'ambiguous'
  plan.installState = 'ambiguous'
  addRecoveryError(plan, 'Original target leaf ownership was lost')
}

function markStagedOwnershipLost(plan) {
  plan.tempOwnership = 'unknown'
  plan.installState = 'ambiguous'
  addRecoveryError(plan, 'Staged artifact leaf ownership was lost')
}

function markInstalledOwnershipLost(plan) {
  plan.installState = 'ambiguous'
  addRecoveryError(plan, 'Installed artifact leaf ownership was lost')
}

async function assertOriginalTargetOwned(plan, fileSystem) {
  try {
    await assertEntryIdentity(
      plan.artifact.path,
      plan.originalTargetIdentity,
      fileSystem,
      'Original artifact target',
    )
  } catch (error) {
    markOriginalTargetOwnershipLost(plan)
    throw error
  }
}

async function assertStagedArtifactOwned(plan, fileSystem) {
  try {
    await assertEntryIdentity(
      plan.tempPath,
      plan.stagedIdentity,
      fileSystem,
      'Staged artifact',
    )
  } catch (error) {
    markStagedOwnershipLost(plan)
    throw error
  }
}

async function assertBackupOwned(plan, fileSystem) {
  try {
    await assertEntryIdentity(
      plan.backupPath,
      plan.backupIdentity,
      fileSystem,
      'Artifact backup',
    )
  } catch (error) {
    markBackupOutcomeAmbiguous(plan, 'Backup leaf ownership was lost')
    throw error
  }
}

async function assertInstalledArtifactOwned(plan, fileSystem) {
  try {
    await assertEntryIdentity(
      plan.artifact.path,
      plan.installedIdentity,
      fileSystem,
      'Installed artifact',
    )
  } catch (error) {
    markInstalledOwnershipLost(plan)
    throw error
  }
}

async function assertPublishedLeafTokens(plans, fileSystem) {
  for (const plan of plans) {
    if (plan.installState === 'installed') {
      await assertInstalledArtifactOwned(plan, fileSystem)
      await assertEntryMissing(
        plan.tempPath,
        fileSystem,
        'Installed artifact temp',
      )
    }
    if (plan.backupState === 'moved') {
      await assertBackupOwned(plan, fileSystem)
    }
  }
}

async function moveTargetToBackup(plan, fileSystem, trustedDirectories) {
  await assertTrustedTargetParents(trustedDirectories, fileSystem)
  await assertOriginalTargetOwned(plan, fileSystem)
  await assertStagedArtifactOwned(plan, fileSystem)
  try {
    await fileSystem.rename(plan.artifact.path, plan.backupPath)
  } catch (error) {
    const observation = await observeRenameOutcome(
      plan.artifact.path,
      plan.backupPath,
      plan.originalTargetIdentity,
      fileSystem,
    )
    if (observation.outcome === 'applied') {
      markBackupMoved(plan)
    } else if (observation.outcome === 'ambiguous') {
      markBackupOutcomeAmbiguous(plan)
    }
    throw error
  }

  try {
    await assertEntryIdentity(
      plan.backupPath,
      plan.originalTargetIdentity,
      fileSystem,
      'Artifact backup',
    )
  } catch (error) {
    markBackupOutcomeAmbiguous(plan, 'Backup leaf ownership was lost')
    throw error
  }
  markBackupMoved(plan)
  try {
    await assertEntryMissing(
      plan.artifact.path,
      fileSystem,
      'Artifact target after backup',
    )
  } catch (error) {
    markInstalledOwnershipLost(plan)
    throw error
  }
  await assertStagedArtifactOwned(plan, fileSystem)
  await assertTrustedTargetParents(trustedDirectories, fileSystem)
}

async function installTempAtTarget(plan, fileSystem, trustedDirectories) {
  await assertTrustedTargetParents(trustedDirectories, fileSystem)
  await assertStagedArtifactOwned(plan, fileSystem)
  if (plan.backupState === 'moved') {
    await assertBackupOwned(plan, fileSystem)
  }
  try {
    await assertEntryMissing(
      plan.artifact.path,
      fileSystem,
      'Artifact target before install',
    )
  } catch (error) {
    markInstalledOwnershipLost(plan)
    throw error
  }

  try {
    await fileSystem.rename(plan.tempPath, plan.artifact.path)
  } catch (error) {
    const observation = await observeRenameOutcome(
      plan.tempPath,
      plan.artifact.path,
      plan.stagedIdentity,
      fileSystem,
    )
    if (observation.outcome === 'applied') {
      markArtifactInstalled(plan)
    } else if (observation.outcome === 'ambiguous') {
      markInstallOutcomeAmbiguous(plan, observation)
    }
    throw error
  }

  const observation = await observeRenameOutcome(
    plan.tempPath,
    plan.artifact.path,
    plan.stagedIdentity,
    fileSystem,
  )
  if (observation.outcome !== 'applied') {
    markInstallOutcomeAmbiguous(
      plan,
      observation,
      'Installed artifact leaf ownership was lost',
    )
    throw new Error('Installed artifact identity does not match staged artifact')
  }
  markArtifactInstalled(plan)
  if (plan.backupState === 'moved') {
    await assertBackupOwned(plan, fileSystem)
  }
  await assertTrustedTargetParents(trustedDirectories, fileSystem)
}

async function publishArtifacts(plans, fileSystem, trustedDirectories) {
  for (const plan of plans) {
    if (plan.targetExists) {
      await moveTargetToBackup(plan, fileSystem, trustedDirectories)
    }
    await installTempAtTarget(plan, fileSystem, trustedDirectories)
  }
}

async function moveInstalledTargetBackToTemp(
  plan,
  fileSystem,
  trustedDirectories,
) {
  await assertTrustedTargetParents(trustedDirectories, fileSystem)
  if (plan.backupState === 'moved') {
    await assertBackupOwned(plan, fileSystem)
  }
  await assertInstalledArtifactOwned(plan, fileSystem)
  try {
    await assertEntryMissing(
      plan.tempPath,
      fileSystem,
      'Rollback artifact temp',
    )
  } catch (error) {
    markStagedOwnershipLost(plan)
    throw error
  }

  try {
    await fileSystem.rename(plan.artifact.path, plan.tempPath)
  } catch (error) {
    const observation = await observeRenameOutcome(
      plan.artifact.path,
      plan.tempPath,
      plan.installedIdentity,
      fileSystem,
    )
    if (observation.outcome === 'applied') {
      markArtifactReturnedToTemp(plan)
      return
    }
    if (observation.outcome === 'ambiguous') {
      plan.installState = 'ambiguous'
      plan.tempOwnership = observation.destinationIdentity
        ? 'unknown'
        : 'none'
      addRecoveryError(plan, 'Rollback install rename outcome is ambiguous')
    }
    throw error
  }

  const observation = await observeRenameOutcome(
    plan.artifact.path,
    plan.tempPath,
    plan.installedIdentity,
    fileSystem,
  )
  if (observation.outcome !== 'applied') {
    markInstallOutcomeAmbiguous(
      plan,
      observation,
      'Rollback staged leaf ownership was lost',
    )
    throw new Error('Rollback temp identity does not match installed artifact')
  }
  markArtifactReturnedToTemp(plan)
  if (plan.backupState === 'moved') {
    await assertBackupOwned(plan, fileSystem)
  }
  await assertTrustedTargetParents(trustedDirectories, fileSystem)
}

async function restoreBackupToTarget(plan, fileSystem, trustedDirectories) {
  await assertTrustedTargetParents(trustedDirectories, fileSystem)
  await assertBackupOwned(plan, fileSystem)
  await assertStagedArtifactOwned(plan, fileSystem)
  try {
    await assertEntryMissing(
      plan.artifact.path,
      fileSystem,
      'Artifact target before backup restore',
    )
  } catch (error) {
    markInstalledOwnershipLost(plan)
    throw error
  }

  try {
    await fileSystem.rename(plan.backupPath, plan.artifact.path)
  } catch (error) {
    const observation = await observeRenameOutcome(
      plan.backupPath,
      plan.artifact.path,
      plan.backupIdentity,
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

  const observation = await observeRenameOutcome(
    plan.backupPath,
    plan.artifact.path,
    plan.backupIdentity,
    fileSystem,
  )
  if (observation.outcome !== 'applied') {
    markBackupOutcomeAmbiguous(
      plan,
      'Restored backup leaf ownership was lost',
    )
    plan.installState = 'ambiguous'
    throw new Error('Restored target identity does not match artifact backup')
  }
  markBackupRestored(plan)
  await assertStagedArtifactOwned(plan, fileSystem)
  await assertTrustedTargetParents(trustedDirectories, fileSystem)
}

async function rollbackPublishedArtifacts(
  plans,
  fileSystem,
  errors,
  trustedDirectories,
) {
  for (const plan of [...plans].reverse()) {
    if (plan.installState !== 'installed') {
      continue
    }
    try {
      await moveInstalledTargetBackToTemp(
        plan,
        fileSystem,
        trustedDirectories,
      )
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
      await restoreBackupToTarget(plan, fileSystem, trustedDirectories)
    } catch (error) {
      errors.push(error)
      if (plans.some(candidate => (
        candidate.backupState === 'ambiguous'
        || candidate.installState === 'ambiguous'
      ))) {
        // 任一 leaf token 失效后不再恢复其他 backup，避免在
        // 全局 target 所有权已不确定时覆盖并发产物。
        break
      }
    }
  }
}

async function removeOwnedTemps(
  plans,
  fileSystem,
  errors,
  trustedDirectories,
) {
  for (const plan of plans) {
    if (plan.tempOwnership !== 'owned') {
      continue
    }
    try {
      await assertTrustedTargetParents(trustedDirectories, fileSystem)
      await assertStagedArtifactOwned(plan, fileSystem)
      await fileSystem.rm(plan.tempPath, { recursive: true, force: true })
      await assertEntryMissing(
        plan.tempPath,
        fileSystem,
        'Removed artifact temp',
      )
      plan.tempOwnership = 'none'
      await assertTrustedTargetParents(trustedDirectories, fileSystem)
    } catch (error) {
      errors.push(error)
      if (plans.some(candidate => (
        candidate.backupState === 'ambiguous'
        || candidate.installState === 'ambiguous'
      ))) {
        // leaf token 丢失后保留尚未处理的 temp，不再扩大
        // cleanup 对未知并发状态的影响。
        break
      }
    }
  }
}

async function removeCommittedBackups(
  plans,
  fileSystem,
  errors,
  trustedDirectories,
) {
  for (const plan of plans) {
    if (plan.backupOwnership !== 'owned' || plan.backupState !== 'moved') {
      continue
    }
    try {
      await assertTrustedTargetParents(trustedDirectories, fileSystem)
      await assertPublishedLeafTokens(plans, fileSystem)
      await assertBackupOwned(plan, fileSystem)
      await fileSystem.rm(plan.backupPath, { recursive: true, force: true })
      await assertEntryMissing(
        plan.backupPath,
        fileSystem,
        'Removed artifact backup',
      )
      plan.backupOwnership = 'none'
      plan.backupState = 'discarded'
      await assertPublishedLeafTokens(plans, fileSystem)
      await assertTrustedTargetParents(trustedDirectories, fileSystem)
    } catch (error) {
      errors.push(error)
      if (plans.some(candidate => (
        candidate.backupState === 'ambiguous'
        || candidate.installState === 'ambiguous'
      ))) {
        // leaf token 丢失后保留尚未处理的 backup，不再扩大
        // cleanup 对未知并发状态的影响。
        break
      }
    }
  }
}

async function cleanupCreatedParents(
  createdParents,
  fileSystem,
  errors,
  trustedDirectories,
) {
  const deepestFirst = [...new Set(createdParents)].sort((left, right) => (
    absolutePathComponents(right).length - absolutePathComponents(left).length
    || right.localeCompare(left)
  ))

  for (const directory of deepestFirst) {
    try {
      const expectedIdentity = trustedDirectories.get(directory)
      if (!expectedIdentity) {
        throw new Error('Created target parent identity is unavailable')
      }
      await assertDirectoryIdentity(
        directory,
        expectedIdentity,
        fileSystem,
        'Created target parent',
      )
      // rmdir 只会删除空目录，保证不会误删并发写入或既有 canary。
      await fileSystem.rmdir(directory)
      trustedDirectories.delete(directory)
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
  {
    fileSystem,
    randomUUIDImpl = randomUUID,
    validatePublished,
    validateStagedDirectory,
  } = {},
) {
  if (typeof randomUUIDImpl !== 'function') {
    throw new TypeError('randomUUIDImpl must be a function')
  }

  const normalizedArtifacts = normalizeArtifacts(artifacts)
  const normalizedValidatePublished = normalizeOptionalCallback(
    validatePublished,
    'validatePublished',
  )
  const normalizedValidateStagedDirectory = normalizeOptionalCallback(
    validateStagedDirectory,
    'validateStagedDirectory',
  )
  const workingFileSystem = resolveFileSystem(fileSystem)
  const { plans, trustedDirectories } = await preflightArtifacts(
    normalizedArtifacts,
    workingFileSystem,
    randomUUIDImpl,
  )
  const createdParents = []

  try {
    await createMissingParents(
      plans,
      workingFileSystem,
      createdParents,
      trustedDirectories,
    )
    await assertTrustedTargetParents(trustedDirectories, workingFileSystem)
    await stageArtifacts(
      plans,
      workingFileSystem,
      trustedDirectories,
      normalizedValidateStagedDirectory,
    )

    // 单个 artifact 的同目录 rename 具备文件系统原子性；多个 artifact 之间
    // 只提供当前进程内的逆序 rollback，不承诺断电或进程崩溃级事务语义。
    await publishArtifacts(plans, workingFileSystem, trustedDirectories)
    await assertTrustedTargetParents(trustedDirectories, workingFileSystem)
    await assertPublishedLeafTokens(plans, workingFileSystem)

    // 最终发布校验必须处于 backup 生命周期内；回调失败与
    // forward rename 失败使用同一条 rollback 路径。
    if (normalizedValidatePublished) {
      await normalizedValidatePublished()
    }
    await assertPublishedLeafTokens(plans, workingFileSystem)
    await assertTrustedTargetParents(trustedDirectories, workingFileSystem)
  } catch (operationError) {
    const recoveryErrors = []
    await rollbackPublishedArtifacts(
      plans,
      workingFileSystem,
      recoveryErrors,
      trustedDirectories,
    )
    recoveryErrors.push(
      ...plans.flatMap(plan => plan.recoveryErrors),
    )
    await removeOwnedTemps(
      plans,
      workingFileSystem,
      recoveryErrors,
      trustedDirectories,
    )
    // 失败路径绝不删除 backup：已恢复的 backup 路径已不存在；仍存在的 owned
    // 或 unknown backup 可能是唯一旧副本，必须原样保留供人工恢复。
    await cleanupCreatedParents(
      createdParents,
      workingFileSystem,
      recoveryErrors,
      trustedDirectories,
    )
    throwOperationError(operationError, recoveryErrors)
  }

  const cleanupErrors = []
  await removeOwnedTemps(
    plans,
    workingFileSystem,
    cleanupErrors,
    trustedDirectories,
  )
  await removeCommittedBackups(
    plans,
    workingFileSystem,
    cleanupErrors,
    trustedDirectories,
  )
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Published artifact cleanup failed')
  }
}
