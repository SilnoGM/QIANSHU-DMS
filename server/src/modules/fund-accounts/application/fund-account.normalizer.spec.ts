import {
  normalizeFundAccountCommandContext,
  normalizeFundAccountListQuery,
  normalizeFundAccountShareRateUpdate,
  normalizeFundAccountCreate,
} from './fund-account.normalizer'
import { FundPostingError } from './fund-posting.errors'

const ACTOR_USER_ID = '11111111-1111-4111-a111-111111111111'
const TARGET_USER_ID = '22222222-2222-4222-a222-222222222222'
const ACCOUNT_ID = '33333333-3333-4333-a333-333333333333'

function expectFundError(
  action: () => unknown,
  code: string,
  field?: string,
): void {
  let thrown: unknown
  try {
    action()
  }
  catch (error) {
    thrown = error
  }

  expect(thrown).toBeInstanceOf(FundPostingError)
  expect(thrown).toMatchObject({ code, ...(field === undefined ? {} : { field }) })
}

describe('fund account normalizer', () => {
  it('normalizes trusted command context and account commands', () => {
    expect(normalizeFundAccountCommandContext({
      actorUserId: ACTOR_USER_ID,
      requestId: '  request-1  ',
      correlationId: '  correlation-1  ',
    })).toEqual({
      actorUserId: ACTOR_USER_ID,
      requestId: 'request-1',
      correlationId: 'correlation-1',
    })

    expect(normalizeFundAccountCreate({
      userId: TARGET_USER_ID,
      userShareRate: '30.5',
    })).toEqual({
      userId: TARGET_USER_ID,
      userShareRate: '30.5000',
    })

    expect(normalizeFundAccountShareRateUpdate({
      accountId: ACCOUNT_ID,
      userShareRate: '45',
      expectedVersion: 2,
      reason: '  调整   合作比例  ',
    })).toEqual({
      accountId: ACCOUNT_ID,
      userShareRate: '45.0000',
      expectedVersion: 2,
      reason: '调整 合作比例',
    })
  })

  it('normalizes list defaults, search, owner filter and stable sort input', () => {
    expect(normalizeFundAccountListQuery({})).toEqual({
      page: 1,
      pageSize: 20,
      skip: 0,
      search: null,
      ownerType: null,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    })

    expect(normalizeFundAccountListQuery({
      page: 2,
      pageSize: 50,
      search: '  张   三  ',
      ownerType: 'USER',
      sortBy: 'balance',
      sortOrder: 'asc',
    })).toEqual({
      page: 2,
      pageSize: 50,
      skip: 50,
      search: '张 三',
      ownerType: 'USER',
      sortBy: 'balance',
      sortOrder: 'asc',
    })
  })

  it.each([
    [{ unknown: true }, 'body'],
    [{ ownerType: 'SYSTEM' }, 'ownerType'],
    [{ sortBy: 'nextSequence' }, 'sortBy'],
    [{ page: 0 }, 'page'],
    [{ search: 'x'.repeat(129) }, 'search'],
  ])('rejects an unsafe account query: %j', (input, field) => {
    expectFundError(
      () => normalizeFundAccountListQuery(input),
      'FUND_VALIDATION_FAILED',
      field,
    )
  })

  it('rejects non-canonical identifiers, unsafe versions and invalid share rates', () => {
    expectFundError(
      () => normalizeFundAccountCreate({
        userId: TARGET_USER_ID.toUpperCase(),
        userShareRate: '30',
      }),
      'FUND_VALIDATION_FAILED',
      'userId',
    )
    expectFundError(
      () => normalizeFundAccountShareRateUpdate({
        accountId: ACCOUNT_ID,
        userShareRate: '101',
        expectedVersion: 1,
        reason: '错误比例',
      }),
      'FUND_SHARE_RATE_INVALID',
      'shareRate',
    )
    expectFundError(
      () => normalizeFundAccountShareRateUpdate({
        accountId: ACCOUNT_ID,
        userShareRate: '30',
        expectedVersion: 0,
        reason: '错误版本',
      }),
      'FUND_VALIDATION_FAILED',
      'expectedVersion',
    )
  })

  it('rejects accessors without invoking them', () => {
    let getterCalls = 0
    const query = {}
    Object.defineProperty(query, 'page', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 1
      },
    })

    expectFundError(
      () => normalizeFundAccountListQuery(query),
      'FUND_VALIDATION_FAILED',
      'body',
    )
    expect(getterCalls).toBe(0)
  })
})
