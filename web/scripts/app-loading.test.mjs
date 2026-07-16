import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const loadingTemplate = readFileSync(`${webRoot}/apps/qsmds-arco/loading.html`, 'utf8')
const routerSource = readFileSync(`${webRoot}/apps/qsmds-arco/src/router/index.ts`, 'utf8')

test('正式应用首屏 Loading 使用浅色主题动效并保持独立初始化边界', () => {
  assert.match(loadingTemplate, /src\/assets\/images\/logo\.svg/u)
  assert.match(loadingTemplate, /%VITE_APP_TITLE%/u)
  assert.match(loadingTemplate, /__QIANSHU_APP_VERSION__/u)
  assert.match(loadingTemplate, /正在准备工作台/u)
  assert.match(
    loadingTemplate,
    /© 2023–2026 Liaocheng Qianshu Culture Media Co\., Ltd\. All Rights Reserved\./u,
  )
  assert.match(loadingTemplate, /role="status"/u)
  assert.match(loadingTemplate, /aria-live="polite"/u)
  assert.match(loadingTemplate, /aria-busy="true"/u)
  assert.match(loadingTemplate, /object-fit:\s*contain/u)
  assert.match(loadingTemplate, /linear-gradient\(/u)
  assert.match(loadingTemplate, /repeating-linear-gradient\(/u)
  assert.match(loadingTemplate, /@keyframes\s+qianshu-loading-stripes/u)
  assert.match(loadingTemplate, /@keyframes\s+qianshu-loading-progress/u)
  assert.match(loadingTemplate, /class="qianshu-loading__version"/u)
  assert.match(loadingTemplate, /class="qianshu-loading__progress"/u)
  assert.match(loadingTemplate, /class="qianshu-loading__stripes"\s+aria-hidden="true"/u)
  assert.match(
    loadingTemplate,
    /--loading-primary:\s*__QIANSHU_LOADING_PRIMARY__/u,
  )
  assert.match(
    loadingTemplate,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation:\s*none/u,
  )
  assert.match(
    loadingTemplate,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\[data-app-loading\][\s\S]*?transition-duration:\s*1ms\s*!important/u,
  )

  assert.doesNotMatch(loadingTemplate, /#2fa127|#8e6439/iu)
  assert.doesNotMatch(loadingTemplate, /loading-brand-(?:green|brown)/iu)
  assert.doesNotMatch(loadingTemplate, /面向业务管理场景/u)
  assert.doesNotMatch(loadingTemplate, /rainbow|square-to-dot|Fantastic-admin/iu)
  assert.doesNotMatch(loadingTemplate, /<script|\bfetch\s*\(|\baxios\b|\bpinia\b/iu)
})

test('初始路由无论成功或失败都会解除首屏 Loading', () => {
  assert.match(
    routerSource,
    /router\.isReady\(\)\.then\(\s*loadingFadeOut\s*,\s*loadingFadeOut\s*\)/u,
  )
})
