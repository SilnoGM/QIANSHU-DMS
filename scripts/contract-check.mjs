import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  resolveContractPaths,
  withTemporaryDirectory,
} from './contract-files.mjs'
import {
  applyContractFailureToProcess,
  parseOpenApiSnapshot,
} from './openapi-contract.mjs'
import { isDirectEntry, runCommand } from './run-command.mjs'
import {
  assertSnapshotIdentity,
  canonicalizeTemporaryRoot,
  generateContractArtifacts,
  readRegularSnapshot,
} from './contract-sync.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptsDirectory, '..')

function normalizeRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    throw new TypeError('Repository root must be a non-empty path')
  }
  return path.resolve(repositoryRoot)
}

export function parseContractCheckArguments(argv, cwd = process.cwd()) {
  if (!Array.isArray(argv)) {
    throw new TypeError('Contract check arguments must be an array')
  }
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw new TypeError('Invocation cwd must be a non-empty path')
  }
  if (argv.length === 0) {
    return { baselinePath: undefined }
  }
  if (
    argv.length !== 2
    || argv[0] !== '--baseline'
    || typeof argv[1] !== 'string'
    || argv[1].length === 0
    || argv[1].startsWith('--')
  ) {
    throw new TypeError('Usage: contract-check [--baseline file]')
  }

  return { baselinePath: path.resolve(cwd, argv[1]) }
}

export async function contractCheck({
  argv = process.argv.slice(2),
  invocationCwd = process.cwd(),
  repositoryRoot = defaultRepositoryRoot,
  run = runCommand,
  temporaryRoot = os.tmpdir(),
  fileSystem,
} = {}) {
  if (typeof run !== 'function') {
    throw new TypeError('Contract command runner must be a function')
  }
  const normalizedRepositoryRoot = normalizeRepositoryRoot(repositoryRoot)
  const { baselinePath } = parseContractCheckArguments(argv, invocationCwd)
  const paths = resolveContractPaths(normalizedRepositoryRoot)
  const canonicalTemporaryRoot = await canonicalizeTemporaryRoot(
    temporaryRoot,
    fileSystem,
  )
  const baselineDocument = baselinePath === undefined
    ? undefined
    : parseOpenApiSnapshot(
        await readRegularSnapshot(
          baselinePath,
          'OpenAPI operationId baseline',
          { fileSystem },
        ),
        'OpenAPI operationId baseline',
      )

  return withTemporaryDirectory(async (temporaryDirectory) => {
    const { snapshotBytes } = await generateContractArtifacts({
      baselineDocument,
      fileSystem,
      repositoryRoot: normalizedRepositoryRoot,
      run,
      temporaryDirectory,
    })
    const serverSnapshotBytes = await readRegularSnapshot(
      paths.serverSnapshot,
      'Tracked Server snapshot',
      { fileSystem },
    )
    const webSnapshotBytes = await readRegularSnapshot(
      paths.webSnapshot,
      'Tracked Web snapshot',
      { fileSystem },
    )

    assertSnapshotIdentity({
      actual: snapshotBytes,
      expected: serverSnapshotBytes,
      actualLabel: 'generated Server snapshot',
      expectedLabel: 'tracked Server snapshot',
    })
    assertSnapshotIdentity({
      actual: serverSnapshotBytes,
      expected: webSnapshotBytes,
      actualLabel: 'tracked Server snapshot',
      expectedLabel: 'tracked Web snapshot',
    })
  }, {
    fileSystem,
    prefix: 'qianshu-contract-check-',
    temporaryRoot: canonicalTemporaryRoot,
  })
}

if (isDirectEntry(import.meta.url)) {
  contractCheck().catch(error => applyContractFailureToProcess(error))
}
