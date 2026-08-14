import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertLockfileMatchesManifest,
  dependencyEntries,
  isFixedRegistryVersion,
  parseLockfileImporters,
} from './server-boundary-helpers.mjs'

// 始终从测试脚本所在位置定位仓库，保证从仓库外执行时仍验证同一套工程边界。
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const serverRoot = path.join(repositoryRoot, 'server')
const expectedPnpmSecuritySettings = `injectWorkspacePackages: true
allowBuilds:
  '@prisma/engines': true
  # Swagger UI 的 Scarf 脚本仅用于安装分析；明确拒绝执行，保证 fresh install 可重复且不发送遥测。
  '@scarf/scarf': false
  # argon2 通过 node-gyp-build 选择已发布的 N-API 预构建二进制；密码 Hash/verify 需要其原生实现。
  argon2: true
  prisma: true
  # sharp 通过已发布的 libvips 平台预构建包完成图片完整解码，不允许其他未审查依赖执行 build script。
  sharp: true
`

function fromRoot(...segments) {
  return path.join(repositoryRoot, ...segments)
}

async function exists(...segments) {
  try {
    await lstat(fromRoot(...segments))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

function checkIgnore(fixtureRoot, relativePath) {
  const result = spawnSync(
    'git',
    ['check-ignore', '-q', '--no-index', '--', relativePath],
    { cwd: fixtureRoot, encoding: 'utf8' },
  )

  assert.equal(result.error, undefined, `无法执行 git check-ignore：${relativePath}`)
  assert.ok(
    result.status === 0 || result.status === 1,
    `git check-ignore 异常退出：${relativePath}\n${result.stderr}`,
  )
  return result.status
}

test('Server 是具备独立 lockfile 的单一私有 pnpm package', async () => {
  const manifestPath = fromRoot('server', 'package.json')
  const lockfilePath = fromRoot('server', 'pnpm-lock.yaml')

  assert.equal((await lstat(manifestPath)).isFile(), true)
  assert.equal((await lstat(lockfilePath)).isFile(), true)

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.name, '@qianshu-dms/server')
  assert.equal(manifest.private, true)
  assert.equal(manifest.packageManager, 'pnpm@11.9.0')
  assert.equal(manifest.engines?.node, '^24.15.0')
  assert.equal('workspaces' in manifest, false)
  assert.deepEqual(manifest.files, [
    'deploy/',
    'dist/',
    'prisma/schema.prisma',
    'prisma/migrations/',
  ])
  assert.equal(manifest.devDependencies?.['@nestjs/cli'], '11.0.23')

  for (const scriptName of ['dev', 'check', 'build']) {
    assert.equal(
      typeof manifest.scripts?.[scriptName],
      'string',
      `Server 必须提供 ${scriptName} 脚本`,
    )
    assert.notEqual(manifest.scripts[scriptName].trim(), '')
  }
})

test('Server 生产构建只编译 src 并保持 dist/main.js 入口', async () => {
  const buildConfig = JSON.parse(
    await readFile(fromRoot('server', 'tsconfig.build.json'), 'utf8'),
  )

  assert.equal(buildConfig.compilerOptions?.rootDir, './src')
  assert.equal(buildConfig.compilerOptions?.incremental, false)
  assert.deepEqual(buildConfig.include, ['src/**/*.ts'])
})

test('Server 只使用 pnpm 11 单 package 安全配置且不产生其他包管理器状态', async () => {
  // pnpm 11 将项目级安装安全设置统一放在 pnpm-workspace.yaml；精确比较可同时
  // 防止 packages、全局放开构建脚本或其他配置悄然形成多 package 图和安全降级。
  const settings = await readFile(
    fromRoot('server', 'pnpm-workspace.yaml'),
    'utf8',
  )
  assert.equal(settings, expectedPnpmSecuritySettings)

  for (const relativePath of ['server/package-lock.json', 'server/yarn.lock']) {
    assert.equal(await exists(relativePath), false, `禁止创建：${relativePath}`)
  }
})

test('依赖版本分类器只接受固定 registry SemVer', () => {
  const validSpecifiers = [
    '0.0.0',
    '1.2.3',
    '1.2.3-alpha',
    '1.2.3-alpha.1',
    '1.2.3-0.3.7',
    '1.2.3-x.7.z.92',
    '1.2.3+build.01',
    '1.2.3-alpha.1+build.5',
  ]
  const invalidSpecifiers = [
    '',
    '1',
    '1.2',
    '1.2.x',
    '^1.2.3',
    '~1.2.3',
    '>=1.2.3',
    '1.2.3 || 2.0.0',
    '1.2.3 - 2.0.0',
    'latest',
    'next',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    '1.2.3-alpha..1',
    '1.2.3+build..1',
    'file:../shared',
    'link:../shared',
    'portal:../shared',
    'workspace:*',
    '../web/pkg.tgz',
    './vendor/pkg',
    '/tmp/pkg',
    '~/pkg',
    'https://example.com/pkg.tgz',
    'git+ssh://git@example.com/pkg.git',
    'git://example.com/pkg.git',
    'github:user/repo',
    'user/repo',
    'npm:other-package@1.2.3',
  ]

  for (const specifier of validSpecifiers) {
    assert.equal(isFixedRegistryVersion(specifier), true, `应接受：${specifier}`)
  }
  for (const specifier of invalidSpecifiers) {
    assert.equal(isFixedRegistryVersion(specifier), false, `应拒绝：${specifier}`)
  }
})

test('lockfile importer 校验器能在只读条件下识别漂移和额外 importer', () => {
  const manifest = { dependencies: { example: '1.2.3' } }
  const matchingLockfile = `lockfileVersion: '9.0'

importers:

  .:
    dependencies:
      example:
        specifier: 1.2.3
        version: 1.2.3

packages:
`

  const matchingImporters = parseLockfileImporters(matchingLockfile)
  assert.doesNotThrow(() => assertLockfileMatchesManifest(manifest, matchingImporters))

  const driftedImporters = parseLockfileImporters(
    matchingLockfile.replace('specifier: 1.2.3', 'specifier: 1.2.4'),
  )
  assert.throws(
    () => assertLockfileMatchesManifest(manifest, driftedImporters),
    /specifier 必须与 package\.json 一致/,
  )

  const extraImporters = parseLockfileImporters(
    matchingLockfile.replace('\npackages:', '\n  copied:\n\npackages:'),
  )
  assert.throws(
    () => assertLockfileMatchesManifest(manifest, extraImporters),
    /只能包含单一 \. importer/,
  )

  const unsafeScalarLockfile = matchingLockfile.replace(
    'specifier: 1.2.3',
    'specifier: !!js/function function() {}',
  )
  assert.throws(
    () => parseLockfileImporters(unsafeScalarLockfile),
    /不受支持的标量/,
  )
})

test('Server lockfile 只有单一 importer 且 specifier 与 manifest 一致', async () => {
  const [manifestContents, lockfileContents] = await Promise.all([
    readFile(fromRoot('server', 'package.json'), 'utf8'),
    readFile(fromRoot('server', 'pnpm-lock.yaml'), 'utf8'),
  ])
  const manifest = JSON.parse(manifestContents)
  const importers = parseLockfileImporters(lockfileContents)

  assertLockfileMatchesManifest(manifest, importers)
})

test('Server lockfile 只在 settings 启用现代 deploy workspace 注入', async () => {
  const lockfileContents = await readFile(
    fromRoot('server', 'pnpm-lock.yaml'),
    'utf8',
  )
  const injectionSettings = lockfileContents.match(
    /^\s*injectWorkspacePackages:\s*true\s*$/gmu,
  )

  // 唯一匹配既证明值为 true，也防止 importer 或 package 条目重复注入该配置。
  assert.equal(injectionSettings?.length, 1)
  assert.match(
    lockfileContents,
    /^settings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n  injectWorkspacePackages: true\n\nimporters:/mu,
  )
})

test('Server 的全部依赖只能使用固定 registry SemVer', async () => {
  const manifest = JSON.parse(
    await readFile(fromRoot('server', 'package.json'), 'utf8'),
  )

  for (const { name, section, specifier } of dependencyEntries(manifest)) {
    assert.equal(
      isFixedRegistryVersion(specifier),
      true,
      `${section}.${name} 必须固定为 registry SemVer：${specifier}`,
    )
  }
})

test('仓库根目录仍不产生 pnpm workspace、lockfile 或依赖目录', async () => {
  for (const relativePath of [
    'pnpm-workspace.yaml',
    'pnpm-lock.yaml',
    'node_modules',
    '.pnpm-store',
  ]) {
    assert.equal(await exists(relativePath), false, `根目录禁止创建：${relativePath}`)
  }
})

test('Server 忽略规则在独立 Git 根中保护本地状态并放行环境模板', async t => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'qianshu-server-ignore-'))
  t.after(async () => {
    // 清理范围严格限定为 mkdtemp 创建的临时目录，不触碰真实仓库。
    await rm(fixtureRoot, { force: true, recursive: true })
  })

  const ignoreContents = await readFile(path.join(serverRoot, '.gitignore'), 'utf8')
  await writeFile(path.join(fixtureRoot, '.gitignore'), ignoreContents, 'utf8')

  const initResult = spawnSync('git', ['init', '--quiet'], {
    cwd: fixtureRoot,
    encoding: 'utf8',
  })
  assert.equal(initResult.error, undefined)
  assert.equal(initResult.status, 0, initResult.stderr)

  const ignoredPaths = [
    '.env',
    '.env.development',
    'node_modules/pkg/index.js',
    'dist/main.js',
    'coverage/lcov.info',
    'src/generated/prisma/client.ts',
    'tsconfig.build.tsbuildinfo',
    'server.log',
  ]
  const trackedTemplates = ['.env.example', '.env.test.example']

  for (const relativePath of ignoredPaths) {
    assert.equal(
      checkIgnore(fixtureRoot, relativePath),
      0,
      `Server 独立 Git 根应忽略：${relativePath}`,
    )
  }
  for (const relativePath of trackedTemplates) {
    assert.equal(
      checkIgnore(fixtureRoot, relativePath),
      1,
      `Server 独立 Git 根应放行：${relativePath}`,
    )
  }
})
