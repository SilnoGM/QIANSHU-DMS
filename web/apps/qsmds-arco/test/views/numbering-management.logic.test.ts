import type {
  NumberingRuleDetailDto,
  NumberingRuleListItemDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 编号页面纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  addNumberingSegment,
  buildChangeNumberingRuleStatusRequest,
  buildCloneNumberingRuleRequest,
  buildCreateNumberingRuleRequest,
  buildNumberingIssuanceQuery,
  buildNumberingRuleListQuery,
  buildPreviewNumberingRuleRequest,
  buildPublishNumberingRuleRequest,
  buildUpdateNumberingRuleRequest,
  createNumberingRuleFormModel,
  formatNumberingDecimal,
  getNumberingMutationFailure,
  moveNumberingSegment,
  numberingPeriodStatusLabel,
  numberingRuleStatusLabel,
  numberingVersionStatusLabel,
  removeNumberingSegment,
  resolveNumberingRuleActions,
  validateNumberingRuleForm,
} from '../../src/views/system/basic-data/numbering/numbering-management.logic'

const ACTIVE_VERSION = {
  id: 'version-active',
  revision: 2,
  status: 'ACTIVE' as const,
  config: {
    resetPolicy: 'NEVER' as const,
    timezone: 'Asia/Shanghai' as const,
    maxOutputLength: 8,
    segments: [
      { type: 'FIXED' as const, value: 'SO' },
      {
        type: 'SEQUENCE' as const,
        width: 6,
        startValue: '1',
        step: '1',
      },
    ],
  },
  capacity: '999999',
  createdAt: '2026-08-01T00:00:00.000Z',
  publishedAt: '2026-08-01T01:00:00.000Z',
}

const DRAFT_VERSION = {
  ...ACTIVE_VERSION,
  id: 'version-draft',
  revision: 3,
  status: 'DRAFT' as const,
  publishedAt: null,
}

const DETAIL: NumberingRuleDetailDto = {
  id: 'rule-id',
  ruleCode: 'SALES_ORDER',
  name: '销售订单',
  description: '销售业务使用',
  status: 'ENABLED',
  version: 7,
  activeVersion: ACTIVE_VERSION,
  draftVersion: DRAFT_VERSION,
  statistics: {
    statisticsSource: 'ACTIVE',
    periodKey: 'ALL',
    capacity: '999999999999999999',
    usedCount: '9007199254740993',
    remainingCount: '990992800745259006',
    lifetimeUsedCount: '9007199254740993',
    nextSequenceValue: '9007199254740994',
    nextNumberPreview: 'SO9007199254740994',
    nextNumberDeterministic: true,
    periodStatus: 'AVAILABLE',
    asOf: '2026-08-02T00:00:00.000Z',
  },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',
}

const LIST_ITEM: NumberingRuleListItemDto = {
  id: DETAIL.id,
  ruleCode: DETAIL.ruleCode,
  name: DETAIL.name,
  description: DETAIL.description,
  status: DETAIL.status,
  version: DETAIL.version,
  activeRevision: 2,
  draftRevision: 3,
  displayVersion: DRAFT_VERSION,
  statistics: DETAIL.statistics,
  createdAt: DETAIL.createdAt,
  updatedAt: DETAIL.updatedAt,
}

test('列表与发号查询规范化分页、文本、状态和 exact/prefix 白名单', () => {
  assert.deepEqual(buildNumberingRuleListQuery({
    page: 2,
    pageSize: 50,
    keyword: '  销售　 订单  ',
    status: 'ENABLED',
    sortOrder: 'asc',
  }), {
    page: 2,
    pageSize: 50,
    keyword: '销售 订单',
    status: 'ENABLED',
    sortBy: 'updatedAt',
    sortOrder: 'asc',
  })
  assert.deepEqual(buildNumberingRuleListQuery({
    page: 0,
    pageSize: 101,
    keyword: '   ',
    status: 'UNKNOWN',
    sortOrder: 'sideways',
  }), {
    page: 1,
    pageSize: 20,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  })
  assert.deepEqual(buildNumberingIssuanceQuery({
    page: 1,
    pageSize: 100,
    periodKey: ' all ',
    consumerCode: ' order.create ',
    generatedNumber: ' so-0001 ',
    generatedNumberMatch: 'PREFIX',
  }), {
    page: 1,
    pageSize: 100,
    periodKey: 'ALL',
    consumerCode: 'ORDER.CREATE',
    generatedNumber: 'SO-0001',
    generatedNumberMatch: 'PREFIX',
  })
})

test('生命周期、版本和周期耗尽保持互不覆盖的中文文本', () => {
  assert.equal(numberingRuleStatusLabel('DRAFT'), '草稿')
  assert.equal(numberingRuleStatusLabel('ENABLED'), '已启用')
  assert.equal(numberingRuleStatusLabel('DISABLED'), '已停用')
  assert.equal(numberingVersionStatusLabel('DRAFT'), '待发布')
  assert.equal(numberingVersionStatusLabel('ACTIVE'), '生效中')
  assert.equal(numberingVersionStatusLabel('RETIRED'), '已归档')
  assert.equal(numberingPeriodStatusLabel('AVAILABLE'), '本周期可用')
  assert.equal(numberingPeriodStatusLabel('EXHAUSTED'), '本周期已耗尽')
  assert.equal(numberingRuleStatusLabel('ENABLED'), '已启用')
})

test('权限和状态共同决定编辑、发布、启停、克隆及发号记录入口', () => {
  const allPermissions = {
    canCreate: true,
    canDisable: true,
    canEnable: true,
    canPublish: true,
    canRead: true,
    canReadIssuances: true,
    canUpdate: true,
  }

  assert.deepEqual(resolveNumberingRuleActions(LIST_ITEM, allPermissions), {
    canClone: true,
    canDisable: true,
    canEdit: true,
    canEnable: false,
    canPublish: true,
    canReadIssuances: true,
    hasAny: true,
  })
  assert.deepEqual(resolveNumberingRuleActions({
    ...LIST_ITEM,
    status: 'DISABLED',
    draftRevision: null,
  }, allPermissions), {
    canClone: true,
    canDisable: false,
    canEdit: true,
    canEnable: true,
    canPublish: false,
    canReadIssuances: true,
    hasAny: true,
  })
  assert.deepEqual(resolveNumberingRuleActions({
    ...LIST_ITEM,
    status: 'DRAFT',
    activeRevision: null,
  }, {
    ...allPermissions,
    canCreate: false,
    canReadIssuances: false,
  }), {
    canClone: false,
    canDisable: false,
    canEdit: true,
    canEnable: false,
    canPublish: true,
    canReadIssuances: false,
    hasAny: true,
  })
})

test('片段添加、删除、上移和下移不修改输入并保持稳定顺序', () => {
  const fixed = { type: 'FIXED' as const, value: 'SO' }
  const date = { type: 'DATE' as const, format: 'YYYYMMDD' as const }
  const sequence = {
    type: 'SEQUENCE' as const,
    width: 6,
    startValue: '1',
    step: '1',
  }
  const source = [fixed, date]
  const added = addNumberingSegment(source, sequence)
  const movedUp = moveNumberingSegment(added, 2, 'up')
  const movedDown = moveNumberingSegment(movedUp, 1, 'down')
  const removed = removeNumberingSegment(movedDown, 1)

  assert.deepEqual(source, [fixed, date])
  assert.deepEqual(added.map(segment => segment.type), [
    'FIXED',
    'DATE',
    'SEQUENCE',
  ])
  assert.deepEqual(movedUp.map(segment => segment.type), [
    'FIXED',
    'SEQUENCE',
    'DATE',
  ])
  assert.deepEqual(movedDown.map(segment => segment.type), [
    'FIXED',
    'DATE',
    'SEQUENCE',
  ])
  assert.deepEqual(removed.map(segment => segment.type), [
    'FIXED',
    'SEQUENCE',
  ])
  assert.equal(movedUp[0], fixed)
  assert.equal(movedUp[1], sequence)
})

test('本地快速校验覆盖身份、片段形状、容量来源和大整数边界', () => {
  const model = createNumberingRuleFormModel(null)
  Object.assign(model, {
    ruleCode: 'sales_order',
    name: '  销售订单  ',
    description: '  销售业务  ',
    resetPolicy: 'NEVER',
    segments: [{
      type: 'SEQUENCE',
      width: 18,
      startValue: '9007199254740993',
      step: '2',
    }],
  })

  assert.deepEqual(validateNumberingRuleForm(model), {})
  model.segments = [
    { type: 'FIXED', value: 'bad-value' },
    { type: 'SEQUENCE', width: 2, startValue: '100', step: '0' },
    { type: 'SEQUENCE', width: 2, startValue: '1', step: '1' },
  ]
  const errors = validateNumberingRuleForm(model)
  assert.equal(typeof errors['segments[0].value'], 'string')
  assert.equal(typeof errors['segments[1].startValue'], 'string')
  assert.equal(typeof errors['segments[1].step'], 'string')
  assert.equal(errors.segments, '最多只能添加一个自增数字片段')
})

test('请求构造保持 decimal string、携带 expectedVersion 且没有可编辑 timezone', () => {
  const model = createNumberingRuleFormModel(DETAIL)
  model.name = '  销售订单号  '
  model.description = ' '
  model.segments = [{
    type: 'SEQUENCE',
    width: 18,
    startValue: '9007199254740993',
    step: '2',
  }]

  assert.deepEqual(buildCreateNumberingRuleRequest(model), {
    resetPolicy: 'NEVER',
    segments: model.segments,
    ruleCode: 'SALES_ORDER',
    name: '销售订单号',
  })
  assert.deepEqual(buildUpdateNumberingRuleRequest(model, DETAIL), {
    resetPolicy: 'NEVER',
    segments: model.segments,
    name: '销售订单号',
    description: null,
    expectedVersion: 7,
  })
  assert.deepEqual(buildPreviewNumberingRuleRequest(model, DETAIL.id), {
    resetPolicy: 'NEVER',
    segments: model.segments,
    ruleId: DETAIL.id,
  })
  assert.deepEqual(buildPublishNumberingRuleRequest(DETAIL), {
    expectedVersion: 7,
    draftRevision: 3,
  })
  assert.deepEqual(buildChangeNumberingRuleStatusRequest(DETAIL), {
    expectedVersion: 7,
  })
  assert.deepEqual(buildCloneNumberingRuleRequest(model, DETAIL), {
    expectedVersion: 7,
    ruleCode: 'SALES_ORDER',
    name: '销售订单号',
    description: null,
  })
  assert.equal('timezone' in model, false)
  assert.equal('timezone' in buildUpdateNumberingRuleRequest(model, DETAIL), false)
  assert.equal(typeof model.segments[0]?.type === 'string'
    && model.segments[0].type === 'SEQUENCE'
    ? model.segments[0].startValue
    : undefined, '9007199254740993')
})

test('十进制展示不经过 Number 且保留安全整数上界之外的精度', () => {
  assert.equal(
    formatNumberingDecimal('900719925474099312345678901234567890'),
    '900,719,925,474,099,312,345,678,901,234,567,890',
  )
  assert.equal(formatNumberingDecimal('0'), '0')
  assert.equal(formatNumberingDecimal('not-decimal'), '—')
})

test('mutation 网络失败标记结果未知，版本冲突要求刷新，未知错误安全回退', () => {
  assert.deepEqual(getNumberingMutationFailure({
    kind: 'network',
    message: 'Network Error',
  }), {
    code: undefined,
    fieldErrors: {},
    message: 'Network Error',
    requestId: undefined,
    requiresRefresh: true,
    unknownResult: true,
  })
  assert.deepEqual(getNumberingMutationFailure({
    kind: 'http',
    status: 409,
    body: {
      code: 'NUMBERING_RULE_STATE_CHANGED',
      message: '编号规则状态已变化，请刷新后重试',
      requestId: 'request-state',
    },
  }), {
    code: 'NUMBERING_RULE_STATE_CHANGED',
    fieldErrors: {},
    message: '编号规则状态已变化，请刷新后重试',
    requestId: 'request-state',
    requiresRefresh: true,
    unknownResult: false,
  })
  assert.deepEqual(getNumberingMutationFailure(new Error('secret SQL')), {
    code: undefined,
    fieldErrors: {},
    message: '编号规则操作失败，请稍后重试',
    requestId: undefined,
    requiresRefresh: false,
    unknownResult: false,
  })
})
