import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 `tsx --test` 直接运行，不引入额外测试框架。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptsDirectory, '..')
const cliPath = path.join(scriptsDirectory, 'cli.ts')
const cliSource = fs.readFileSync(cliPath, 'utf8')

// 先验证导出与入口守卫，旧 CLI 在这里直接 RED，避免 import 时启动交互流程。
assert.match(cliSource, /export function getWorkspaceEntries/)
assert.match(cliSource, /isDirectEntry/)

const listenersBeforeImport = process.listenerCount('SIGINT')
const { getAppChoices, getApps, getWorkspaceEntries, printHelp } = await import('./cli.ts')

test('导入 CLI 不执行 main 或注册进程级信号监听', () => {
  assert.equal(process.listenerCount('SIGINT'), listenersBeforeImport)
})

test('workspace 扫描稳定区分一个业务应用和三个参考应用', () => {
  const entries = getWorkspaceEntries(webRoot)
  assert.deepEqual(entries.map(entry => ({ kind: entry.kind, name: entry.name })), [
    { kind: 'business', name: 'qsmds-arco' },
    { kind: 'example', name: 'core' },
    { kind: 'example', name: 'core-arco-design-vue' },
    { kind: 'example', name: 'example' },
  ])
})

test('应用和选择标签保留 workspace 分类', () => {
  const apps = getApps(scriptName => scriptName === 'dev', webRoot)
  assert.deepEqual(apps.map(app => ({ kind: app.kind, packageName: app.packageName })), [
    { kind: 'business', packageName: 'qsmds-arco' },
    { kind: 'example', packageName: '@fantastic-admin/core' },
    { kind: 'example', packageName: '@fantastic-admin/core-arco-design-vue' },
    { kind: 'example', packageName: '@fantastic-admin/example' },
  ])

  assert.deepEqual(getAppChoices(apps).map(choice => choice.label), [
    '[business] qsmds-arco',
    '[example] core',
    '[example] core-arco-design-vue',
    '[example] example',
  ])
})

test('帮助只把交互式入口描述为 select 命令', () => {
  const lines: string[] = []
  const originalLog = console.log
  console.log = (...values: unknown[]) => lines.push(values.join(' '))

  try {
    printHelp()
  }
  finally {
    console.log = originalLog
  }

  const help = lines.join('\n')
  assert.match(help, /pnpm dev:select/)
  assert.match(help, /pnpm build:select/)
  assert.match(help, /pnpm serve:select/)
  assert.doesNotMatch(help, /pnpm cli/)
})
