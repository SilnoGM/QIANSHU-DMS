import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
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
    await access(fromRoot(...segments))
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false
    }
    throw error
  }
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
    build: 'pnpm run build:server && pnpm run build:web',
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
    'docs/文档索引.md',
    'docs/全局文档/项目工程组织方案.md',
    'docs/全局文档/阶段一根级治理实施计划.md',
  ]

  for (const file of requiredFiles) {
    assert.equal(await exists(file), true, `缺少根级治理文件：${file}`)
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
  assert.equal(await exists('docs/全局文档/项目工程组织方案.md'), true)
  assert.equal(await exists('docs/全局文档/阶段一根级治理实施计划.md'), true)
})
