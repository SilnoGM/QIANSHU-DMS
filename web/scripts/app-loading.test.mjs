import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const appHtml = readFileSync(`${webRoot}/apps/qsmds-arco/index.html`, 'utf8')
const loadingTemplate = readFileSync(`${webRoot}/apps/qsmds-arco/loading.html`, 'utf8')
const routerSource = readFileSync(`${webRoot}/apps/qsmds-arco/src/router/index.ts`, 'utf8')
const reducedMotionStyles = loadingTemplate.slice(
  loadingTemplate.indexOf('@media (prefers-reduced-motion: reduce)'),
)

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
  assert.match(
    loadingTemplate,
    /font-family:\s*"Noto Sans SC",\s*"Apple Color Emoji",\s*"Segoe UI Emoji",\s*"Noto Color Emoji";/u,
  )
  assert.doesNotMatch(
    loadingTemplate,
    /font-family:[^;]*(?:PingFang SC|Microsoft YaHei|system-ui|sans-serif)/iu,
  )
  assert.match(loadingTemplate, /object-fit:\s*contain/u)
  assert.match(loadingTemplate, /linear-gradient\(/u)
  assert.match(loadingTemplate, /repeating-linear-gradient\(/u)
  assert.match(loadingTemplate, /@keyframes\s+qianshu-loading-stripes/u)
  assert.match(loadingTemplate, /@keyframes\s+qianshu-loading-progress/u)
  assert.match(loadingTemplate, /@keyframes\s+qianshu-loading-minimum-duration/u)
  assert.match(
    loadingTemplate,
    /animation:\s*qianshu-loading-minimum-duration\s+1\.5s\s+linear/u,
  )
  assert.match(loadingTemplate, /animation-fill-mode:\s*none/u)
  assert.match(loadingTemplate, /class="qianshu-loading__version"/u)
  assert.match(loadingTemplate, /class="qianshu-loading__progress"/u)
  assert.match(loadingTemplate, /class="qianshu-loading__stripes"\s+aria-hidden="true"/u)
  assert.match(
    loadingTemplate,
    /--loading-primary:\s*__QIANSHU_LOADING_PRIMARY__/u,
  )
  assert.match(
    reducedMotionStyles,
    /\.qianshu-loading__stripes,\s*\.qianshu-loading__progress-value\s*\{\s*animation:\s*none;/u,
  )
  assert.match(
    loadingTemplate,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\[data-app-loading\][\s\S]*?transition-duration:\s*1ms\s*!important/u,
  )
  assert.doesNotMatch(reducedMotionStyles, /qianshu-loading-minimum-duration/u)
  assert.doesNotMatch(
    reducedMotionStyles,
    /\.qianshu-loading\s*\{[^}]*animation:\s*none/iu,
  )

  assert.doesNotMatch(loadingTemplate, /#2fa127|#8e6439/iu)
  assert.doesNotMatch(loadingTemplate, /loading-brand-(?:green|brown)/iu)
  assert.doesNotMatch(loadingTemplate, /面向业务管理场景/u)
  assert.doesNotMatch(loadingTemplate, /rainbow|square-to-dot|Fantastic-admin/iu)
  assert.doesNotMatch(loadingTemplate, /<script|\bfetch\s*\(|\baxios\b|\bpinia\b/iu)
})

test('字体失败状态提供可诊断且可操作的首屏终态', () => {
  assert.match(loadingTemplate, /data-loading-state="loading"/u)
  assert.match(loadingTemplate, /class="qianshu-loading__retry"[^>]*hidden/u)
  assert.match(loadingTemplate, />重新加载<\/button>/u)
  assert.match(
    loadingTemplate,
    /\[data-loading-state="font-error"\][\s\S]*?\.qianshu-loading__progress/u,
  )
})

test('本地字体入口在模块脚本前注册且不访问外部字体服务', () => {
  const sansIndex = appHtml.indexOf('/noto-sans-sc/fonts.css')
  const monoIndex = appHtml.indexOf('/noto-sans-mono/fonts.css')
  const moduleIndex = appHtml.indexOf('<script type="module"')

  assert.ok(sansIndex >= 0)
  assert.ok(monoIndex > sansIndex)
  assert.ok(moduleIndex > monoIndex)
  assert.doesNotMatch(appHtml, /fonts\.(?:googleapis|gstatic)\.com/iu)
})

test('初始路由与核心字体汇入同一退出路径', () => {
  assert.match(
    routerSource,
    /waitForRequiredAppFonts\(document\.fonts\)/u,
  )
  assert.match(
    routerSource,
    /finishInitialAppLoading\(\{[\s\S]*?routeReady:\s*router\.isReady\(\)[\s\S]*?fontsReady/u,
  )
  assert.match(routerSource, /showFontFailure/u)
  assert.match(routerSource, /data-loading-state|dataset\.loadingState/u)
  assert.match(routerSource, /window\.location\.reload\(\)/u)
})
