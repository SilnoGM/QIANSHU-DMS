/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  readSupplierBrowserConfiguration,
  supplierLayoutAuditExpression,
} from './suppliers.browser.helpers.mjs'

const validEnvironment = {
  QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD: 'fixture-password',
  QIANSHU_BROWSER_AUTH_ADMIN_USERNAME: 'browser_admin',
  QIANSHU_BROWSER_AUTH_BASE_URL: 'https://127.0.0.1:43003',
  QIANSHU_BROWSER_AUTH_CHROME_EXECUTABLE: '/opt/google/chrome/chrome',
  QIANSHU_BROWSER_AUTH_HTTP_BASE_URL: 'http://127.0.0.1:43001',
  QIANSHU_BROWSER_AUTH_PROFILE_DIRECTORY: '/tmp/browser-profile',
  QIANSHU_BROWSER_SUPPLIERS_LIMITED_PASSWORD: 'limited-password',
}

test('供应商 Browser 配置复用真实认证边界并验证普通用户密码', () => {
  assert.deepEqual(readSupplierBrowserConfiguration(validEnvironment), {
    baseUrl: 'https://127.0.0.1:43003',
    chromeExecutable: '/opt/google/chrome/chrome',
    httpBaseUrl: 'http://127.0.0.1:43001',
    limitedPassword: 'limited-password',
    password: 'fixture-password',
    profileDirectory: '/tmp/browser-profile',
    username: 'browser_admin',
  })
  assert.throws(
    () => readSupplierBrowserConfiguration({
      ...validEnvironment,
      QIANSHU_BROWSER_SUPPLIERS_LIMITED_PASSWORD: 'short',
    }),
    { message: 'Browser suppliers test configuration is invalid' },
  )
})

test('供应商布局审计显式覆盖桌面、移动、溢出与 44px 触控目标', () => {
  const desktop = supplierLayoutAuditExpression({ mobile: false })
  const mobile = supplierLayoutAuditExpression({ mobile: true })

  for (const expression of [desktop, mobile]) {
    assert.match(expression, /supplier-management-page/u)
    assert.match(expression, /supplier-mobile-row/u)
    assert.match(expression, /scrollWidth/u)
    assert.match(expression, /44/u)
  }
  assert.match(desktop, /mobile = false/u)
  assert.match(mobile, /mobile = true/u)
})
