import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- legacy Storage 迁移使用 Node.js 内置 runner。
import test from 'node:test'

import {
  cleanupLegacyAuthStorageBeforeApp,
  removeLegacyAuthStorage,
} from '../../src/auth/legacy-auth-cleanup'

class MemoryStorage {
  readonly values = new Map<string, string>()

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

test('启动前删除所有固定历史前缀下的旧认证键', () => {
  const storage = new MemoryStorage()
  for (const key of [
    'token',
    'qsdms_devtoken',
    'qsdms_protoken',
    'qianshu-dmstoken',
    'fa_test_token',
    'account',
    'qsdms_devaccount',
    'avatar',
    'qsdms_proavatar',
    'login_account',
    'qianshu-dmslogin_account',
    'appAccount',
    'fa_test_appAccount',
    'theme',
    'qsdms_devtheme',
  ]) {
    storage.values.set(key, 'value')
  }

  removeLegacyAuthStorage(storage)

  assert.deepEqual([...storage.values.keys()].sort(), [
    'qsdms_devtheme',
    'theme',
  ])
})

test('Storage 拒绝单个删除时继续 best effort 清理其他认证键', () => {
  const removed: string[] = []
  const storage = {
    removeItem(key: string) {
      if (key === 'token') {
        throw new Error('blocked')
      }
      removed.push(key)
    },
  }

  assert.doesNotThrow(() => removeLegacyAuthStorage(storage))
  assert.equal(removed.includes('account'), true)
  assert.equal(removed.includes('appAccount'), true)
})

test('Storage getter 不可用时继续清理另一个 Storage 并允许应用启动', () => {
  const removed: string[] = []
  const scope = Object.defineProperties({} as {
    readonly localStorage: { removeItem: (key: string) => void }
    readonly sessionStorage: { removeItem: (key: string) => void }
  }, {
    localStorage: {
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    },
    sessionStorage: {
      get() {
        return {
          removeItem(key: string) {
            removed.push(key)
          },
        }
      },
    },
  })

  assert.doesNotThrow(() => cleanupLegacyAuthStorageBeforeApp(scope))
  assert.equal(removed.includes('token'), true)
  assert.equal(removed.includes('appAccount'), true)
})

test('legacy purge 必须在应用、Router、Pinia 和 Storage proxy 之前导入', () => {
  const mainSource = readFileSync(
    new URL('../../src/main.ts', import.meta.url),
    'utf8',
  )
  const cleanupImport = mainSource.indexOf('import \'@/auth/legacy-auth-bootstrap\'')

  assert.ok(cleanupImport >= 0)
  for (const laterImport of [
    'import App from \'./App.vue\'',
    'import router from \'./router\'',
    'import pinia from \'./store\'',
    'import \'@/utils/storage\'',
  ]) {
    assert.ok(cleanupImport < mainSource.indexOf(laterImport), laterImport)
  }
})
