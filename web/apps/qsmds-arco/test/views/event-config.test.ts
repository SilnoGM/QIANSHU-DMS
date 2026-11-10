import type {
  NotificationChannelPolicyDto,
  NotificationEventDto,
  NotificationTemplateDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 事件覆盖逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildEventCoverage,
  buildEventTableGroups,
  buildTemplateUsageCounts,
  filterEventCoverage,
  groupEventCoverageByDomain,
  resolveChannelTemplate,
  summarizeEventCoverage,
  templateIncompatibleVariables,
  templateUsageCount,
} from '../../src/views/system/notifications/event-config.logic'

const purchaseEvent: NotificationEventDto = {
  eventType: 'PURCHASE_REVIEW_PENDING',
  label: '采购审核',
  domain: 'PURCHASE',
  variables: ['orderNo', 'customerName'],
  variablesKnown: true,
  defaultTemplateKey: 'purchase.review.pending',
  implemented: true,
}

const shipmentEvent: NotificationEventDto = {
  eventType: 'SHIPMENT_ARRIVED',
  label: '货件到仓',
  domain: 'SHIPMENT',
  variables: ['orderNo', 'partNumbers'],
  variablesKnown: true,
  defaultTemplateKey: 'shipment.arrived',
  implemented: true,
}

const withdrawalEvent: NotificationEventDto = {
  eventType: 'FUND_WITHDRAWAL_REVIEW_PENDING',
  label: '提现审核',
  domain: 'FINANCE',
  variables: [],
  variablesKnown: false,
  defaultTemplateKey: null,
  implemented: false,
}

function policy(overrides: Partial<NotificationChannelPolicyDto> & Pick<NotificationChannelPolicyDto, 'channel' | 'eventType'>): NotificationChannelPolicyDto {
  return {
    id: `${overrides.eventType}-${overrides.channel}`,
    eventType: overrides.eventType,
    channel: overrides.channel,
    targetMode: 'COMMAND_TARGET',
    targetConfig: {},
    templateKey: null,
    priority: 'NORMAL',
    ttlSeconds: overrides.channel === 'ASSISTANT' ? 86_400 : null,
    quietHours: null,
    allowSensitive: true,
    enabled: true,
    version: 1,
    updatedAt: '2026-11-10T08:00:00.000Z',
    updatedByName: '张三',
    ...overrides,
  }
}

function template(overrides: Partial<NotificationTemplateDto> & Pick<NotificationTemplateDto, 'channel' | 'key'>): NotificationTemplateDto {
  return {
    id: `${overrides.key}-${overrides.channel}`,
    key: overrides.key,
    channel: overrides.channel,
    name: overrides.key,
    domain: 'PURCHASE',
    titleTemplate: null,
    bodyTemplate: '正文',
    linkUrlTemplate: null,
    variables: [],
    maxLength: 2000,
    enabled: true,
    version: 1,
    updatedAt: '2026-11-10T08:00:00.000Z',
    updatedByName: '张三',
    ...overrides,
  }
}

test('策略绑定的模板优先于业务默认键', () => {
  const effective = resolveChannelTemplate(
    purchaseEvent,
    'ASSISTANT',
    policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT', templateKey: 'purchase.review.pending.short' }),
    [
      template({ channel: 'ASSISTANT', key: 'purchase.review.pending.short', name: '采购审核简版' }),
      template({ channel: 'ASSISTANT', key: 'purchase.review.pending', name: '采购审核默认' }),
    ],
  )

  assert.equal(effective.key, 'purchase.review.pending.short')
  assert.equal(effective.source, 'POLICY')
  assert.equal(effective.template?.name, '采购审核简版')
  assert.equal(effective.state, 'READY')
})

test('策略未绑定模板时回退默认键，默认模板缺失标记缺模板', () => {
  const effective = resolveChannelTemplate(
    purchaseEvent,
    'IN_APP',
    policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' }),
    [],
  )

  assert.equal(effective.key, 'purchase.review.pending')
  assert.equal(effective.source, 'DEFAULT')
  assert.equal(effective.template, null)
  assert.equal(effective.state, 'MISSING_TEMPLATE')
  assert.equal(effective.missingReason, 'TEMPLATE_NOT_FOUND')
})

test('策略绑定键与业务默认键相同时按默认处理', () => {
  const effective = resolveChannelTemplate(
    purchaseEvent,
    'IN_APP',
    policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP', templateKey: 'purchase.review.pending' }),
    [template({ channel: 'IN_APP', key: 'purchase.review.pending' })],
  )

  assert.equal(effective.source, 'DEFAULT')
  assert.equal(effective.state, 'READY')
})

test('没有策略时为未配置，模板状态不参与判定', () => {
  const effective = resolveChannelTemplate(
    purchaseEvent,
    'ASSISTANT',
    null,
    [template({ channel: 'ASSISTANT', key: 'purchase.review.pending' })],
  )

  assert.equal(effective.state, 'UNCONFIGURED')
  assert.equal(effective.source, 'DEFAULT')
})

test('策略停用和模板停用分别给出明确状态', () => {
  const disabledPolicy = resolveChannelTemplate(
    purchaseEvent,
    'ASSISTANT',
    policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT', enabled: false }),
    [template({ channel: 'ASSISTANT', key: 'purchase.review.pending' })],
  )
  assert.equal(disabledPolicy.state, 'DISABLED')

  const disabledTemplate = resolveChannelTemplate(
    purchaseEvent,
    'ASSISTANT',
    policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' }),
    [template({ channel: 'ASSISTANT', key: 'purchase.review.pending', enabled: false })],
  )
  assert.equal(disabledTemplate.state, 'MISSING_TEMPLATE')
  assert.equal(disabledTemplate.missingReason, 'TEMPLATE_DISABLED')
})

test('没有模板查看权限时状态为未知，不误判缺模板', () => {
  const effective = resolveChannelTemplate(
    purchaseEvent,
    'ASSISTANT',
    policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' }),
    null,
  )

  assert.equal(effective.state, 'UNKNOWN')
  assert.equal(effective.template, null)
})

test('事件覆盖态按缺模板、未配置、部分配置、已停用区分', () => {
  const templates = [
    template({ channel: 'ASSISTANT', key: 'purchase.review.pending' }),
    template({ channel: 'IN_APP', key: 'purchase.review.pending' }),
  ]
  const bothReady = buildEventCoverage(
    [purchaseEvent],
    [
      policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' }),
      policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' }),
    ],
    templates,
  )
  assert.equal(bothReady[0]?.state, 'READY')

  const unconfigured = buildEventCoverage([purchaseEvent], [], templates)
  assert.equal(unconfigured[0]?.state, 'UNCONFIGURED')

  const partial = buildEventCoverage(
    [purchaseEvent],
    [policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' })],
    templates,
  )
  assert.equal(partial[0]?.state, 'PARTIAL')

  const missing = buildEventCoverage(
    [purchaseEvent],
    [
      policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' }),
      policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' }),
    ],
    [templates[0]!],
  )
  assert.equal(missing[0]?.state, 'MISSING_TEMPLATE')

  const disabled = buildEventCoverage(
    [purchaseEvent],
    [policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT', enabled: false })],
    templates,
  )
  assert.equal(disabled[0]?.state, 'DISABLED')
})

test('汇总统计只按事件计数', () => {
  const coverage = buildEventCoverage(
    [purchaseEvent, shipmentEvent, withdrawalEvent],
    [
      policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' }),
      policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' }),
    ],
    [
      template({ channel: 'ASSISTANT', key: 'purchase.review.pending' }),
      template({ channel: 'IN_APP', key: 'purchase.review.pending' }),
    ],
  )
  const summary = summarizeEventCoverage(coverage)
  assert.deepEqual(summary, {
    total: 3,
    ready: 1,
    partial: 0,
    missingTemplate: 0,
    unconfigured: 1,
    unimplemented: 1,
    disabled: 0,
    unknown: 0,
  })
})

test('模板占位符超出事件变量时给出不兼容清单，未知契约不拦截', () => {
  const incompatible = template({
    channel: 'ASSISTANT',
    key: 'purchase.review.pending',
    titleTemplate: '采购单 {{orderNo}}',
    bodyTemplate: '货件 {{partNumbers}} 客户 {{customerName}}',
    linkUrlTemplate: '/orders/{{orderId}}',
  })
  assert.deepEqual(templateIncompatibleVariables(incompatible, purchaseEvent), ['orderId', 'partNumbers'])
  assert.deepEqual(templateIncompatibleVariables(incompatible, withdrawalEvent), [])
})

test('模板使用数按事件去重，默认键和策略绑定都计入', () => {
  const usage = buildTemplateUsageCounts(
    [purchaseEvent, shipmentEvent],
    [
      policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' }),
      policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'IN_APP' }),
      policy({ eventType: 'SHIPMENT_ARRIVED', channel: 'ASSISTANT', templateKey: 'purchase.review.pending' }),
    ],
  )

  assert.equal(templateUsageCount(usage, 'purchase.review.pending'), 2)
  assert.equal(templateUsageCount(usage, 'shipment.arrived'), 1)
  assert.equal(templateUsageCount(usage, 'unknown.key'), 0)
})

test('事件按模板域分组并支持关键词与未配齐过滤', () => {
  const coverage = buildEventCoverage(
    [purchaseEvent, shipmentEvent, withdrawalEvent],
    [policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' })],
    [template({ channel: 'ASSISTANT', key: 'purchase.review.pending' })],
  )
  assert.deepEqual(groupEventCoverageByDomain(coverage).map(group => group.label), ['采购域', '货件运输域', '财务域'])
  assert.deepEqual(filterEventCoverage(coverage, '货件', false).map(item => item.event.label), ['货件到仓'])
  assert.deepEqual(filterEventCoverage(coverage, '', true).map(item => item.event.label), ['采购审核', '货件到仓'])
})

test('分组表格按业务域输出父组与事件子行，并保留最近策略更新', () => {
  const coverage = buildEventCoverage(
    [purchaseEvent, shipmentEvent, withdrawalEvent],
    [
      policy({
        eventType: 'PURCHASE_REVIEW_PENDING',
        channel: 'ASSISTANT',
        updatedAt: '2026-11-08T08:00:00.000Z',
        updatedByName: '张三',
      }),
      policy({
        eventType: 'PURCHASE_REVIEW_PENDING',
        channel: 'IN_APP',
        updatedAt: '2026-11-09T08:00:00.000Z',
        updatedByName: '李四',
      }),
    ],
    [],
  )
  const groups = buildEventTableGroups(coverage, [
    policy({
      eventType: 'PURCHASE_REVIEW_PENDING',
      channel: 'ASSISTANT',
      updatedAt: '2026-11-08T08:00:00.000Z',
      updatedByName: '张三',
    }),
    policy({
      eventType: 'PURCHASE_REVIEW_PENDING',
      channel: 'IN_APP',
      updatedAt: '2026-11-09T08:00:00.000Z',
      updatedByName: '李四',
    }),
  ])

  assert.deepEqual(groups.map(group => group.label), ['采购域', '货件运输域', '财务域'])
  assert.equal(groups[0]?.id, 'domain:PURCHASE')
  assert.deepEqual(groups[0]?.children.map(row => row.id), ['event:PURCHASE_REVIEW_PENDING'])
  assert.equal(groups[0]?.children[0]?.updatedAt, '2026-11-09T08:00:00.000Z')
  assert.equal(groups[0]?.children[0]?.updatedByName, '李四')
  assert.equal(groups[1]?.children[0]?.updatedAt, null)
})

test('分组表格支持状态、未接入与关键词过滤，空组会被移除', () => {
  const coverage = buildEventCoverage(
    [purchaseEvent, shipmentEvent, withdrawalEvent],
    [policy({ eventType: 'PURCHASE_REVIEW_PENDING', channel: 'ASSISTANT' })],
    [template({ channel: 'ASSISTANT', key: 'purchase.review.pending' })],
  )

  assert.deepEqual(
    buildEventTableGroups(coverage, [], { filter: 'UNIMPLEMENTED' }).flatMap(group => group.children.map(row => row.label)),
    ['提现审核'],
  )
  assert.deepEqual(
    buildEventTableGroups(coverage, [], { filter: 'UNCONFIGURED' }).flatMap(group => group.children.map(row => row.label)),
    ['货件到仓'],
  )
  assert.deepEqual(
    buildEventTableGroups(coverage, [], { keyword: '货件' }).map(group => group.label),
    ['货件运输域'],
  )
  assert.deepEqual(
    buildEventTableGroups(coverage, [], { keyword: '不存在' }),
    [],
  )
})
