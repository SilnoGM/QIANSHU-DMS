import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 始终从测试脚本所在位置定位仓库，保证从仓库外执行时仍验证同一套工程边界。
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const serverRoot = path.join(repositoryRoot, 'server')
const expectedPnpmSecuritySettings = `allowBuilds:
  '@prisma/engines': true
  prisma: true
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

function dependencyEntries(manifest) {
  const dependencySections = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]

  return dependencySections.flatMap(section =>
    Object.entries(manifest[section] ?? {}).map(([name, specifier]) => ({
      name,
      section,
      specifier,
    })),
  )
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

test('Server 的全部依赖只能来自独立 registry 版本', async () => {
  const manifest = JSON.parse(
    await readFile(fromRoot('server', 'package.json'), 'utf8'),
  )
  const localProtocol = /^(?:file|link|portal|workspace):/

  for (const { name, section, specifier } of dependencyEntries(manifest)) {
    assert.equal(
      typeof specifier,
      'string',
      `${section}.${name} 必须使用字符串版本`,
    )
    assert.equal(
      localProtocol.test(specifier),
      false,
      `${section}.${name} 禁止跨依赖域引用：${specifier}`,
    )
  }
})

test('仓库根目录仍不产生 pnpm workspace、lockfile 或依赖目录', async () => {
  for (const relativePath of ['pnpm-workspace.yaml', 'pnpm-lock.yaml', 'node_modules']) {
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
