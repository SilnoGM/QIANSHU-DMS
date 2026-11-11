import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner 验证，无需浏览器环境。
import test from 'node:test'

import systemStatusRoute from '../../src/router/modules/system.status'
import {
  capabilityLabel,
  capacityLevelLabel,
  databaseShortLabel,
  diskLevelText,
  diskLevelTone,
  environmentLabel,
  environmentTone,
  findCheckStatus,
  formatBytes,
  formatCores,
  formatCount,
  formatDuration,
  formatPercent,
  hostMemoryLevelText,
  isDeploymentMismatch,
  mediaDriverLabel,
  methodTone,
  overallTone,
  resolveOverallReason,
  splitOperation,
  statusCodeLabel,
  statusCodeTone,
  statusTone,
  versionWithPrefix,
} from '../../src/views/system/status/status.logic'

const pageSource = readFileSync(
  new URL('../../src/views/system/status/index.vue', import.meta.url),
  'utf8',
)
const apiSource = readFileSync(
  new URL('../../src/api/modules/system-status.ts', import.meta.url),
  'utf8',
)

test('系统状态路由挂在系统管理下并声明独立读取权限', () => {
  assert.equal(systemStatusRoute.path, '/system/status')
  assert.equal(systemStatusRoute.name, 'systemStatus')
  assert.equal(systemStatusRoute.meta?.title, '系统状态')
  assert.equal(systemStatusRoute.meta?.auth, 'system-status:read')
  assert.equal(systemStatusRoute.meta?.singleMenu, true)
  assert.equal(typeof systemStatusRoute.component, 'function')
})

test('系统状态页包含刷新、轮询、错误态、过期态与四个分组', () => {
  for (const testId of [
    'system-status-page',
    'system-status-refresh',
    'system-status-error',
    'system-status-stale',
    'system-status-empty',
    'system-status-services',
    'system-status-resources',
    'system-status-performance',
    'system-status-runtime',
  ]) {
    assert.match(pageSource, new RegExp(`data-testid="${testId}"`, 'u'))
  }

  assert.match(pageSource, /POLL_INTERVAL_MS = 30_000/u)
  assert.match(pageSource, /visibilitychange/u)
  assert.match(pageSource, /AbortController/u)
  assert.match(pageSource, /auth\('system-status:read'\)/u)
  assert.match(pageSource, /FaPageHeader/u)
  assert.match(pageSource, /FaPageMain/u)
  assert.match(pageSource, /FaAlert/u)
  assert.match(pageSource, /FaEmpty/u)
  assert.match(pageSource, /FaButton/u)
  assert.match(pageSource, /FaTag/u)
  assert.match(pageSource, /SYSTEM_STATUS_LABELS/u)
  assert.match(pageSource, /数据可能已过期/u)
  assert.match(pageSource, /样本不足/u)
})

test('系统状态页不硬编码颜色，也不使用 Arco 组件', () => {
  assert.doesNotMatch(pageSource, /#[\dA-Fa-f]{3,8}\b/u)
  assert.doesNotMatch(pageSource, /rgba?\(\s*[\d.]+/u)
  assert.doesNotMatch(pageSource, /hsla?\(\s*[\d.]+/u)
  assert.doesNotMatch(pageSource, /<A[A-Z][A-Za-z0-9]*\b/u)
})

test('系统状态 API 只读、不自动重试且局部展示错误', () => {
  assert.match(apiSource, /'system\/status'/u)
  assert.match(apiSource, /errorPresentation: 'local'/u)
  assert.match(apiSource, /retry: false/u)
  assert.doesNotMatch(apiSource, /X-Qianshu-CSRF/u)
})

test('状态与容量文案映射固定为中文', () => {
  assert.equal(statusTone('ok'), 'success')
  assert.equal(statusTone('warning'), 'warning')
  assert.equal(statusTone('critical'), 'danger')
  assert.equal(statusTone('unknown'), 'neutral')
  assert.equal(environmentTone('prod'), 'success')
  assert.equal(environmentTone('test'), 'warning')
  assert.equal(environmentTone('dev'), 'success')
  assert.equal(environmentTone('unknown'), 'neutral')
  assert.equal(environmentLabel('dev'), '开发环境')
  assert.equal(environmentLabel('test'), '测试环境')
  assert.equal(environmentLabel('prod'), '生产环境')
  assert.equal(environmentLabel('unknown'), '未知环境')
  assert.equal(capabilityLabel('up'), '正常')
  assert.equal(capabilityLabel('down'), '异常')
  assert.equal(capabilityLabel('unknown'), '未知')
  assert.equal(capacityLevelLabel('critical'), '不足')
  assert.equal(capacityLevelLabel('warning'), '偏低')
  assert.equal(mediaDriverLabel('cos'), '对象存储（COS）')
  assert.equal(mediaDriverLabel('local'), '本地磁盘')
})

test('资源格式化在缺失值时显示破折号而不是零', () => {
  assert.equal(formatBytes(null), '—')
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(1024), '1.0 KiB')
  assert.equal(formatBytes(1024 * 1024 * 1.5), '1.5 MiB')
  assert.equal(formatPercent(null), '—')
  assert.equal(formatPercent(41.254, 2), '41.25%')
  assert.equal(formatCores(null), '—')
  assert.equal(formatCores(0.1), '0.10 核')
  assert.equal(formatCount(null), '—')
  assert.equal(formatCount(1234), '1,234')
  assert.equal(formatDuration(null), '—')
  assert.equal(formatDuration(5 * 86_400 + 3_600), '5 天 1 小时')
  assert.equal(formatDuration(3_600 + 120), '1 小时 2 分')
})

test('部署版本一致性与检查项查找', () => {
  assert.equal(isDeploymentMismatch('1.5.2', '1.5.2'), false)
  assert.equal(isDeploymentMismatch('1.5.2', '1.5.1'), true)
  assert.equal(isDeploymentMismatch(null, '1.5.2'), false)
  assert.equal(findCheckStatus([{ key: 'cpu', status: 'warning' }], 'cpu'), 'warning')
  assert.equal(findCheckStatus([], 'cpu'), 'unknown')
})

test('慢请求拆分、方法/状态码色调与状态文案', () => {
  assert.deepEqual(splitOperation('GET /sales-orders/:id'), {
    method: 'GET',
    route: '/sales-orders/:id',
  })
  assert.deepEqual(splitOperation('unexpected'), {
    method: 'ANY',
    route: 'unexpected',
  })
  assert.equal(methodTone('GET'), 'info')
  assert.equal(methodTone('POST'), 'warning')
  assert.equal(methodTone('DELETE'), 'danger')
  assert.equal(statusCodeLabel(200), '200 OK')
  assert.equal(statusCodeLabel(404), '404 请求错误')
  assert.equal(statusCodeLabel(503), '503 异常')
  assert.equal(statusCodeTone(200), 'success')
  assert.equal(statusCodeTone(404), 'warning')
  assert.equal(statusCodeTone(503), 'danger')
})

test('磁盘、宿主内存、整体状态与原因文案', () => {
  assert.equal(diskLevelText(26.3), '水位正常')
  assert.equal(diskLevelText(15), '容量偏低')
  assert.equal(diskLevelText(5), '容量不足')
  assert.equal(diskLevelText(null), '未知')
  assert.equal(diskLevelTone(26.3), 'success')
  assert.equal(diskLevelTone(15), 'warning')
  assert.equal(diskLevelTone(5), 'danger')
  assert.equal(hostMemoryLevelText(30), '正常')
  assert.equal(hostMemoryLevelText(12), '宿主可用偏低')
  assert.equal(hostMemoryLevelText(5), '宿主可用偏低')
  assert.equal(hostMemoryLevelText(4), '宿主可用不足')
  assert.equal(overallTone('critical'), 'rose')
  assert.equal(overallTone('warning'), 'amber')
  assert.equal(overallTone('ok'), 'emerald')
  assert.equal(overallTone('unknown'), 'neutral')

  const performanceReason = resolveOverallReason({
    overallStatus: 'critical',
    checks: [],
    performance: { errorRatePercent: 20.3, windowRequests: 80 },
  })
  assert.match(performanceReason.text, /5xx 错误率 20\.3%/u)
  assert.equal(performanceReason.tone, 'danger')

  const okReason = resolveOverallReason({
    overallStatus: 'ok',
    checks: [],
    performance: { errorRatePercent: 0, windowRequests: 80 },
  })
  assert.equal(okReason.text, '全部检查通过')
  assert.equal(okReason.tone, 'success')
})

test('数据库与版本标签格式', () => {
  assert.equal(
    databaseShortLabel('PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1)'),
    'PostgreSQL 16.14',
  )
  assert.equal(databaseShortLabel(null), '数据库')
  assert.equal(versionWithPrefix('1.5.2'), 'v1.5.2')
  assert.equal(versionWithPrefix('v1.5.2'), 'v1.5.2')
  assert.equal(versionWithPrefix(null), '—')
})
