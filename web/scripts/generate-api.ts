import { lstat, mkdir, readdir, realpath, rm, rmdir } from 'node:fs/promises'
import os from 'node:os'
import {
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
} from 'node:path'
import process from 'node:process'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createClient } from '@hey-api/openapi-ts'

export interface GenerateApiOptions {
  input: string
  outputDirectory: string
}

export type CreateClientImplementation = typeof createClient

interface ExistingPathEvidence {
  canonicalPath: string
  cleanupRoot: string | undefined
  exists: boolean
  protectedAncestors: readonly PathIdentity[]
  targetIdentity: PathIdentity | undefined
}

interface DefaultOutputContext {
  readonly applicationRoot: string
  readonly webRoot: string
}

interface PathIdentity {
  device: bigint | number
  inode: bigint | number
  path: string
}

interface SafeOutputPlan {
  cleanupRoot: string | undefined
  initiallyExists: boolean
  isDefault: boolean
  protectedAncestors: readonly PathIdentity[]
  safeOutputDirectory: string
  targetIdentity: PathIdentity | undefined
}

const scriptsDirectory = dirname(fileURLToPath(import.meta.url))
const webRoot = resolve(scriptsDirectory, '..')
const repositoryRootCandidate = resolve(webRoot, '..')
const repositoryServerDirectory = join(repositoryRootCandidate, 'server')
const applicationRoot = join(webRoot, 'apps/qsmds-arco')
const applicationTsconfig = join(applicationRoot, 'tsconfig.app.json')
const defaultInput = join(webRoot, 'openapi/openapi.json')
const defaultOutputDirectory = join(
  applicationRoot,
  'src/api/generated',
)
const defaultOutputContext: DefaultOutputContext = {
  applicationRoot,
  webRoot,
}

const invalidProductMessage
  = 'API generator must create exactly one non-empty regular types.gen.ts'

function isStrictChild(parentPath: string, childPath: string): boolean {
  const difference = relative(parentPath, childPath)
  return difference !== ''
    && difference !== '..'
    && !difference.startsWith(`..${sep}`)
    && !isAbsolute(difference)
}

function pathsOverlap(firstPath: string, secondPath: string): boolean {
  return firstPath === secondPath
    || isStrictChild(firstPath, secondPath)
    || isStrictChild(secondPath, firstPath)
}

function toPathIdentity(
  targetPath: string,
  stats: Awaited<ReturnType<typeof lstat>>,
): PathIdentity {
  return {
    device: stats.dev,
    inode: stats.ino,
    path: targetPath,
  }
}

function assertAbsolutePath(targetPath: string): void {
  if (!isAbsolute(targetPath)) {
    throw new Error('API generator overrides must be absolute paths')
  }
}

async function tryLstat(targetPath: string) {
  try {
    return await lstat(targetPath)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}

async function resolveProtectedRoots(): Promise<readonly string[]> {
  const protectedRoots = [
    await realpath(webRoot),
    await realpath(applicationRoot),
  ]
  const serverStats = await tryLstat(repositoryServerDirectory)

  // 独立 Web 副本的父目录不是项目仓库；只有仍存在 Server 边界时才把父目录视为 repository root。
  if (serverStats !== undefined
    && !serverStats.isSymbolicLink()
    && serverStats.isDirectory()) {
    protectedRoots.unshift(await realpath(repositoryRootCandidate))
  }

  return protectedRoots
}

/**
 * 从可信根逐段检查 lexical path，避免 realpath() 在安全检查前吞掉 symlink 证据。
 * 返回 prospective canonical path，以及目标最初不存在时可安全清理的首个缺失 component。
 */
async function inspectPathFromTrustedRoot(
  trustedRoot: string,
  targetPath: string,
): Promise<ExistingPathEvidence> {
  if (!isStrictChild(trustedRoot, targetPath)) {
    throw new Error('API generator output must be a strict child of its trusted root')
  }

  const rootStats = await lstat(trustedRoot)
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error('API generator trusted root must be a real directory')
  }

  const segments = relative(trustedRoot, targetPath).split(sep)
  let currentPath = trustedRoot
  let firstMissingPath: string | undefined
  let targetIdentity: PathIdentity | undefined
  const protectedAncestors: PathIdentity[] = [
    toPathIdentity(trustedRoot, rootStats),
  ]

  for (const [index, segment] of segments.entries()) {
    currentPath = join(currentPath, segment)
    if (firstMissingPath !== undefined) {
      continue
    }

    const stats = await tryLstat(currentPath)
    if (stats === undefined) {
      firstMissingPath = currentPath
      continue
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error('API generator output path components must be real directories')
    }
    if (index < segments.length - 1) {
      protectedAncestors.push(toPathIdentity(currentPath, stats))
    }
    else {
      targetIdentity = toPathIdentity(currentPath, stats)
    }
  }

  if (firstMissingPath === undefined) {
    return {
      canonicalPath: await realpath(targetPath),
      cleanupRoot: undefined,
      exists: true,
      protectedAncestors,
      targetIdentity,
    }
  }

  const existingAncestor = dirname(firstMissingPath)
  const canonicalAncestor = await realpath(existingAncestor)
  const prospectiveSuffix = relative(existingAncestor, targetPath)

  return {
    canonicalPath: join(canonicalAncestor, prospectiveSuffix),
    cleanupRoot: join(
      canonicalAncestor,
      relative(existingAncestor, firstMissingPath),
    ),
    exists: false,
    protectedAncestors,
    targetIdentity: undefined,
  }
}

function outputDirectoryFromContext(
  context: DefaultOutputContext,
): string {
  return join(context.applicationRoot, 'src/api/generated')
}

async function resolveDefaultOutputPlan(
  context: DefaultOutputContext,
): Promise<SafeOutputPlan> {
  const managedOutputDirectory = outputDirectoryFromContext(context)
  const webStats = await lstat(context.webRoot)
  if (webStats.isSymbolicLink() || !webStats.isDirectory()) {
    throw new Error('Web root must be a real directory')
  }

  const evidence = await inspectPathFromTrustedRoot(
    context.webRoot,
    managedOutputDirectory,
  )
  const canonicalWebRoot = await realpath(context.webRoot)
  const canonicalApplicationRoot = await realpath(context.applicationRoot)
  const expectedCanonicalOutput = join(
    canonicalApplicationRoot,
    'src/api/generated',
  )

  if (!isStrictChild(canonicalWebRoot, canonicalApplicationRoot)
    || !isStrictChild(canonicalApplicationRoot, evidence.canonicalPath)
    || evidence.canonicalPath !== expectedCanonicalOutput) {
    throw new Error('Default API generator output escaped its trusted application root')
  }

  return {
    cleanupRoot: evidence.cleanupRoot,
    initiallyExists: evidence.exists,
    isDefault: true,
    protectedAncestors: evidence.protectedAncestors,
    safeOutputDirectory: evidence.canonicalPath,
    targetIdentity: evidence.targetIdentity,
  }
}

async function chooseTemporaryLexicalRoot(
  outputDirectory: string,
  canonicalTemporaryRoot: string,
): Promise<string> {
  const lexicalTemporaryRoot = normalize(resolve(os.tmpdir()))

  if (isStrictChild(lexicalTemporaryRoot, outputDirectory)) {
    return lexicalTemporaryRoot
  }
  if (isStrictChild(canonicalTemporaryRoot, outputDirectory)) {
    return canonicalTemporaryRoot
  }

  throw new Error('API generator override must be inside the temporary directory')
}

async function resolveOverrideOutputPlan(
  outputDirectory: string,
): Promise<SafeOutputPlan> {
  if (normalize(outputDirectory) !== outputDirectory) {
    throw new Error('API generator override must be normalized')
  }

  const canonicalTemporaryRoot = await realpath(os.tmpdir())
  const canonicalFileSystemRoot = await realpath(parse(webRoot).root)
  const protectedRoots = await resolveProtectedRoots()

  if (canonicalTemporaryRoot === canonicalFileSystemRoot
    || protectedRoots.some(protectedRoot => (
      canonicalTemporaryRoot === protectedRoot
      || isStrictChild(protectedRoot, canonicalTemporaryRoot)
    ))) {
    throw new Error('API generator temporary directory overlaps a protected root')
  }

  const lexicalRoot = await chooseTemporaryLexicalRoot(
    outputDirectory,
    canonicalTemporaryRoot,
  )
  const evidence = await inspectPathFromTrustedRoot(
    lexicalRoot,
    outputDirectory,
  )

  if (!isStrictChild(canonicalTemporaryRoot, evidence.canonicalPath)) {
    throw new Error('API generator override escaped the temporary directory')
  }

  if (evidence.canonicalPath === canonicalFileSystemRoot
    || protectedRoots.some(protectedRoot => pathsOverlap(
      evidence.canonicalPath,
      protectedRoot,
    ))
    || evidence.canonicalPath === canonicalTemporaryRoot) {
    throw new Error('API generator output cannot target a protected root')
  }

  if (evidence.exists && (await readdir(evidence.canonicalPath)).length !== 0) {
    throw new Error('API generator override directory must be empty')
  }

  return {
    cleanupRoot: evidence.cleanupRoot,
    initiallyExists: evidence.exists,
    isDefault: false,
    protectedAncestors: evidence.protectedAncestors,
    safeOutputDirectory: evidence.canonicalPath,
    targetIdentity: evidence.targetIdentity,
  }
}

async function resolveSafeOutputPlan(
  outputDirectory: string,
  context: DefaultOutputContext = defaultOutputContext,
): Promise<SafeOutputPlan> {
  assertAbsolutePath(outputDirectory)

  // 只有 wrapper 自身构造出的精确 lexical 默认值拥有清理非空目录的权限。
  if (outputDirectory === outputDirectoryFromContext(context)) {
    return resolveDefaultOutputPlan(context)
  }

  return resolveOverrideOutputPlan(outputDirectory)
}

export function parseGenerateApiArguments(
  argv: readonly string[],
): GenerateApiOptions {
  let input = defaultInput
  let outputDirectory = defaultOutputDirectory
  const seenArguments = new Set<string>()

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument !== '--input' && argument !== '--output') {
      throw new Error(`Unknown argument: ${argument ?? '<missing>'}`)
    }
    if (seenArguments.has(argument)) {
      throw new Error(`Duplicate argument: ${argument}`)
    }

    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`)
    }

    seenArguments.add(argument)
    if (argument === '--input') {
      input = value
    }
    else {
      outputDirectory = value
    }
    index += 1
  }

  assertAbsolutePath(input)
  assertAbsolutePath(outputDirectory)
  return { input, outputDirectory }
}

export async function resolveSafeOutputDirectory(
  outputDirectory: string,
  context: DefaultOutputContext = defaultOutputContext,
): Promise<string> {
  return (await resolveSafeOutputPlan(
    outputDirectory,
    context,
  )).safeOutputDirectory
}

async function assertExactTypesOnlyProduct(
  outputDirectory: string,
): Promise<void> {
  const outputStats = await lstat(outputDirectory)
  if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
    throw new Error(invalidProductMessage)
  }

  const entries = await readdir(outputDirectory)
  if (entries.length !== 1 || entries[0] !== 'types.gen.ts') {
    throw new Error(invalidProductMessage)
  }

  const typesPath = join(outputDirectory, 'types.gen.ts')
  const typesStats = await lstat(typesPath)
  if (typesStats.isSymbolicLink()
    || !typesStats.isFile()
    || typesStats.size === 0) {
    throw new Error(invalidProductMessage)
  }
}

/**
 * 生成器只能拥有 output target；其既有父目录仍属于调用方。
 * 清理前复核 device/inode，防止中间目录被 rename 后换成 symlink 或另一目录。
 */
async function assertProtectedAncestorsUnchanged(
  plan: SafeOutputPlan,
): Promise<void> {
  for (const identity of plan.protectedAncestors) {
    await assertPathIdentityUnchanged(identity)
  }
}

async function assertPathIdentityUnchanged(
  identity: PathIdentity,
): Promise<void> {
  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(identity.path)
  }
  catch {
    throw new Error('API generator output ownership changed')
  }

  if (stats.isSymbolicLink()
    || !stats.isDirectory()
    || stats.dev !== identity.device
    || stats.ino !== identity.inode) {
    throw new Error('API generator output ownership changed')
  }
}

async function assertInitialTargetUnchangedForCleanup(
  plan: SafeOutputPlan,
): Promise<void> {
  if (plan.targetIdentity === undefined) {
    return
  }

  await assertPathIdentityUnchanged(plan.targetIdentity)
}

async function assertOutputOwnershipUnchanged(
  plan: SafeOutputPlan,
): Promise<void> {
  await assertProtectedAncestorsUnchanged(plan)
  if (plan.isDefault) {
    return
  }
  if (plan.targetIdentity === undefined) {
    throw new Error('API generator output ownership changed')
  }
  await assertInitialTargetUnchangedForCleanup(plan)
}

async function removeOwnedCreatedTree(
  identities: readonly PathIdentity[],
): Promise<void> {
  if (identities.length === 0) {
    return
  }

  for (const identity of identities) {
    await assertPathIdentityUnchanged(identity)
  }
  // acquisition 尚未调用第三方生成器，只能反向删除仍为空的自建目录；出现 foreign entry 时保留现场并报错。
  for (const identity of identities.toReversed()) {
    await rmdir(identity.path)
  }
}

/**
 * override 初始不存在时，wrapper 逐级创建并记录 output 身份。
 * 这样失败清理不会把调用期间换入同一路径的 foreign directory 当作自身产物删除。
 */
async function acquireMissingOverrideTarget(
  plan: SafeOutputPlan,
): Promise<SafeOutputPlan> {
  if (plan.isDefault || plan.initiallyExists || plan.cleanupRoot === undefined) {
    return plan
  }

  const existingAncestor = dirname(plan.cleanupRoot)
  const missingSegments = relative(
    existingAncestor,
    plan.safeOutputDirectory,
  ).split(sep)
  const createdIdentities: PathIdentity[] = []
  let currentPath = existingAncestor

  try {
    for (const segment of missingSegments) {
      currentPath = join(currentPath, segment)
      await mkdir(currentPath)
      const stats = await lstat(currentPath)
      if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new Error('API generator failed to acquire its output directory')
      }
      createdIdentities.push(toPathIdentity(currentPath, stats))
    }
  }
  catch (error) {
    try {
      await removeOwnedCreatedTree(createdIdentities)
    }
    catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'API generator output acquisition cleanup failed',
      )
    }
    throw error
  }

  const targetIdentity = createdIdentities.at(-1)
  if (targetIdentity === undefined
    || targetIdentity.path !== plan.safeOutputDirectory) {
    await removeOwnedCreatedTree(createdIdentities)
    throw new Error('API generator failed to acquire its output directory')
  }

  return {
    ...plan,
    protectedAncestors: [
      ...plan.protectedAncestors,
      ...createdIdentities.slice(0, -1),
    ],
    targetIdentity,
  }
}

async function restoreOverrideState(plan: SafeOutputPlan): Promise<void> {
  if (plan.isDefault) {
    return
  }

  // 将身份复核放在第一项 mutation 紧前方，缩短 preflight 与 cleanup 的竞态窗口。
  await assertOutputOwnershipUnchanged(plan)

  if (plan.initiallyExists) {
    // override 起始为空目录；仅删除本次失败留下的 entries，保留调用方目录 inode、mode 与 ACL。
    for (const entry of await readdir(plan.safeOutputDirectory)) {
      await rm(join(plan.safeOutputDirectory, entry), {
        force: true,
        recursive: true,
      })
    }
    return
  }

  if (plan.cleanupRoot !== undefined) {
    await rm(plan.cleanupRoot, { force: true, recursive: true })
  }
}

export async function generateApiTypes(
  options: GenerateApiOptions,
  createClientImpl: CreateClientImplementation = createClient,
): Promise<void> {
  assertAbsolutePath(options.input)
  assertAbsolutePath(options.outputDirectory)
  let outputPlan = await resolveSafeOutputPlan(options.outputDirectory)
  await assertProtectedAncestorsUnchanged(outputPlan)
  outputPlan = await acquireMissingOverrideTarget(outputPlan)
  await assertOutputOwnershipUnchanged(outputPlan)

  try {
    await createClientImpl({
      input: options.input,
      logs: {
        file: false,
        level: 'silent',
      },
      output: {
        path: outputPlan.safeOutputDirectory,
        // override 已由 wrapper 取得空目录所有权；避免 clean:true 合法重建 target 后丢失 identity token。
        clean: outputPlan.isDefault,
        entryFile: false,
        tsConfigPath: applicationTsconfig,
      },
      plugins: [{ name: '@hey-api/typescript', enums: false }],
    })
    await assertOutputOwnershipUnchanged(outputPlan)
    await assertExactTypesOnlyProduct(outputPlan.safeOutputDirectory)
    await assertOutputOwnershipUnchanged(outputPlan)
  }
  catch (error) {
    try {
      await assertOutputOwnershipUnchanged(outputPlan)
    }
    catch (ownershipError) {
      throw new AggregateError(
        [error, ownershipError],
        'API generator output ownership changed during generation',
      )
    }

    try {
      await restoreOverrideState(outputPlan)
    }
    catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'API generator output cleanup failed',
      )
    }
    throw error
  }
}

export async function runGenerateApi(
  argv: readonly string[] = process.argv.slice(2),
  generate: typeof generateApiTypes = generateApiTypes,
): Promise<void> {
  await generate(parseGenerateApiArguments(argv))
}

const isDirectEntry = process.argv[1] !== undefined
  && pathToFileURL(resolve(process.argv[1])).href === import.meta.url

if (isDirectEntry) {
  void runGenerateApi().catch(() => {
    console.error('API type generation failed')
    process.exitCode = 1
  })
}
