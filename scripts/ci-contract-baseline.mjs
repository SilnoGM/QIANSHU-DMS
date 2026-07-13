import { spawn } from 'node:child_process'
import * as defaultFileSystem from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { applyContractFailureToProcess } from './openapi-contract.mjs'
import {
  CommandExecutionError,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptsDirectory, '..')
const snapshotPath = 'server/openapi/openapi.json'
const zeroSha = '0'.repeat(40)
const fullShaPattern = /^[0-9a-f]{40}$/u
const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const gitOutputLimit = 16 * 1024 * 1024
const noBaseline = Object.freeze({ kind: 'none' })

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`)
  }

  const actualKeys = Object.keys(value).sort()
  const normalizedExpectedKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== normalizedExpectedKeys.length
    || actualKeys.some(
      (key, index) => key !== normalizedExpectedKeys[index],
    )
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

function assertFullSha(value, label, { allowZero = false } = {}) {
  if (!fullShaPattern.test(value) || (!allowZero && value === zeroSha)) {
    throw new TypeError(`${label} must be a full Git SHA`)
  }
  return value
}

export function parseStableVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value)
  if (!match) {
    throw new Error('Stable version is invalid')
  }
  const tuple = match.slice(1).map(Number)
  if (!tuple.every(Number.isSafeInteger)) {
    throw new Error('Stable version is unsafe')
  }
  return Object.freeze(tuple)
}

export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }
  return 0
}

function normalizeEventInput(input) {
  if (!isRecord(input)) {
    throw new TypeError('Contract event input must be an object')
  }

  const eventName = input.eventName
  if (eventName === 'pull_request') {
    assertExactKeys(
      input,
      ['baseSha', 'currentSha', 'eventName', 'runnerTemp'],
      'Pull request input',
    )
    return Object.freeze({
      baseSha: assertFullSha(input.baseSha, 'Pull request base SHA'),
      currentSha: assertFullSha(input.currentSha, 'Current SHA'),
      eventName,
      runnerTemp: assertNonEmptyString(input.runnerTemp, 'RUNNER_TEMP'),
    })
  }

  if (eventName === 'push') {
    assertExactKeys(
      input,
      ['beforeSha', 'currentSha', 'eventName', 'ref', 'runnerTemp'],
      'Push input',
    )
    if (input.ref !== 'refs/heads/main') {
      throw new TypeError('Push ref must be refs/heads/main')
    }
    return Object.freeze({
      beforeSha: assertFullSha(input.beforeSha, 'Push before SHA', {
        allowZero: true,
      }),
      currentSha: assertFullSha(input.currentSha, 'Current SHA'),
      eventName,
      ref: input.ref,
      runnerTemp: assertNonEmptyString(input.runnerTemp, 'RUNNER_TEMP'),
    })
  }

  if (eventName === 'workflow_call') {
    assertExactKeys(
      input,
      ['currentSha', 'eventName', 'releaseTag', 'runnerTemp'],
      'Release input',
    )
    if (!stableTagPattern.test(input.releaseTag)) {
      throw new TypeError('Release tag must be a stable vX.Y.Z tag')
    }
    parseStableVersion(input.releaseTag.slice(1))
    return Object.freeze({
      currentSha: assertFullSha(input.currentSha, 'Current SHA'),
      eventName,
      releaseTag: input.releaseTag,
      runnerTemp: assertNonEmptyString(input.runnerTemp, 'RUNNER_TEMP'),
    })
  }

  throw new TypeError('GitHub event is unsupported')
}

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

function normalizeDependencies(dependencies = {}) {
  if (!isRecord(dependencies)) {
    throw new TypeError('Contract baseline dependencies must be an object')
  }

  const git = dependencies.git ?? runGitCommand
  const run = dependencies.run ?? runCommand
  if (typeof git !== 'function') {
    throw new TypeError('Git runner must be a function')
  }
  if (typeof run !== 'function') {
    throw new TypeError('Contract command runner must be a function')
  }

  return {
    env: isRecord(dependencies.env) ? dependencies.env : process.env,
    fileSystem: dependencies.fileSystem,
    git,
    repositoryRoot: normalizeRepositoryRoot(
      dependencies.repositoryRoot ?? defaultRepositoryRoot,
    ),
    run,
  }
}

function normalizeExitCode(value) {
  return Number.isInteger(value) && value > 0 ? value : 1
}

function toBuffer(value, label) {
  if (Buffer.isBuffer(value)) {
    return value
  }
  if (typeof value === 'string' || value instanceof Uint8Array) {
    return Buffer.from(value)
  }
  throw new TypeError(`${label} must be bytes`)
}

/**
 * 只为 Git metadata/blob 提供有界的捕获式 runner。argv 始终由调用者按元素传入，
 * 不经过 shell；stdout/stderr 也不会直接继承到 CI 日志。
 */
function runGitCommand(args, { cwd, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawnImpl('git', args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (cause) {
      reject(new CommandExecutionError('Git command failed to start', 1, cause))
      return
    }

    const stdout = []
    const stderr = []
    let byteLength = 0
    let settled = false
    let outputExceeded = false
    const settleOnce = callback => {
      if (settled) {
        return
      }
      settled = true
      callback()
    }
    const collect = target => chunk => {
      if (outputExceeded) {
        return
      }
      byteLength += chunk.length
      if (byteLength > gitOutputLimit) {
        outputExceeded = true
        child.kill('SIGKILL')
        return
      }
      target.push(chunk)
    }

    child.stdout.on('data', collect(stdout))
    child.stderr.on('data', collect(stderr))
    child.once('error', cause => {
      settleOnce(() => {
        reject(new CommandExecutionError('Git command failed to start', 1, cause))
      })
    })
    child.once('close', code => {
      settleOnce(() => {
        if (outputExceeded) {
          reject(new CommandExecutionError('Git command output exceeded limit'))
          return
        }
        resolve({
          exitCode: code === 0 ? 0 : normalizeExitCode(code),
          stderr: Buffer.concat(stderr),
          stdout: Buffer.concat(stdout),
        })
      })
    })
  })
}

async function invokeGit(dependencies, args, allowedExitCodes = [0]) {
  const result = await dependencies.git(args, {
    cwd: dependencies.repositoryRoot,
  })
  if (!isRecord(result) || !Number.isInteger(result.exitCode)) {
    throw new TypeError('Git runner returned an unsupported result')
  }

  const normalizedResult = {
    exitCode: result.exitCode,
    stderr: toBuffer(result.stderr, 'Git stderr'),
    stdout: toBuffer(result.stdout, 'Git stdout'),
  }
  if (!allowedExitCodes.includes(normalizedResult.exitCode)) {
    throw new CommandExecutionError(
      'Git command failed',
      normalizedResult.exitCode,
    )
  }
  return normalizedResult
}

function parseSingleSha(contents, label) {
  const value = contents.toString('utf8').trim()
  if (!fullShaPattern.test(value)) {
    throw new Error(`${label} returned an invalid SHA`)
  }
  return value
}

async function resolveReleaseBaseline(input, dependencies) {
  const currentVersion = parseStableVersion(input.releaseTag.slice(1))
  const releaseRef = `refs/tags/${input.releaseTag}^{commit}`
  const releaseCommit = parseSingleSha(
    (await invokeGit(
      dependencies,
      ['rev-parse', '--verify', releaseRef],
    )).stdout,
    'Release tag',
  )
  if (releaseCommit !== input.currentSha) {
    throw new Error('Release tag does not identify the current commit')
  }

  const tagOutput = (
    await invokeGit(dependencies, [
      'for-each-ref',
      '--format=%(refname:strip=2)',
      'refs/tags',
    ])
  ).stdout.toString('utf8')
  const tags = tagOutput.length === 0
    ? []
    : tagOutput.trimEnd().split('\n')
  let selected

  for (const tag of tags) {
    const match = stableTagPattern.exec(tag)
    if (!match) {
      continue
    }
    const version = parseStableVersion(tag.slice(1))
    if (compareVersions(version, currentVersion) >= 0) {
      continue
    }

    const commit = parseSingleSha(
      (await invokeGit(
        dependencies,
        ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`],
      )).stdout,
      'Historical release tag',
    )
    const reachable = await invokeGit(
      dependencies,
      ['merge-base', '--is-ancestor', commit, input.currentSha],
      [0, 1],
    )
    if (reachable.exitCode === 1) {
      continue
    }
    if (
      selected === undefined
      || compareVersions(version, selected.version) > 0
    ) {
      selected = { commit, version }
    }
  }

  return selected?.commit
}

async function selectHistoricalCommit(input, dependencies) {
  if (input.eventName === 'pull_request') {
    return input.baseSha
  }
  if (input.eventName === 'push') {
    return input.beforeSha === zeroSha ? undefined : input.beforeSha
  }
  return resolveReleaseBaseline(input, dependencies)
}

async function readHistoricalSnapshot(commit, dependencies) {
  const treeResult = await invokeGit(dependencies, [
    'ls-tree',
    '-z',
    commit,
    '--',
    snapshotPath,
  ])
  if (treeResult.stdout.length === 0) {
    return undefined
  }

  const treeEntry = treeResult.stdout.toString('utf8')
  const match = /^100644 blob ([0-9a-f]{40})\tserver\/openapi\/openapi\.json\0$/u.exec(
    treeEntry,
  )
  if (!match) {
    throw new Error('Historical OpenAPI path is not a unique regular blob')
  }

  const blobResult = await invokeGit(
    dependencies,
    ['cat-file', 'blob', match[1]],
  )
  if (blobResult.stdout.length === 0) {
    throw new Error('Historical OpenAPI snapshot is empty')
  }
  return blobResult.stdout
}

function isStrictDescendant(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return (
    relative.length > 0
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  )
}

async function writeTemporaryBaseline(contents, input, dependencies) {
  const realpath = resolveFileSystemMethod(dependencies.fileSystem, 'realpath')
  const lstat = resolveFileSystemMethod(dependencies.fileSystem, 'lstat')
  const mkdtemp = resolveFileSystemMethod(dependencies.fileSystem, 'mkdtemp')
  const rm = resolveFileSystemMethod(dependencies.fileSystem, 'rm')
  const writeFile = resolveFileSystemMethod(dependencies.fileSystem, 'writeFile')
  const canonicalRoot = await realpath(path.resolve(input.runnerTemp))
  const rootStats = await lstat(canonicalRoot)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('RUNNER_TEMP must resolve to a real directory')
  }

  const createdDirectory = await mkdtemp(
    path.join(canonicalRoot, 'qianshu-contract-baseline-'),
  )
  const canonicalDirectory = await realpath(createdDirectory)
  if (
    path.resolve(createdDirectory) !== canonicalDirectory
    || !isStrictDescendant(canonicalRoot, canonicalDirectory)
  ) {
    throw new Error('Contract baseline temporary directory escaped RUNNER_TEMP')
  }

  try {
    const directoryStats = await lstat(canonicalDirectory)
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new Error('Contract baseline temporary path must be a real directory')
    }
    const baselinePath = path.join(
      canonicalDirectory,
      'openapi-baseline.json',
    )
    await writeFile(baselinePath, contents, { flag: 'wx', mode: 0o600 })
    return baselinePath
  } catch (error) {
    try {
      await rm(canonicalDirectory, { force: true, recursive: true })
    } catch {
      // 原始写入/边界失败必须保持为首个错误，不由 cleanup 覆盖。
    }
    throw error
  }
}

export async function selectContractBaseline(input, dependencies = {}) {
  const normalizedInput = normalizeEventInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const source = await selectHistoricalCommit(
    normalizedInput,
    normalizedDependencies,
  )
  if (source === undefined) {
    return noBaseline
  }

  const snapshot = await readHistoricalSnapshot(
    source,
    normalizedDependencies,
  )
  if (snapshot === undefined) {
    return noBaseline
  }
  const baselinePath = await writeTemporaryBaseline(
    snapshot,
    normalizedInput,
    normalizedDependencies,
  )
  return Object.freeze({
    kind: 'file',
    path: baselinePath,
    source,
  })
}

function createContractChildEnv(sourceEnv) {
  const childEnv = {
    ...sourceEnv,
    DOTENV_CONFIG_PATH: '/dev/null',
  }
  delete childEnv.DATABASE_URL
  delete childEnv.DEBUG
  delete childEnv.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
  return childEnv
}

export async function runContractCheckForEvent(input, dependencies = {}) {
  const normalizedDependencies = normalizeDependencies(dependencies)
  const baseline = await selectContractBaseline(input, normalizedDependencies)
  const args = ['scripts/contract-check.mjs']
  if (baseline.kind === 'file') {
    args.push('--baseline', baseline.path)
  }

  let runError
  try {
    const result = await normalizedDependencies.run(process.execPath, args, {
      cwd: normalizedDependencies.repositoryRoot,
      env: createContractChildEnv(normalizedDependencies.env),
    })
    if (result !== undefined && result !== 0) {
      throw new CommandExecutionError(
        'Command failed: node',
        normalizeExitCode(result),
      )
    }
    return 0
  } catch (error) {
    runError = error
    throw error
  } finally {
    if (baseline.kind === 'file') {
      const rm = resolveFileSystemMethod(
        normalizedDependencies.fileSystem,
        'rm',
      )
      try {
        await rm(path.dirname(baseline.path), {
          force: true,
          recursive: true,
        })
      } catch (cleanupError) {
        if (runError === undefined) {
          throw cleanupError
        }
      }
    }
  }
}

function readEventField(event, pathSegments) {
  let current = event
  for (const segment of pathSegments) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      throw new TypeError('GitHub event payload is missing a required field')
    }
    current = current[segment]
  }
  return current
}

export async function parseContractEventInput({
  env = process.env,
  fileSystem,
} = {}) {
  if (!isRecord(env)) {
    throw new TypeError('Environment must be an object')
  }
  const eventName = assertNonEmptyString(
    env.GITHUB_EVENT_NAME,
    'GITHUB_EVENT_NAME',
  )
  const eventPath = assertNonEmptyString(
    env.GITHUB_EVENT_PATH,
    'GITHUB_EVENT_PATH',
  )
  const currentSha = env.GITHUB_SHA
  const runnerTemp = env.RUNNER_TEMP
  const releaseTag = env.QIANSHU_RELEASE_TAG ?? ''
  const lstat = resolveFileSystemMethod(fileSystem, 'lstat')
  const readFile = resolveFileSystemMethod(fileSystem, 'readFile')
  const eventStats = await lstat(eventPath)
  if (eventStats.isSymbolicLink() || !eventStats.isFile()) {
    throw new Error('GitHub event path must be a regular file')
  }

  let event
  try {
    event = JSON.parse(await readFile(eventPath, 'utf8'))
  } catch {
    throw new Error('GitHub event payload is invalid')
  }
  if (!isRecord(event)) {
    throw new Error('GitHub event payload must be an object')
  }

  if (eventName !== 'workflow_call' && releaseTag !== '') {
    throw new TypeError('QIANSHU_RELEASE_TAG is only valid for workflow_call')
  }
  if (eventName === 'pull_request') {
    return normalizeEventInput({
      baseSha: readEventField(event, ['pull_request', 'base', 'sha']),
      currentSha,
      eventName,
      runnerTemp,
    })
  }
  if (eventName === 'push') {
    return normalizeEventInput({
      beforeSha: readEventField(event, ['before']),
      currentSha,
      eventName,
      ref: readEventField(event, ['ref']),
      runnerTemp,
    })
  }
  if (eventName === 'workflow_call') {
    return normalizeEventInput({
      currentSha,
      eventName,
      releaseTag,
      runnerTemp,
    })
  }
  throw new TypeError('GitHub event is unsupported')
}

if (isDirectEntry(import.meta.url)) {
  parseContractEventInput()
    .then(input => runContractCheckForEvent(input))
    .catch(error => applyContractFailureToProcess(error))
}
