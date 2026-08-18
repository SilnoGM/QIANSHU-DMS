import { FundPostingError } from './fund-posting.errors'
import {
  normalizeFundBusinessSourceCreate,
  normalizeFundBusinessSourceListQuery,
  normalizeFundBusinessSourceUpdate,
  normalizeFundDraftRuleReplace,
  normalizeFundPostingRulePublish,
  normalizeFundPostingTypeCreate,
  normalizeFundPostingTypeEnabledUpdate,
  normalizeFundPostingTypeListQuery,
  normalizeFundPostingTypeUpdate,
} from './fund-configuration.normalizer'

const POSTING_TYPE_ID = '22222222-2222-4222-a222-222222222222'
const RULE_VERSION_ID = '33333333-3333-4333-a333-333333333333'
const SOURCE_ID = '44444444-4444-4444-a444-444444444444'

const splitLegs = [
  {
    position: 1,
    accountTarget: 'USER' as const,
    directionPolicy: 'DEBIT' as const,
    amountStrategy: 'USER_SHARE' as const,
  },
  {
    position: 2,
    accountTarget: 'COMPANY' as const,
    directionPolicy: 'DEBIT' as const,
    amountStrategy: 'COMPANY_REMAINDER' as const,
  },
]

function expectValidation(
  operation: () => unknown,
  field: string,
): void {
  let thrown: unknown
  try {
    operation()
  }
  catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(FundPostingError)
  expect(thrown).toMatchObject({
    code: 'FUND_VALIDATION_FAILED',
    field,
    message: '资金请求参数无效',
  })
}

describe('fund configuration query normalizers', () => {
  it('normalizes posting type filters, paging and stable sort inputs', () => {
    expect(normalizeFundPostingTypeListQuery({
      page: 2,
      pageSize: 10,
      search: '  采购   付款  ',
      businessCategory: 'COST',
      enabled: false,
      sortBy: 'code',
      sortOrder: 'asc',
    })).toEqual({
      page: 2,
      pageSize: 10,
      skip: 10,
      search: '采购 付款',
      businessCategory: 'COST',
      enabled: false,
      sortBy: 'code',
      sortOrder: 'asc',
    })
  })

  it('normalizes business source defaults and rejects invalid filters', () => {
    expect(normalizeFundBusinessSourceListQuery({})).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
      search: null,
      enabled: null,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    })

    expectValidation(
      () => normalizeFundPostingTypeListQuery({ businessCategory: 'OTHER' }),
      'businessCategory',
    )
    expectValidation(
      () => normalizeFundBusinessSourceListQuery({ enabled: 'true' }),
      'enabled',
    )
    expectValidation(
      () => normalizeFundBusinessSourceListQuery({ unknown: true }),
      'body',
    )
  })
})

describe('fund posting type mutation normalizers', () => {
  it('creates only a disabled STANDARD type with a controlled first DRAFT', () => {
    expect(normalizeFundPostingTypeCreate({
      code: 'purchase_refund',
      name: ' 采购   退款 ',
      description: ' 采购退款成本冲减 ',
      businessCategory: 'COST',
      requiresUser: true,
      amountSignPolicy: 'POSITIVE_ONLY',
      legs: splitLegs,
    })).toEqual({
      code: 'PURCHASE_REFUND',
      name: '采购 退款',
      description: '采购退款成本冲减',
      businessCategory: 'COST',
      requiresUser: true,
      amountSignPolicy: 'POSITIVE_ONLY',
      inputMode: 'STANDARD',
      enabled: false,
      legs: splitLegs,
    })
  })

  it('rejects reserved adjustment identities, arbitrary enums and unknown fields', () => {
    const base = {
      code: 'ADMIN_MANUAL_ADJUSTMENT',
      name: '手动调账',
      businessCategory: 'COST',
      requiresUser: true,
      amountSignPolicy: 'POSITIVE_ONLY',
      legs: splitLegs,
    }
    expectValidation(() => normalizeFundPostingTypeCreate(base), 'code')
    expectValidation(
      () => normalizeFundPostingTypeCreate({
        ...base,
        code: 'NEW_ADJUSTMENT',
        businessCategory: 'ADJUSTMENT',
      }),
      'businessCategory',
    )
    expectValidation(
      () => normalizeFundPostingTypeCreate({
        ...base,
        code: 'NEW_COST',
        amountSignPolicy: 'ANY',
      }),
      'amountSignPolicy',
    )
    expectValidation(
      () => normalizeFundPostingTypeCreate({
        ...base,
        code: 'NEW_COST',
        enabled: true,
      }),
      'body',
    )
  })

  it('normalizes DRAFT replacement and publish version guards', () => {
    expect(normalizeFundDraftRuleReplace({
      postingTypeId: POSTING_TYPE_ID,
      expectedVersion: 3,
      legs: splitLegs,
    })).toEqual({
      postingTypeId: POSTING_TYPE_ID,
      expectedVersion: 3,
      legs: splitLegs,
    })
    expect(normalizeFundPostingRulePublish({
      postingTypeId: POSTING_TYPE_ID,
      draftRuleVersionId: RULE_VERSION_ID,
      expectedVersion: 3,
    })).toEqual({
      postingTypeId: POSTING_TYPE_ID,
      draftRuleVersionId: RULE_VERSION_ID,
      expectedVersion: 3,
    })
  })

  it('rejects accessors and invalid controlled legs before persistence', () => {
    const accessor = Object.defineProperty({}, 'postingTypeId', {
      enumerable: true,
      get: () => POSTING_TYPE_ID,
    })
    expectValidation(() => normalizeFundDraftRuleReplace(accessor), 'body')
    expectValidation(
      () => normalizeFundDraftRuleReplace({
        postingTypeId: POSTING_TYPE_ID,
        expectedVersion: 1,
        legs: [{
          position: 1,
          accountTarget: 'BANK',
          directionPolicy: 'DEBIT',
          amountStrategy: 'FULL_AMOUNT',
        }],
      }),
      'legs',
    )
  })

  it('keeps stable type fields outside update and enable contracts', () => {
    expectValidation(
      () => normalizeFundPostingTypeUpdate({
        postingTypeId: POSTING_TYPE_ID,
        name: '采购付款',
        description: null,
        expectedVersion: 1,
        code: 'CHANGED_CODE',
      }),
      'body',
    )
    expectValidation(
      () => normalizeFundPostingTypeEnabledUpdate({
        postingTypeId: POSTING_TYPE_ID,
        enabled: true,
        expectedVersion: 1,
        businessCategory: 'REVENUE',
      }),
      'body',
    )
  })
})

describe('fund business source mutation normalizers', () => {
  it('normalizes unique allowed type IDs and nullable descriptions', () => {
    expect(normalizeFundBusinessSourceCreate({
      code: ' order_domain ',
      name: ' 订单   域 ',
      description: null,
      enabled: true,
      allowedPostingTypeIds: [POSTING_TYPE_ID, RULE_VERSION_ID, POSTING_TYPE_ID],
    })).toEqual({
      code: 'ORDER_DOMAIN',
      name: '订单 域',
      description: null,
      enabled: true,
      allowedPostingTypeIds: [POSTING_TYPE_ID, RULE_VERSION_ID],
    })

    expect(normalizeFundBusinessSourceUpdate({
      businessSourceId: SOURCE_ID,
      name: '订单域',
      description: '',
      allowedPostingTypeIds: [POSTING_TYPE_ID],
      expectedVersion: 2,
    })).toEqual({
      businessSourceId: SOURCE_ID,
      name: '订单域',
      description: null,
      allowedPostingTypeIds: [POSTING_TYPE_ID],
      expectedVersion: 2,
    })
  })

  it('requires at least one allowed type for enabled sources', () => {
    expectValidation(
      () => normalizeFundBusinessSourceCreate({
        code: 'EMPTY_SOURCE',
        name: '空来源',
        enabled: true,
        allowedPostingTypeIds: [],
      }),
      'allowedPostingTypeIds',
    )
  })
})
