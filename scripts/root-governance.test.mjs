import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// 测试以自身位置推导仓库根目录，避免调用者从其他工作目录执行时误读同名文件。
const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')

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

async function assertRegularFile(relativePath) {
  const fileStats = await lstat(fromRoot(relativePath))
  assert.equal(fileStats.isFile(), true, `治理路径必须是实际文件：${relativePath}`)
}

function checkIgnore(relativePath) {
  // 明确固定 Git 的工作目录，使忽略规则回归测试不依赖调用测试时所在的 cwd。
  const result = spawnSync(
    'git',
    ['check-ignore', '-q', '--no-index', '--', relativePath],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )

  assert.equal(result.error, undefined, `无法执行 git check-ignore：${relativePath}`)
  assert.ok(
    result.status === 0 || result.status === 1,
    `git check-ignore 异常退出：${relativePath}\n${result.stderr}`,
  )
  return result.status
}

test('根 package 保持无依赖且不是 workspace', async () => {
  const manifest = JSON.parse(await readFile(fromRoot('package.json'), 'utf8'))

  assert.equal(manifest.name, 'qianshu-dms')
  assert.equal(manifest.private, true)
  assert.equal(manifest.packageManager, 'pnpm@11.9.0')
  assert.equal(manifest.engines.node, '^24.15.0')
  assert.equal('workspaces' in manifest, false)
  assert.equal('dependencies' in manifest, false)
  assert.equal('devDependencies' in manifest, false)
  assert.deepEqual(manifest.scripts, {
    bootstrap: 'node ./scripts/bootstrap.mjs',
    dev: 'node ./scripts/dev.mjs',
    'dev:server': 'pnpm -C server dev',
    'dev:web': 'pnpm -C web dev',
    'test:root': 'node --test ./scripts/*.test.mjs',
    check: 'node ./scripts/check.mjs',
    'check:server': 'pnpm -C server check',
    'check:web': 'pnpm -C web check',
    build: 'pnpm -C server build && pnpm -C web build',
    'build:server': 'pnpm -C server build',
    'build:web': 'pnpm -C web build',
  })
})

test('根目录不创建 workspace、lockfile 或依赖目录', async () => {
  assert.equal(await exists('pnpm-workspace.yaml'), false)
  assert.equal(await exists('pnpm-lock.yaml'), false)
  assert.equal(await exists('node_modules'), false)
})

test('根级治理文件和阶段一文档真实存在', async () => {
  const requiredFiles = [
    'README.md',
    'AGENTS.md',
    '.gitignore',
    '.editorconfig',
    '.node-version',
    'package.json',
    'scripts/root-governance.test.mjs',
    'docs/文档索引.md',
    'docs/全局文档/项目工程组织方案.md',
    'docs/全局文档/阶段一根级治理实施计划.md',
  ]

  for (const file of requiredFiles) {
    await assertRegularFile(file)
  }
})

test('Node.js 主版本配置为 24', async () => {
  const nodeVersion = await readFile(fromRoot('.node-version'), 'utf8')
  assert.equal(nodeVersion.trim(), '24')
})

test('文档索引链接到两份真实全局文档', async () => {
  const index = await readFile(fromRoot('docs', '文档索引.md'), 'utf8')

  assert.match(index, /\(\.\/全局文档\/项目工程组织方案\.md\)/)
  assert.match(index, /\(\.\/全局文档\/阶段一根级治理实施计划\.md\)/)
  await assertRegularFile('docs/全局文档/项目工程组织方案.md')
  await assertRegularFile('docs/全局文档/阶段一根级治理实施计划.md')
})

test('Git 忽略真实环境文件、系统文件和生成目录，但保留环境模板', () => {
  const ignoredPaths = [
    'server/.env',
    'web/apps/qsmds-arco/.env.development',
    '.DS_Store',
    'docs/.DS_Store',
    'server/src/generated/prisma/client.ts',
    'web/apps/qsmds-arco/src/api/generated/schema.d.ts',
  ]
  const trackedTemplatePaths = [
    'server/.env.example',
    'server/.env.test.example',
  ]

  for (const file of ignoredPaths) {
    assert.equal(checkIgnore(file), 0, `路径应被 Git 忽略：${file}`)
  }
  for (const file of trackedTemplatePaths) {
    assert.equal(checkIgnore(file), 1, `环境模板不应被 Git 忽略：${file}`)
  }
})
