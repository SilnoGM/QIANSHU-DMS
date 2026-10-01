import type { GitGraphCommit, GitGraphVersion, ReleaseNotesGroup } from '../../src/types/development-map'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner 验证，无需浏览器环境。
import test from 'node:test'
import {
  commitDotColor,
  commitToneClass,
  drawGraphRow,
  filterGraphCommits,
  graphColumnWidth,
  isGraphFilterActive,
  laneColor,
  typeFilterOptions,
  versionFilterOptions,
} from '../../src/views/system/development-map/git-graph.logic'
import {
  graphRouteFor,
  groupToneClass,
  releaseCardSubtitle,
  shouldFoldGroup,
  visibleGroupItems,
} from '../../src/views/system/release-notes/release-notes.logic'
import { describeDevelopmentDataSource } from '../../src/views/system/shared/development-data-source'
import {
  buildHealthProbeResult,
  describeBrowserEnvironment,
  describeFrontendBuild,
  describeIdentity,
  formatStatusMoment,
  readFailureRequestId,
  readRequestId,
  toneColor,
} from '../../src/views/system/status/status.logic'

function readPageSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

const pageContracts = [
  {
    files: [
      '../../src/views/system/release-notes/index.vue',
      '../../src/views/system/release-notes/release-notes-card.vue',
    ],
    label: '版本更新',
    virtualImport: 'virtual:qianshu/release-notes',
  },
  {
    files: [
      '../../src/views/system/development-map/index.vue',
      '../../src/views/system/development-map/git-graph.vue',
      '../../src/views/system/development-map/git-graph-row.vue',
    ],
    label: '开发图谱',
    virtualImport: 'virtual:qianshu/development-map',
  },
  {
    files: ['../../src/views/system/status/index.vue'],
    label: '系统状态',
    virtualImport: 'virtual:qianshu/build-source',
  },
] as const

for (const contract of pageContracts) {
  test(`${contract.label}沿用 Fantastic Admin 组件与当前主题 token`, () => {
    const source = contract.files.map(file => readPageSource(file)).join('\n')

    assert.doesNotMatch(source, /<A[A-Z][A-Za-z0-9]*\b/u, `${contract.label}不得使用 Arco 业务组件`)
    assert.doesNotMatch(source, /(?:\.arco-|--color-|--warning-)/u, `${contract.label}不得绑定 Arco 内部 class 或主题变量`)
    assert.doesNotMatch(source, /(?:#[\dA-Fa-f]{3,8}\b|rgba?\(\s*[\d.]+|hsla?\(\s*[\d.]+)/u, `${contract.label}不得硬编码颜色值`)
    assert.match(
      source,
      /(?:bg|text|border)-(?:background|foreground|card|muted|primary|secondary|accent|destructive|border)|oklch\(var\(--(?:background|foreground|card|muted|primary|secondary|accent|destructive|border)\)\)/u,
      `${contract.label}的自定义展示结构必须复用当前主题语义 token`,
    )
    assert.match(source, /<FaPageHeader\b/u)
    assert.match(source, /<FaPageMain\b/u)
  })
}

test('三个页面只通过构建期虚拟模块与既有接口取数', () => {
  for (const contract of pageContracts) {
    assert.match(
      readPageSource(contract.files[0]),
      new RegExp(`import \\w+ from '${contract.virtualImport}'`, 'u'),
      `${contract.label}必须静态导入构建期数据模块`,
    )
  }

  const statusSource = readPageSource('../../src/views/system/status/index.vue')
  // 健康检查地址与错误归一化属于 API 模块的职责，页面不得自己拼 URL。
  assert.match(statusSource, /import \{ getHealth \} from '@\/api\/modules\/health'/u)
  assert.doesNotMatch(statusSource, /\/api\/health|'\/health'|"\/health"/u)

  // 降级与本地开发构建必须给出显式提示，不能把本地历史当成已发布版本。
  for (const contract of pageContracts.slice(0, 2)) {
    assert.match(
      readPageSource(contract.files[0]),
      /describeDevelopmentDataSource/u,
      `${contract.label}必须展示数据来源提示`,
    )
  }
})

function releaseGroup(itemCount: number): ReleaseNotesGroup {
  return {
    type: 'feat',
    label: '新功能',
    count: itemCount,
    items: Array.from({ length: itemCount }, (_, index) => ({ sha: `sha${index}`, subject: `提交 ${index}` })),
  }
}

test('版本更新的分类折叠与跳转口径', () => {
  assert.equal(shouldFoldGroup(releaseGroup(6)), false)
  assert.equal(shouldFoldGroup(releaseGroup(7)), true)
  assert.equal(visibleGroupItems(releaseGroup(7), false).length, 6)
  assert.equal(visibleGroupItems(releaseGroup(7), true).length, 7)
  // 未知类型与合并提交都不能冒充主色标签。
  assert.equal(groupToneClass('feat'), 'text-primary')
  assert.equal(groupToneClass('fix'), 'text-destructive')
  assert.equal(groupToneClass('chore'), 'text-muted-foreground')
  assert.deepEqual(graphRouteFor('v0.1.12'), { path: '/system/development-map', query: { version: 'v0.1.12' } })
  assert.deepEqual(graphRouteFor(null), { path: '/system/development-map' })
  assert.equal(releaseCardSubtitle({
    version: '0.1.12',
    tag: 'v0.1.12',
    label: null,
    datetime: '2026-09-29T09:36:03+08:00',
    commit: 'aafa579e',
    commitCount: 143,
    range: { from: 'v0.1.11', to: 'v0.1.12' },
    groups: [],
  }), '2026-09-29 · 提交 143')
})

test('数据来源提示区分正式发版、本地开发与降级构建', () => {
  const releaseSource = {
    available: true,
    mode: 'release' as const,
    reason: null,
    version: '0.1.12',
    tag: 'v0.1.12',
    commit: 'aafa579e',
    shortCommit: 'aafa579e',
    branch: 'main',
    describe: 'v0.1.12',
    dirty: false,
    shallow: false,
    generatedAt: '2026-09-29T00:00:00.000Z',
  }
  assert.equal(describeDevelopmentDataSource(releaseSource), null)

  const developmentNotice = describeDevelopmentDataSource({ ...releaseSource, mode: 'development', tag: null, reason: 'head-not-tagged' })
  assert.equal(developmentNotice?.variant, 'default')
  assert.match(developmentNotice?.description ?? '', /不代表已发布版本/u)

  const unavailableNotice = describeDevelopmentDataSource({ ...releaseSource, available: false, mode: 'unavailable', reason: 'shallow-clone' })
  assert.equal(unavailableNotice?.variant, 'destructive')
  assert.match(unavailableNotice?.description ?? '', /浅克隆/u)
})

function commit(partial: Partial<GitGraphCommit> & { sha: string }): GitGraphCommit {
  return {
    lane: 0,
    lanes: [0],
    subject: 'feat: 示例提交',
    type: 'feat',
    date: '2026-09-29',
    refs: [],
    release: 0,
    ...partial,
  }
}

const graphVersions: GitGraphVersion[] = [
  { version: '0.1.12', tag: 'v0.1.12', datetime: '2026-09-29', commitCount: 2 },
  { version: '0.1.11', tag: 'v0.1.11', datetime: '2026-09-18', commitCount: 1 },
]

const graphCommits: GitGraphCommit[] = [
  commit({ sha: 'aaa11111', release: 0, subject: 'feat: 新增页面', refs: ['v0.1.12'] }),
  commit({ sha: 'bbb22222', lane: 1, lanes: [0], release: 0, type: 'fix', subject: 'fix: 修正计数', date: '2026-09-28' }),
  commit({ sha: 'ccc33333', release: 1, type: 'docs', subject: 'docs: 补充说明', date: '2026-09-18' }),
]

test('线路图按行给出直线与曲线指令，坐标随泳道与最大泳道伸缩', () => {
  const straight = drawGraphRow(graphCommits[0]!, [], 1)
  assert.equal(straight.width, graphColumnWidth(1))
  assert.equal(straight.segments.length, 1)
  assert.match(straight.segments[0]!.path, /^M 8 14 V 28$/u, '主干单行是竖直续线')

  const branched = drawGraphRow(
    commit({ sha: 'ddd44444', lane: 0, lanes: [0, 1], type: 'merge', subject: 'Merge pull request #1' }),
    [0],
    1,
  )
  // 合并行同时出现三类指令：自上而下的续线、通往第一父的直线、通往第二父的曲线。
  assert.deepEqual(branched.segments.map(segment => segment.key), ['top-0', 'down-0', 'curve-1'])
  assert.match(branched.segments[0]!.path, /^M 8 0 V 14$/u, '本提交所在泳道的续线在节点处收口')
  const curve = branched.segments.find(segment => segment.key === 'curve-1')
  assert.ok(curve)
  assert.match(curve.path, /^M 8 14 C 8 21 24 21 24 28$/u, '曲线两端竖直，控制点取行高对称中点')
  assert.equal(branched.nodeColor, laneColor(0))
  assert.equal(laneColor(1), 'oklch(var(--destructive))', '相邻泳道使用可区分的主题语义色')
  assert.notEqual(commitDotColor('feat'), commitDotColor('fix'))
  assert.equal(commitToneClass('merge'), 'text-muted-foreground')
})

test('线路图筛选项与版本、类型、关键字口径一致', () => {
  assert.equal(isGraphFilterActive({ version: null, type: null, keyword: '' }), false)
  assert.equal(isGraphFilterActive({ version: null, type: null, keyword: '  ' }), false)
  assert.equal(isGraphFilterActive({ version: 'v0.1.12', type: null, keyword: '' }), true)

  const all = filterGraphCommits(graphCommits, graphVersions, { version: null, type: null, keyword: '' })
  assert.equal(all.length, 3)

  const byVersion = filterGraphCommits(graphCommits, graphVersions, { version: 'v0.1.12', type: null, keyword: '' })
  assert.deepEqual(byVersion.map(item => item.sha), ['aaa11111', 'bbb22222'])

  const byUnknownVersion = filterGraphCommits(graphCommits, graphVersions, { version: 'v9.9.9', type: null, keyword: '' })
  assert.deepEqual(byUnknownVersion, [], '不存在的版本不能退化成全部提交')

  const byType = filterGraphCommits(graphCommits, graphVersions, { version: null, type: 'fix', keyword: '' })
  assert.deepEqual(byType.map(item => item.sha), ['bbb22222'])

  const byKeyword = filterGraphCommits(graphCommits, graphVersions, { version: null, type: null, keyword: 'CCC' })
  assert.deepEqual(byKeyword.map(item => item.sha), ['ccc33333'], '关键字同时匹配短哈希且忽略大小写')

  // 类型选项按条数倒序、同条数按类型名排序，保证同一份数据每次渲染顺序一致。
  assert.deepEqual(typeFilterOptions(graphCommits), [
    { label: '文档（1）', value: 'docs' },
    { label: '新功能（1）', value: 'feat' },
    { label: '修复（1）', value: 'fix' },
  ])
  assert.deepEqual(typeFilterOptions([...graphCommits, commit({ sha: 'eee55555', type: 'feat' })]).map(option => option.value), ['feat', 'docs', 'fix'])
  assert.deepEqual(versionFilterOptions(graphVersions), [
    { label: 'v0.1.12（2 条）', value: 'v0.1.12' },
    { label: 'v0.1.11（1 条）', value: 'v0.1.11' },
  ])
})

test('健康检查结果把 200/503、指示器与请求编号归一为可展示状态', () => {
  const healthy = buildHealthProbeResult({
    httpStatus: 200,
    body: { status: 'ok', info: { database: { status: 'up' } }, error: {}, details: {} },
    requestId: 'req-1',
    durationMs: 12,
    checkedAt: '2026-10-01T00:00:00.000Z',
  })
  assert.equal(healthy.tone, 'ok')
  assert.equal(healthy.label, '运行正常')
  assert.equal(healthy.databaseLabel, '可用')
  assert.equal(healthy.requestId, 'req-1')

  const degraded = buildHealthProbeResult({
    httpStatus: 503,
    body: { status: 'error', info: {}, error: { database: { status: 'down' } }, details: {} },
    requestId: null,
    durationMs: 800,
    checkedAt: '2026-10-01T00:00:00.000Z',
  })
  assert.equal(degraded.tone, 'down')
  assert.equal(degraded.databaseLabel, '不可用')
  assert.equal(degraded.httpStatus, 503)

  const unreachable = buildHealthProbeResult({
    httpStatus: null,
    body: null,
    requestId: null,
    durationMs: null,
    checkedAt: '2026-10-01T00:00:00.000Z',
    unreachable: true,
  })
  assert.equal(unreachable.tone, 'down')
  assert.equal(unreachable.databaseLabel, '未返回')
  assert.match(unreachable.detail, /无法连接服务端/u)

  assert.equal(toneColor('ok'), 'oklch(var(--primary))')
  assert.equal(toneColor('down'), 'oklch(var(--destructive))')
  assert.equal(toneColor('unknown'), 'oklch(var(--muted-foreground))')
})

test('响应头与归一化错误里的请求编号都能被读出', () => {
  const headers = { get: (name: string) => (name === 'x-request-id' ? 'req-abcdef' : undefined) }
  assert.equal(readRequestId(headers), 'req-abcdef')
  assert.equal(readRequestId({ 'X-Request-Id': 'req-plain' }), 'req-plain')
  assert.equal(readRequestId(undefined), null)

  assert.equal(readFailureRequestId({ kind: 'http-unparseable', status: 500, requestId: 'req-1' }), 'req-1')
  assert.equal(readFailureRequestId({ kind: 'http', status: 403, body: { code: 'FORBIDDEN', requestId: 'req-2' } }), 'req-2')
  assert.equal(readFailureRequestId({ kind: 'network' }), null)
  assert.match(formatStatusMoment('2026-10-01T00:00:00.000Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u)
})

test('身份与浏览器环境如实标注未提供项', () => {
  const entries = describeIdentity({
    user: { id: 'u1', username: 'silno', displayName: 'SilnoGM', mustChangePassword: false },
    permissions: ['audit:read', 'regions:read'],
    session: {
      createdAt: '2026-10-01T00:00:00.000Z',
      lastActivityAt: '2026-10-01T01:00:00.000Z',
      idleExpiresAt: '2026-10-01T02:00:00.000Z',
      absoluteExpiresAt: '2026-10-08T00:00:00.000Z',
    },
  })
  assert.equal(entries.find(entry => entry.label === '权限条数')?.value, '2 条')
  const roleEntry = entries.find(entry => entry.label === '角色')
  assert.equal(roleEntry?.value, '未提供')
  assert.match(roleEntry?.hint ?? '', /users:read/u, '未提供项必须说明原因，不能只留空白')
  assert.equal(describeIdentity(null)[0]?.value, '未获取')

  const browser = describeBrowserEnvironment({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    language: 'zh-CN',
    timezone: 'Asia/Shanghai',
    viewportWidth: 1440,
    viewportHeight: 900,
    devicePixelRatio: 2,
    online: true,
    storageAvailable: true,
  })
  const browserEntry = browser.find(entry => entry.label === '浏览器')?.value ?? ''
  assert.match(browserEntry, /Chrome/u)
  assert.equal(browser.find(entry => entry.label === '视口')?.value, '1440 × 900')
  assert.equal(browser.find(entry => entry.label === '本地存储')?.value, '可用')
})

test('前端构建卡片对外声明数据锚点与构建来源', () => {
  const entries = describeFrontendBuild({
    productVersion: '0.1.12',
    buildTime: '2026-10-01 12:00:00',
    buildMode: 'production',
    source: { available: true, tag: 'v0.1.12', shortCommit: 'aafa579e', mode: 'release' },
  })
  assert.equal(entries.find(entry => entry.label === '产品版本')?.value, '0.1.12')
  assert.equal(entries.find(entry => entry.label === '数据锚点')?.value, 'v0.1.12 · aafa579e')
  assert.equal(entries.find(entry => entry.label === '数据来源')?.value, '正式发版构建')

  const degraded = describeFrontendBuild({
    productVersion: '0.1.12',
    buildTime: '2026-10-01 12:00:00',
    buildMode: 'production',
    source: { available: false, tag: null, shortCommit: null, mode: 'unavailable' },
  })
  assert.equal(degraded.find(entry => entry.label === '数据锚点')?.value, '构建环境未提供 Git 历史')
  assert.equal(degraded.find(entry => entry.label === '数据来源')?.value, '不可用')
})
