import type { ProxyNodeDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildProxyNodeCopyText,
  countProxyNodes,
  filterProxyNodes,
  formatProxyNodeCountdown,
  resolveProxyNodeCountryLabel,
  resolveProxyNodeProtocolLabel,
  resolveProxyNodeStatus,
  resolveProxyNodeStatusLabel,
  resolveProxyNodeTypeLabel,
  resolveProxyNodeWarning,
} from '../../src/components/business/QsProxyNodeCard/logic'

const TEST_PASSWORD = ['test', 'pass'].join('-')
const NOW = Date.parse('2026-11-03T00:00:00.000Z')
const DAY_MS = 86_400_000

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString()
}

function node(overrides: Partial<ProxyNodeDto> = {}): ProxyNodeDto {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    providerProxyId: 'i14isvi',
    host: '203.0.113.10',
    publicIp: '203.0.113.10',
    port: 45001,
    protocol: 'SOCKS5',
    countryCode: 'TW',
    countryName: '台湾',
    areaId: '27',
    ipType: 'STATIC_DATACENTER',
    ipVersion: 'IPv4',
    autoExtend: true,
    boughtAt: '2026-09-01T00:00:00.000Z',
    expiresAt: at(12 * DAY_MS),
    lastRenewedAt: '2026-11-01T00:00:00.000Z',
    username: 'example-user',
    password: TEST_PASSWORD,
    credentialUnavailable: false,
    status: 'ACTIVE',
    assignedUser: null,
    assignedAt: null,
    vendorMissing: false,
    lastSyncedAt: '2026-11-03T00:00:00.000Z',
    ...overrides,
  }
}

test('countdown always shows days and pads the time parts', () => {
  const expiresAt = '2026-11-15T03:04:05.000Z'
  assert.equal(
    formatProxyNodeCountdown(expiresAt, NOW),
    '剩余 12 天 03:04:05',
  )
  assert.equal(
    formatProxyNodeCountdown('2026-11-03T03:04:05.000Z', NOW),
    '剩余 0 天 03:04:05',
  )
  assert.equal(
    formatProxyNodeCountdown('2026-11-01T20:55:55.000Z', NOW),
    '已过期 1 天 03:04:05',
  )
  assert.equal(
    formatProxyNodeCountdown('2026-11-02T20:55:55.000Z', NOW),
    '已过期 0 天 03:04:05',
  )
})

test('countdown rounds up the final second and switches at exact expiry', () => {
  assert.equal(
    formatProxyNodeCountdown(at(1), NOW),
    '剩余 0 天 00:00:01',
  )
  assert.equal(
    formatProxyNodeCountdown(at(0), NOW),
    '已过期 0 天 00:00:00',
  )
  assert.equal(
    formatProxyNodeCountdown(at(-1), NOW),
    '已过期 0 天 00:00:00',
  )
})

test('status thresholds match the server and the agreed bands', () => {
  assert.equal(resolveProxyNodeStatus(at(7 * DAY_MS + 1), NOW), 'ACTIVE')
  assert.equal(resolveProxyNodeStatus(at(7 * DAY_MS), NOW), 'EXPIRING_SOON')
  assert.equal(resolveProxyNodeStatus(at(DAY_MS + 1), NOW), 'EXPIRING_SOON')
  assert.equal(resolveProxyNodeStatus(at(DAY_MS), NOW), 'EXPIRING_CRITICAL')
  assert.equal(resolveProxyNodeStatus(at(1), NOW), 'EXPIRING_CRITICAL')
  assert.equal(resolveProxyNodeStatus(at(0), NOW), 'EXPIRED')
  assert.equal(resolveProxyNodeStatus(at(-1), NOW), 'EXPIRED')
})

test('status labels and warnings are coarse, with exact time in the countdown', () => {
  assert.equal(resolveProxyNodeStatusLabel('ACTIVE'), '正常')
  assert.equal(resolveProxyNodeStatusLabel('EXPIRING_SOON'), '即将到期')
  assert.equal(resolveProxyNodeStatusLabel('EXPIRING_CRITICAL'), '即将到期')
  assert.equal(resolveProxyNodeStatusLabel('EXPIRED'), '已过期')

  assert.equal(resolveProxyNodeWarning('ACTIVE', 'operations'), null)
  assert.equal(
    resolveProxyNodeWarning('EXPIRING_SOON', 'operations'),
    '请联系管理员续费',
  )
  assert.equal(
    resolveProxyNodeWarning('EXPIRING_CRITICAL', 'management'),
    '请立即处理',
  )
  assert.equal(
    resolveProxyNodeWarning('EXPIRED', 'operations'),
    '节点已过期，复制后的配置可能不可用',
  )
})

test('country labels apply the TW/HK override and fall back to the code', () => {
  assert.equal(resolveProxyNodeCountryLabel(node()), 'TW-中国台湾')
  assert.equal(
    resolveProxyNodeCountryLabel(node({ countryCode: 'HK', countryName: 'Hong Kong' })),
    'HK-中国香港',
  )
  assert.equal(
    resolveProxyNodeCountryLabel(node({ countryCode: 'US', countryName: 'United States' })),
    'US-United States',
  )
  assert.equal(
    resolveProxyNodeCountryLabel(node({ countryCode: 'US', countryName: null })),
    'US',
  )
  assert.equal(
    resolveProxyNodeCountryLabel(node({ countryCode: null, countryName: null })),
    '—',
  )
})

test('type and protocol labels are stable', () => {
  assert.equal(resolveProxyNodeTypeLabel('STATIC_DATACENTER'), '静态数据中心')
  assert.equal(resolveProxyNodeTypeLabel('STATIC_ISP'), '静态住宅')
  assert.equal(resolveProxyNodeTypeLabel('STATIC_ISP_PRO'), '静态住宅 Pro')
  assert.equal(resolveProxyNodeProtocolLabel('SOCKS5'), 'SOCKS5')
  assert.equal(resolveProxyNodeProtocolLabel('HTTP'), 'HTTP')
  assert.equal(resolveProxyNodeProtocolLabel('SSH'), 'SSH')
})

test('copy text uses the agreed protocol://host:port:user:pass shape', () => {
  assert.equal(
    buildProxyNodeCopyText(node()),
    `socks5://203.0.113.10:45001:example-user:${TEST_PASSWORD}`,
  )
  assert.equal(
    buildProxyNodeCopyText(node({ protocol: 'HTTP' })).startsWith('http://'),
    true,
  )
  assert.equal(
    buildProxyNodeCopyText(node({ protocol: 'SSH' })).startsWith('ssh://'),
    true,
  )
})

test('filters combine live status and keyword without mutating rows', () => {
  const assigned = { id: 'user', displayName: '张强', username: 'zhang', avatarUrl: null }
  const rows = [
    node({ id: 'active', expiresAt: at(10 * DAY_MS), assignedUser: assigned }),
    node({ id: 'soon', expiresAt: at(5 * DAY_MS) }),
    node({ id: 'critical', expiresAt: at(DAY_MS) }),
    node({ id: 'expired', expiresAt: at(-DAY_MS) }),
    node({ id: 'unassigned', expiresAt: at(10 * DAY_MS) }),
  ]

  assert.deepEqual(
    filterProxyNodes(rows, 'EXPIRING', '', NOW).map(row => row.id),
    ['soon', 'critical'],
  )
  assert.deepEqual(
    filterProxyNodes(rows, 'EXPIRING_2D', '', NOW).map(row => row.id),
    ['critical'],
  )
  assert.deepEqual(
    filterProxyNodes(rows, 'EXPIRED', '', NOW).map(row => row.id),
    ['expired'],
  )
  assert.deepEqual(
    filterProxyNodes(rows, 'UNASSIGNED', '', NOW).map(row => row.id),
    ['soon', 'critical', 'expired', 'unassigned'],
  )
  assert.deepEqual(
    filterProxyNodes(rows, 'ALL', '203.0.113.10', NOW).map(row => row.id),
    rows.map(row => row.id),
  )
})

test('two-day view includes the next 48 hours and excludes expired and later nodes', () => {
  const rows = [
    node({ id: 'two-days', expiresAt: at(2 * DAY_MS) }),
    node({ id: 'two-days-plus', expiresAt: at(2 * DAY_MS + 1) }),
    node({ id: 'one-and-half', expiresAt: at(1.5 * DAY_MS) }),
    node({ id: 'one-ms', expiresAt: at(1) }),
    node({ id: 'expired', expiresAt: at(-1) }),
  ]

  assert.deepEqual(
    filterProxyNodes(rows, 'EXPIRING_2D', '', NOW).map(row => row.id),
    ['two-days', 'one-and-half', 'one-ms'],
  )
})

test('counts summarise assignment and expiry for the page strip', () => {
  const assigned = { id: 'user', displayName: '张强', username: 'zhang', avatarUrl: null }
  const rows = [
    node({ expiresAt: at(10 * DAY_MS), assignedUser: assigned }),
    node({ expiresAt: at(5 * DAY_MS) }),
    node({ expiresAt: at(DAY_MS) }),
    node({ expiresAt: at(-DAY_MS) }),
  ]

  assert.deepEqual(countProxyNodes(rows, NOW), {
    total: 4,
    active: 1,
    assigned: 1,
    unassigned: 3,
    expiring: 2,
    expiring2d: 1,
    expired: 1,
  })
})
