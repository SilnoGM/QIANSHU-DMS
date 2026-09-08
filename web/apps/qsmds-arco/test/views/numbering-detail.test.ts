import type {
  NumberingIssuanceDto,
  NumberingRuleDetailDto,
  NumberingRuleVersionDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 详情展示与权限门禁使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildNumberingIssuanceLoadQuery,
  buildNumberingLifecyclePresentation,
  buildNumberingVersionLoadQuery,
  canLoadNumberingIssuances,
  describeNumberingVersion,
  hasNumberingDetailFooterActions,
  resolveNumberingDetailActions,
  resolveNumberingDetailTabs,
} from '../../src/views/system/basic-data/numbering/numbering-detail.logic'

const ACTIVE_VERSION: NumberingRuleVersionDto = {
  id: 'version-active',
  revision: 8,
  status: 'ACTIVE',
  config: {
    resetPolicy: 'DAILY',
    timezone: 'Asia/Shanghai',
    maxOutputLength: 32,
    segments: [
      { type: 'FIXED', value: 'SO' },
      { type: 'DATE', format: 'YYYYMMDD' },
      { type: 'SEPARATOR', value: '-' },
      {
        type: 'SEQUENCE',
        width: 18,
        startValue: '9007199254740993',
        step: '2',
      },
    ],
  },
  capacity: '900719925474099312345678901234567890',
  createdAt: '2026-08-01T00:00:00.000Z',
  publishedAt: '2026-08-01T01:00:00.000Z',
}

const DRAFT_VERSION: NumberingRuleVersionDto = {
  ...ACTIVE_VERSION,
  id: 'version-draft',
  revision: 9,
  status: 'DRAFT',
  publishedAt: null,
}

const DETAIL: NumberingRuleDetailDto = {
  id: 'rule-id',
  ruleCode: 'SALES_ORDER',
  name: '销售订单',
  description: '销售业务使用',
  status: 'ENABLED',
  version: 12,
  activeVersion: ACTIVE_VERSION,
  draftVersion: DRAFT_VERSION,
  statistics: {
    statisticsSource: 'ACTIVE',
    periodKey: '20260802',
    capacity: ACTIVE_VERSION.capacity,
    usedCount: '900719925474099312345678',
    remainingCount: '900719924573379386871579589',
    lifetimeUsedCount: '900719925474099312345679',
    nextSequenceValue: '900719925474099312345680',
    nextNumberPreview: 'SO20260802-900719925474099312345680',
    nextNumberDeterministic: true,
    periodStatus: 'AVAILABLE',
    asOf: '2026-08-02T00:00:00.000Z',
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
}

const ALL_PERMISSIONS = {
  canCreate: true,
  canDisable: true,
  canEnable: true,
  canPublish: true,
  canRead: true,
  canReadIssuances: true,
  canUpdate: true,
}

function readSource(fileName: string): string {
  return readFileSync(new URL(
    `../../src/views/system/basic-data/numbering/${fileName}`,
    import.meta.url,
  ), 'utf8')
}

test('详情 tabs 只在 read 与 read-issuances 同时存在时开放发号记录', () => {
  assert.deepEqual(
    resolveNumberingDetailTabs(ALL_PERMISSIONS).map(tab => tab.value),
    ['overview', 'versions', 'issuances'],
  )
  assert.deepEqual(
    resolveNumberingDetailTabs({
      ...ALL_PERMISSIONS,
      canReadIssuances: false,
    }).map(tab => tab.value),
    ['overview', 'versions'],
  )
  assert.deepEqual(
    resolveNumberingDetailTabs({ ...ALL_PERMISSIONS, canRead: false }),
    [],
  )
  assert.equal(canLoadNumberingIssuances(ALL_PERMISSIONS), true)
  assert.equal(canLoadNumberingIssuances({
    ...ALL_PERMISSIONS,
    canRead: false,
  }), false)
})

test('详情动作以权限和当前生命周期共同约束克隆、发布与启停', () => {
  assert.deepEqual(resolveNumberingDetailActions(DETAIL, ALL_PERMISSIONS), {
    canClone: true,
    canDisable: true,
    canEdit: true,
    canEnable: false,
    canPublish: true,
    canReadIssuances: true,
    hasAny: true,
  })
  assert.equal(resolveNumberingDetailActions(DETAIL, {
    ...ALL_PERMISSIONS,
    canRead: false,
  }).canClone, false)
  assert.equal(resolveNumberingDetailActions(DETAIL, {
    ...ALL_PERMISSIONS,
    canCreate: false,
  }).canClone, false)
  assert.equal(resolveNumberingDetailActions({
    ...DETAIL,
    status: 'DISABLED',
  }, ALL_PERMISSIONS).canEnable, true)

  const issuanceOnly = resolveNumberingDetailActions(DETAIL, {
    ...ALL_PERMISSIONS,
    canCreate: false,
    canDisable: false,
    canEnable: false,
    canPublish: false,
    canUpdate: false,
  })
  assert.equal(issuanceOnly.canReadIssuances, true)
  assert.equal(issuanceOnly.hasAny, true)
  assert.equal(hasNumberingDetailFooterActions(issuanceOnly), false)
})

test('生命周期确认文案明确名称、code、目标 revision 与操作影响', () => {
  const publish = buildNumberingLifecyclePresentation('publish', DETAIL)
  assert.deepEqual(publish, {
    action: 'publish',
    title: '确认发布编号规则',
    confirmLabel: '确认发布',
    icon: 'i-lucide:upload-cloud',
    name: '销售订单',
    ruleCode: 'SALES_ORDER',
    revision: 9,
    revisionLabel: '草稿 revision',
    impact: '发布后 revision 9 成为新的生效版本；历史版本和已发出的编号保持不变。',
    canConfirm: true,
    destructive: false,
  })

  const enable = buildNumberingLifecyclePresentation('enable', DETAIL)
  assert.equal(enable.title, '确认启用编号规则')
  assert.equal(enable.revision, 8)
  assert.equal(enable.revisionLabel, '生效 revision')
  assert.match(enable.impact, /允许后续业务域调用/u)

  const disable = buildNumberingLifecyclePresentation('disable', DETAIL)
  assert.equal(disable.title, '确认停用编号规则')
  assert.equal(disable.revision, 8)
  assert.equal(disable.destructive, true)
  assert.match(disable.impact, /停止新的编号生成/u)
  assert.match(disable.impact, /幂等重放/u)
})

test('版本与发号查询分页受控，缺少发号权限时返回 null 而非请求参数', () => {
  assert.deepEqual(buildNumberingVersionLoadQuery({ page: 2, pageSize: 50 }), {
    page: 2,
    pageSize: 50,
  })
  assert.deepEqual(buildNumberingVersionLoadQuery({ page: 0, pageSize: 101 }), {
    page: 1,
    pageSize: 20,
  })

  const queryInput = {
    filters: {
      consumerCode: ' order.create ',
      generatedNumber: ' so-2026 ',
      generatedNumberMatch: 'PREFIX' as const,
      periodKey: ' 20260802 ',
    },
    page: 3,
    pageSize: 50,
  }
  assert.deepEqual(
    buildNumberingIssuanceLoadQuery(queryInput, ALL_PERMISSIONS),
    {
      consumerCode: 'ORDER.CREATE',
      generatedNumber: 'SO-2026',
      generatedNumberMatch: 'PREFIX',
      page: 3,
      pageSize: 50,
      periodKey: '20260802',
    },
  )
  assert.equal(buildNumberingIssuanceLoadQuery(queryInput, {
    ...ALL_PERMISSIONS,
    canReadIssuances: false,
  }), null)
})

test('版本摘要对容量和 sequence decimal string 保持超安全整数精度', () => {
  assert.deepEqual(describeNumberingVersion(ACTIVE_VERSION), {
    capacity: '900,719,925,474,099,312,345,678,901,234,567,890',
    resetPolicy: '每日重置',
    structure: 'SO{YYYYMMDD}-{SEQ:18,start=9007199254740993,step=2}',
    timezone: 'Asia/Shanghai',
  })

  const issuance: NumberingIssuanceDto = {
    id: 'issuance-id',
    ruleRevision: 8,
    periodKey: '20260802',
    generatedNumber: 'SO20260802-900719925474099312345680',
    sequenceValue: '900719925474099312345680',
    consumerCode: 'ORDER.CREATE',
    issuedAt: '2026-08-02T02:00:00.000Z',
  }
  assert.equal(issuance.sequenceValue, '900719925474099312345680')
})

test('详情组件使用单一 Drawer tabs、受控数据和安全错误展示位', () => {
  const source = readSource('numbering-rule-detail-drawer.vue')

  assert.equal(source.match(/<QsGenericDrawer\b/gu)?.length, 1)
  assert.equal(source.match(/<FaTabs\b/gu)?.length, 1)
  assert.doesNotMatch(source, /<QsGenericDrawer\b[\s\S]*<QsGenericDrawer\b/u)
  for (const prop of [
    'detail',
    'detailLoading',
    'detailError',
    'versions',
    'versionsPage',
    'versionsPageSize',
    'versionsTotal',
    'issuances',
    'issuancesPage',
    'issuancesPageSize',
    'issuancesTotal',
    'issuanceFilters',
    'permissions',
  ]) {
    assert.match(source, new RegExp(`\\b${prop}\\??:`, 'u'))
  }
  assert.match(source, /resolveNumberingDetailTabs/u)
  assert.match(source, /canLoadNumberingIssuances/u)
  assert.match(source, /hasNumberingDetailFooterActions/u)
  assert.doesNotMatch(source, /actions\.value\.hasAny|actions\.hasAny/u)
  assert.match(source, /emit\('reloadDetail'/u)
  assert.match(source, /emit\('loadVersions'/u)
  assert.match(source, /emit\('loadIssuances'/u)
  assert.match(source, /emit\('action'/u)
  assert.match(source, /role="alert"/u)
  assert.match(source, /requestId/u)
  assert.doesNotMatch(source, /from ['"]@\/api\/modules\/numbering['"]/u)
  assert.doesNotMatch(source, /\.rules\.(?:get|versions|issuances|publish|enable|disable)/u)
})

test('详情分页使用 FaPagination sizeChange 并在页容量变化后从第一页查询', () => {
  const source = readSource('numbering-rule-detail-drawer.vue')

  assert.equal(source.match(/<FaPagination\b/gu)?.length, 2)
  assert.equal(source.match(/@size-change=/gu)?.length, 2)
  assert.match(source, /layout="pager, sizes"/u)
  assert.match(
    source,
    /function handleVersionPageSizeChange\(pageSize: number\): void \{\s*emitVersions\(1, pageSize\)\s*\}/u,
  )
  assert.match(
    source,
    /function handleIssuancePageSizeChange\(pageSize: number\): void \{\s*emitIssuances\(1, pageSize, props\.issuanceFilters\)\s*\}/u,
  )
  assert.match(source, /@size-change="handleVersionPageSizeChange"/u)
  assert.match(source, /@size-change="handleIssuancePageSizeChange"/u)
})

test('权限撤销隐藏敏感 tab、阻断发号请求且只读发号权限不产生空 footer', () => {
  const source = readSource('numbering-rule-detail-drawer.vue')

  assert.match(
    source,
    /if \(props\.detail === null \|\| !canLoadNumberingIssuances\(props\.permissions\)\) \{\s*return\s*\}/u,
  )
  assert.match(
    source,
    /watch\(tabs,[\s\S]*!availableTabs\.some\(tab => tab\.value === activeTab\.value\)[\s\S]*activeTab\.value = 'overview'/u,
  )
  assert.match(source, /detail !== null && hasFooterActions/u)
})

test('详情版本和发号记录移动端可换行且始终不提供正式发号按钮', () => {
  const source = readSource('numbering-rule-detail-drawer.vue')

  assert.match(source, /max-\[390px\]:grid-cols-1/u)
  assert.match(source, /\[overflow-wrap:anywhere\]/u)
  assert.match(source, /time-zone="Asia\/Shanghai"/u)
  assert.match(source, /generatedNumber/u)
  assert.match(source, /consumerCode/u)
  assert.match(source, /ruleRevision/u)
  assert.match(source, /periodKey/u)
  assert.match(source, /issuedAt/u)
  assert.doesNotMatch(source, /(?:hash|idempotencyKey)/iu)
  assert.doesNotMatch(source, /<FaButton[^>]*>[\s\S]{0,100}(?:正式发号|生成编号)[\s\S]{0,30}<\/FaButton>/u)
  assert.doesNotMatch(source, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
})

test('生命周期组件复用 QsGenericModal 并为三类动作展示业务错误', () => {
  const source = readSource('numbering-lifecycle-modal.vue')

  assert.equal(source.match(/<QsGenericModal\b/gu)?.length, 1)
  assert.match(source, /NumberingLifecycleAction/u)
  assert.match(source, /buildNumberingLifecyclePresentation/u)
  assert.match(source, /presentation\.name/u)
  assert.match(source, /presentation\.ruleCode/u)
  assert.match(source, /presentation\.revision/u)
  assert.match(source, /presentation\.impact/u)
  assert.match(source, /errorMessage/u)
  assert.match(source, /requestId/u)
  assert.match(source, /role="alert"/u)
  assert.match(source, /emit\('confirm', props\.action\)/u)
  assert.doesNotMatch(source, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
})
