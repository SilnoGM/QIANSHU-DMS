import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 与仓库现有路由测试使用同一 Node runner。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

/** 只替换全局自动导入和 Store，运行真实扩展函数，证明取消导航不移除当前表单页签。 */
function fixture(failed: boolean) {
  const removed: string[] = []
  const failure = failed ? { type: 4 } : undefined
  const router = {
    currentRoute: { value: { fullPath: '/numbering/create', meta: {} } },
    push: async () => failure,
    replace: async () => failure,
    go() {},
    back() {},
    close: async (): Promise<unknown> => undefined,
  }
  const store = { list: [], remove: (id: string) => removed.push(id), $patch() {} }
  const source = readFileSync(new URL('../../src/router/extensions.ts', import.meta.url), 'utf8')
    .replace('import pinia from \'@/store\'', 'const pinia = {}')
  const exports: { default?: (router: unknown) => void } = {}
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    useAppSettingsStore: () => ({ settings: { topbar: { tabbar: true } } }),
    useAppTabbarStore: () => store,
  })
  exports.default!(router)
  return { router, removed, failure }
}

test('关闭和替换页签只在导航成功后移除，且透传导航失败给调用方', async () => {
  for (const operation of ['close', 'replace'] as const) {
    const denied = fixture(true)
    assert.equal(await denied.router[operation](), denied.failure)
    assert.deepEqual(denied.removed, [])
    const accepted = fixture(false)
    assert.equal(await accepted.router[operation](), undefined)
    assert.deepEqual(accepted.removed, ['/numbering/create'])
  }
})
