import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptsDirectory, '..')

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(webRoot, relativePath), 'utf8'))
}

function readText(relativePath) {
  return fs.readFileSync(path.join(webRoot, relativePath), 'utf8')
}

test('默认开发、构建和预览命令只运行正式业务应用', () => {
  const { scripts } = readJson('package.json')

  assert.equal(scripts.dev, 'pnpm --filter qsmds-arco run dev')
  assert.equal(scripts.build, 'pnpm --filter qsmds-arco run build')
  assert.equal(scripts.serve, 'pnpm --filter qsmds-arco run serve')
  assert.equal(scripts['dev:select'], 'tsx scripts/cli.ts --mode=dev')
  assert.equal(scripts['build:select'], 'tsx scripts/cli.ts --mode=build')
  assert.equal(scripts['serve:select'], 'tsx scripts/cli.ts --mode=serve')
})

test('默认检查只读且修复命令必须显式调用', () => {
  const { scripts } = readJson('package.json')

  assert.equal(scripts.typecheck, 'pnpm --filter qsmds-arco run typecheck')
  assert.equal(scripts.lint, 'run-s lint:eslint lint:stylelint')
  assert.equal(scripts['lint:eslint'], 'eslint apps/qsmds-arco packages')
  assert.equal(scripts['lint:stylelint'], 'stylelint "{apps/qsmds-arco,packages}/**/*.{css,scss,vue}"')
  assert.equal(scripts['lint:fix'], 'run-s lint:eslint:fix lint:stylelint:fix')
  assert.equal(scripts['lint:eslint:fix'], 'eslint apps/qsmds-arco packages --fix')
  assert.equal(scripts['lint:stylelint:fix'], 'stylelint "{apps/qsmds-arco,packages}/**/*.{css,scss,vue}" --fix')
  assert.equal(scripts.check, 'run-s test:scripts typecheck lint')

  for (const scriptName of ['lint', 'lint:eslint', 'lint:stylelint', 'check']) {
    assert.equal(scripts[scriptName].includes('--fix'), false, `${scriptName} 不得自动修复`)
  }
})

test('脚本测试同时运行 Node 与 TypeScript 测试', () => {
  const { scripts } = readJson('package.json')

  assert.equal(scripts['test:scripts'], 'run-s test:scripts:node test:scripts:tsx')
  assert.equal(scripts['test:scripts:node'], 'node --test scripts/*.test.mjs')
  assert.equal(scripts['test:scripts:tsx'], 'tsx --test scripts/cli.test.ts')
})

test('参考应用通过稳定 package name 显式检查和构建', () => {
  const { scripts } = readJson('package.json')
  const filters = '--filter @fantastic-admin/core --filter @fantastic-admin/core-arco-design-vue --filter @fantastic-admin/example'

  assert.equal(scripts['check:examples'], `pnpm ${filters} -r run lint`)
  assert.equal(scripts['build:examples'], `pnpm ${filters} -r run build`)
  assert.equal(scripts['check:examples'].includes('./examples/*'), false)
  assert.equal(scripts['build:examples'].includes('./examples/*'), false)
})

test('安装守卫不联网且嵌套 Web 不安装 Git hook', () => {
  const manifest = readJson('package.json')

  assert.equal(manifest.scripts.preinstall, 'node ./scripts/ensure-pnpm.mjs')
  assert.equal(manifest.scripts.preinstall.includes('npx'), false)
  assert.equal(Object.hasOwn(manifest.scripts, 'postinstall'), false)
  assert.equal(Object.hasOwn(manifest, 'simple-git-hooks'), false)
  assert.equal(Object.hasOwn(manifest.devDependencies, 'simple-git-hooks'), false)
  assert.equal(readText('pnpm-workspace.yaml').includes('simple-git-hooks'), false)
  assert.equal(readText('pnpm-lock.yaml').includes('simple-git-hooks'), false)
})

test('OpenAPI 生成留到阶段四且既有维护命令继续保留', () => {
  const { scripts } = readJson('package.json')

  assert.equal(Object.hasOwn(scripts, 'api:generate'), false)
  assert.equal(scripts['generate:settings-preferences'], 'pnpm --filter @fantastic-admin/settings generate:preferences')
  assert.equal(scripts.taze, 'taze minor -wIr')
  assert.equal(scripts.commit, 'git cz')
  assert.equal(scripts.release, 'bumpp')
  assert.equal(Object.hasOwn(scripts, 'lint:tsc'), false)
})

test('正式业务应用提供语义明确的 typecheck 命令', () => {
  const { scripts } = readJson('apps/qsmds-arco/package.json')
  assert.equal(scripts.typecheck, 'vue-tsc -b')
})
