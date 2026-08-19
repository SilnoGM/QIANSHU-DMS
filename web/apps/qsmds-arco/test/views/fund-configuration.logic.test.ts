import type {
  FundBusinessSourceDto,
  FundPostingRuleLegRequestDto,
  FundPostingTypeDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 资金配置纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildFundBusinessSourceCreateRequest,
  buildFundBusinessSourceUpdateRequest,
  buildFundDraftRuleRequest,
  buildFundPostingTypeCreateRequest,
  buildFundPostingTypeUpdateRequest,
  describeFundRuleTargets,
  matchesFundBusinessSource,
  matchesFundPostingTypeDraft,
  matchesFundPostingTypeStatus,
} from '../../src/views/admin/fund-account-management/list/fund-configuration.logic'

const splitDebitLegs: FundPostingRuleLegRequestDto[] = [
  {
    accountTarget: 'USER',
    amountStrategy: 'USER_SHARE',
    directionPolicy: 'DEBIT',
    position: 8,
  },
  {
    accountTarget: 'COMPANY',
    amountStrategy: 'COMPANY_REMAINDER',
    directionPolicy: 'DEBIT',
    position: 7,
  },
]

function postingTypeFixture(): FundPostingTypeDto {
  return {
    activeRule: null,
    amountSignPolicy: 'POSITIVE_ONLY',
    businessCategory: 'COST',
    code: 'CUSTOM_FEE',
    createdAt: '2026-08-18T01:00:00.000Z',
    currentRuleVersionId: null,
    description: null,
    draftRule: {
      createdAt: '2026-08-18T01:00:00.000Z',
      createdByUserId: 'admin-id',
      id: 'draft-id',
      legs: splitDebitLegs.map((leg, index) => ({
        ...leg,
        // OpenAPI 当前把 nullable 字段生成为必填联合；运行时标准规则返回 null。
        adjustmentMode: null as unknown as 'USER_ONLY',
        id: `leg-${index + 1}`,
        position: index + 1,
      })),
      publishedAt: null,
      publishedByUserId: null,
      revision: 1,
      status: 'DRAFT',
    },
    enabled: false,
    id: 'posting-type-id',
    inputMode: 'STANDARD',
    name: '自定义费用',
    requiresUser: true,
    updatedAt: '2026-08-18T01:00:00.000Z',
    version: 3,
  }
}

function businessSourceFixture(): FundBusinessSourceDto {
  return {
    allowedPostingTypes: [{
      allowedAt: '2026-08-18T01:00:00.000Z',
      businessCategory: 'COST',
      code: 'CUSTOM_FEE',
      enabled: false,
      id: 'posting-type-id',
      name: '自定义费用',
    }],
    code: 'PURCHASE_DOMAIN',
    createdAt: '2026-08-18T01:00:00.000Z',
    description: null,
    enabled: true,
    id: 'source-id',
    name: '采购域',
    updatedAt: '2026-08-18T01:00:00.000Z',
    version: 2,
  }
}

test('类型创建规范化稳定编码并从受控 leg 推导用户账户需求', () => {
  assert.deepEqual(buildFundPostingTypeCreateRequest({
    amountSignPolicy: 'POSITIVE_ONLY',
    businessCategory: 'COST',
    code: ' custom_fee ',
    description: ' 采购  业务费用 ',
    legs: splitDebitLegs,
    name: ' 自定义费用 ',
  }), {
    amountSignPolicy: 'POSITIVE_ONLY',
    businessCategory: 'COST',
    code: 'CUSTOM_FEE',
    description: '采购 业务费用',
    legs: splitDebitLegs.map((leg, index) => ({ ...leg, position: index + 1 })),
    name: '自定义费用',
    requiresUser: true,
  })
  assert.equal(describeFundRuleTargets(splitDebitLegs), '用户当前比例 / 公司尾差')
})

test('规则 leg 拒绝不守恒、重复账户、有符号固定方向和人工调账模式', () => {
  assert.throws(() => buildFundPostingTypeCreateRequest({
    amountSignPolicy: 'POSITIVE_ONLY',
    businessCategory: 'COST',
    code: 'INVALID_SPLIT',
    description: null,
    legs: [splitDebitLegs[0]!],
    name: '错误分账',
  }))
  assert.throws(() => buildFundDraftRuleRequest(postingTypeFixture(), [
    splitDebitLegs[0]!,
    { ...splitDebitLegs[0]!, position: 2 },
  ]))
  assert.throws(() => buildFundPostingTypeCreateRequest({
    amountSignPolicy: 'NON_ZERO_SIGNED',
    businessCategory: 'REVENUE',
    code: 'SIGNED_FIXED',
    description: null,
    legs: splitDebitLegs,
    name: '错误有符号类型',
  }))
  assert.throws(() => buildFundDraftRuleRequest(postingTypeFixture(), [{
    ...splitDebitLegs[0]!,
    adjustmentMode: 'USER_ONLY',
  }]))
})

test('编辑请求只携带 generated DTO 允许的可变字段和并发版本', () => {
  const postingType = postingTypeFixture()
  assert.deepEqual(
    buildFundPostingTypeUpdateRequest(postingType, ' 新名称 ', ''),
    { description: null, expectedVersion: 3, name: '新名称' },
  )

  const source = businessSourceFixture()
  assert.deepEqual(buildFundBusinessSourceCreateRequest({
    allowedPostingTypeIds: ['type-b', 'type-a', 'type-b'],
    code: ' purchase_domain ',
    description: '',
    enabled: true,
    name: ' 采购域 ',
  }), {
    allowedPostingTypeIds: ['type-a', 'type-b'],
    code: 'PURCHASE_DOMAIN',
    description: null,
    enabled: true,
    name: '采购域',
  })
  assert.deepEqual(
    buildFundBusinessSourceUpdateRequest(source, {
      allowedPostingTypeIds: ['posting-type-id'],
      description: ' 仅采购调用 ',
      name: '采购业务域',
    }),
    {
      allowedPostingTypeIds: ['posting-type-id'],
      description: '仅采购调用',
      expectedVersion: 2,
      name: '采购业务域',
    },
  )
})

test('结果未知核对只比较目标状态，不要求自动重放 mutation', () => {
  const postingType = postingTypeFixture()
  assert.equal(matchesFundPostingTypeDraft(postingType, splitDebitLegs), true)
  assert.equal(matchesFundPostingTypeStatus({ ...postingType, enabled: true }, true), true)
  assert.equal(matchesFundPostingTypeStatus(postingType, true), false)

  const source = businessSourceFixture()
  assert.equal(matchesFundBusinessSource(source, {
    allowedPostingTypeIds: ['posting-type-id'],
    description: null,
    enabled: true,
    name: '采购域',
  }), true)
  assert.equal(matchesFundBusinessSource(source, {
    allowedPostingTypeIds: [],
    description: null,
    enabled: true,
    name: '采购域',
  }), false)
})
