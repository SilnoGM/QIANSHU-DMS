import { randomUUID } from 'node:crypto'

import type { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import request from 'supertest'

import { AppModule } from '../src/app.module'
import { configureApplication } from '../src/app.setup'
import { PrismaService } from '../src/infrastructure/database/prisma.service'
import { FundAccountCommandService } from '../src/modules/fund-accounts/application/fund-account-command.service'
import { FundConfigurationCommandService } from '../src/modules/fund-accounts/application/fund-configuration-command.service'
import { FundPostingService } from '../src/modules/fund-accounts/application/fund-posting.contract'
import type {
  FundPostingContext,
  FundPostingResult,
  PostBusinessEventInput,
} from '../src/modules/fund-accounts/application/fund-posting.contract'
import { PasswordProvider } from '../src/modules/auth/providers/password.provider'

const APP_ORIGIN = 'http://127.0.0.1:9000'
const CSRF_HEADERS = {
  Origin: APP_ORIGIN,
  'X-Qianshu-CSRF': '1',
  'Sec-Fetch-Site': 'same-origin',
} as const
const SOURCE_CODE_PREFIX = 'FUND_SELF_E2E_'
const SELF_ACCOUNT_KEYS = [
  'balance',
  'createdAt',
  'currency',
  'id',
  'shareRateUpdatedAt',
  'updatedAt',
  'userShareRate',
] as const
const SELF_TRANSACTION_KEYS = [
  'accountSequence',
  'amount',
  'balanceAfter',
  'balanceBefore',
  'batchKind',
  'batchNo',
  'businessAmount',
  'businessCategory',
  'businessNo',
  'businessOccurredAt',
  'businessSourceName',
  'direction',
  'entryId',
  'postedAt',
  'postingTypeId',
  'postingTypeName',
  'reversalStatus',
  'summary',
  'userShareRateSnapshot',
] as const

interface LoginAccount {
  readonly password: string
  readonly userId: string
  readonly username: string
}

interface SelfAccountBody {
  account: null | {
    id: string
    currency: 'CNY'
    balance: string
    userShareRate: string
    shareRateUpdatedAt: string
    createdAt: string
    updatedAt: string
  }
}

interface SelfTransactionBody {
  entryId: string
  batchNo: string
  batchKind: string
  postingTypeId: string
  postingTypeName: string
  businessCategory: string
  businessSourceName: string
  direction: string
  amount: string
  balanceBefore: string
  balanceAfter: string
  accountSequence: string
  businessAmount: string
  userShareRateSnapshot: string | null
  businessNo: string | null
  summary: string
  businessOccurredAt: string
  reversalStatus: string
  postedAt: string
}

interface SelfTransactionPageBody {
  items: SelfTransactionBody[]
  page: number
  pageSize: number
  total: number
}

interface PostingTypeOptionBody {
  id: string
  name: string
}

interface PostingTypeOptionListBody {
  items: PostingTypeOptionBody[]
}

function responseBody<T>(response: { body: unknown }): T {
  return response.body as T
}

function expectPrivateResponse(
  response: { headers: Record<string, string | string[] | undefined> },
): void {
  expect(response.headers['cache-control']).toBe('private, no-store')
}

describe('personal fund self API with Cookie Session and PostgreSQL', () => {
  jest.setTimeout(120_000)

  let application: INestApplication
  let prisma: PrismaService
  let passwords: PasswordProvider
  let accountCommands: FundAccountCommandService
  let configurationCommands: FundConfigurationCommandService
  let businessPostings: FundPostingService
  let opsUserId: string
  let opsAccountId: string
  let opsBrowser: ReturnType<typeof request.agent>
  let financeBrowser: ReturnType<typeof request.agent>
  let plainBrowser: ReturnType<typeof request.agent>
  let noAccountBrowser: ReturnType<typeof request.agent>
  let orderSettlementTypeId: string
  let userWithdrawalTypeId: string
  let purchasePaymentTypeId: string
  let opsOrderPosting: FundPostingResult
  let opsWithdrawalPosting: FundPostingResult
  let otherOrderPosting: FundPostingResult
  let otherPurchasePosting: FundPostingResult
  let otherAccountId: string

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    application = moduleRef.createNestApplication()
    configureApplication(application, { nodeEnvironment: 'test' })
    await application.init()

    prisma = application.get(PrismaService)
    passwords = application.get(PasswordProvider)
    accountCommands = application.get(FundAccountCommandService)
    configurationCommands = application.get(FundConfigurationCommandService)
    businessPostings = application.get(FundPostingService)

    await prisma.authRateLimit.deleteMany()

    const opsAccount = await createLoginAccount(['fund-accounts:read-self'])
    const financeAccount = await createLoginAccount(['fund-accounts:read'])
    const plainAccount = await createLoginAccount([])
    const noAccount = await createLoginAccount(['fund-accounts:read-self'])
    const otherAccount = await createLoginAccount([])
    opsUserId = opsAccount.userId

    const postingTypes = await prisma.fundPostingType.findMany({
      where: {
        code: {
          in: ['ORDER_SETTLEMENT', 'USER_WITHDRAWAL', 'PURCHASE_PAYMENT'],
        },
      },
      select: { id: true, code: true },
    })
    expect(postingTypes).toHaveLength(3)
    orderSettlementTypeId = postingTypes.find(
      item => item.code === 'ORDER_SETTLEMENT',
    )?.id as string
    userWithdrawalTypeId = postingTypes.find(
      item => item.code === 'USER_WITHDRAWAL',
    )?.id as string
    purchasePaymentTypeId = postingTypes.find(
      item => item.code === 'PURCHASE_PAYMENT',
    )?.id as string

    const sourceCode = `${SOURCE_CODE_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`
    await configurationCommands.createBusinessSource(
      commandContext('source'),
      {
        code: sourceCode,
        name: '个人资金 E2E 来源',
        description: '仅用于 self 接口验收',
        enabled: true,
        allowedPostingTypeIds: [
          orderSettlementTypeId,
          userWithdrawalTypeId,
          purchasePaymentTypeId,
        ],
      },
    )

    const opsAccountView = await accountCommands.createUserAccount(
      commandContext('ops_account'),
      { userId: opsUserId, userShareRate: '30' },
    )
    opsAccountId = opsAccountView.id
    const otherAccountView = await accountCommands.createUserAccount(
      commandContext('other_account'),
      { userId: otherAccount.userId, userShareRate: '30' },
    )
    otherAccountId = otherAccountView.id

    const postingContext = (prefix: string): FundPostingContext => ({
      consumerCode: 'FUND_SELF_E2E_CONSUMER',
      sourceCode,
      requestId: `fund_self_${prefix.slice(0, 8)}_${randomUUID()}`,
    })

    opsOrderPosting = await businessPostings.postBusinessEvent(
      postingContext('ops_order'),
      postingInput('ORDER_SETTLEMENT', {
        userId: opsUserId,
        amount: '100',
        businessNo: 'SELF-ORDER-1',
        businessOccurredAt: '2026-01-05T00:00:00.000Z',
      }),
    )
    opsWithdrawalPosting = await businessPostings.postBusinessEvent(
      postingContext('ops_withdrawal'),
      postingInput('USER_WITHDRAWAL', {
        userId: opsUserId,
        amount: '10',
        businessNo: 'SELF-WITHDRAWAL-1',
        businessOccurredAt: '2026-02-05T00:00:00.000Z',
      }),
    )
    otherOrderPosting = await businessPostings.postBusinessEvent(
      postingContext('other_order'),
      postingInput('ORDER_SETTLEMENT', {
        userId: otherAccount.userId,
        amount: '50',
        businessNo: 'OTHER-ORDER-1',
        businessOccurredAt: '2026-01-06T00:00:00.000Z',
      }),
    )
    otherPurchasePosting = await businessPostings.postBusinessEvent(
      postingContext('other_purchase'),
      postingInput('PURCHASE_PAYMENT', {
        userId: otherAccount.userId,
        amount: '20',
        businessNo: 'OTHER-PURCHASE-1',
        businessOccurredAt: '2026-01-07T00:00:00.000Z',
      }),
    )

    opsBrowser = await loginBrowser(opsAccount)
    financeBrowser = await loginBrowser(financeAccount)
    plainBrowser = await loginBrowser(plainAccount)
    noAccountBrowser = await loginBrowser(noAccount)
  })

  afterAll(async () => {
    await prisma?.authRateLimit.deleteMany()
    await application?.close()
  })

  function commandContext(prefix: string) {
    return {
      actorUserId: opsUserId,
      requestId: `fund_self_${prefix.slice(0, 8)}_${randomUUID()}`,
    }
  }

  function postingInput(
    postingTypeCode: string,
    options: {
      userId: string
      amount: string
      businessNo: string
      businessOccurredAt: string
    },
  ): PostBusinessEventInput {
    const suffix = randomUUID()
    return {
      postingTypeCode,
      userId: options.userId,
      amount: options.amount,
      businessId: `fund-self-e2e-${suffix}`,
      businessNo: options.businessNo,
      summary: `个人资金 E2E ${postingTypeCode}`,
      metadata: { scenario: 'fund-self-api' },
      businessOccurredAt: options.businessOccurredAt,
      idempotencyKey: `fund-self-e2e-key-${suffix}`,
    }
  }

  async function createLoginAccount(
    permissionCodes: readonly string[],
  ): Promise<LoginAccount> {
    const suffix = randomUUID()
    const username = `fund_self_e2e_${suffix}`
    const password = `Self-${suffix.slice(0, 12)}!7`
    const user = await prisma.user.create({
      data: {
        username,
        usernameNormalized: username,
        displayName: '个人资金 E2E',
        passwordHash: await passwords.hash(password),
        passwordChangedAt: new Date(),
        mustChangePassword: false,
        profile: { create: {} },
      },
      select: { id: true },
    })

    if (permissionCodes.length > 0) {
      const permissions = await prisma.permission.findMany({
        where: { code: { in: [...permissionCodes] } },
        select: { id: true },
      })
      expect(permissions).toHaveLength(permissionCodes.length)
      const role = await prisma.role.create({
        data: {
          code: `fund_self_e2e_${suffix.replaceAll('-', '')}`,
          name: '个人资金 E2E 角色',
          permissions: {
            create: permissions.map(permission => ({
              permissionId: permission.id,
            })),
          },
        },
        select: { id: true },
      })
      await prisma.userRole.create({
        data: { userId: user.id, roleId: role.id },
      })
    }

    return { password, userId: user.id, username }
  }

  async function loginBrowser(account: LoginAccount) {
    const browser = request.agent(application.getHttpServer())
    await browser
      .post('/api/auth/login')
      .set(CSRF_HEADERS)
      .send({ username: account.username, password: account.password })
      .expect(200)
    return browser
  }

  function ownUserEntryIds(postings: readonly FundPostingResult[]): string[] {
    return postings.flatMap(posting => posting.entries
      .filter(entry => entry.accountTarget === 'USER')
      .map(entry => entry.entryId))
  }

  it('returns the caller account without company share rate or internal fields', async () => {
    const response = await opsBrowser
      .get('/api/fund-accounts/me')
      .expect(200)
    expectPrivateResponse(response)

    const body = responseBody<SelfAccountBody>(response)
    expect(body.account).not.toBeNull()
    expect(Object.keys(body.account as object).sort()).toEqual(
      [...SELF_ACCOUNT_KEYS].sort(),
    )
    expect(body.account).toMatchObject({
      id: opsAccountId,
      currency: 'CNY',
      balance: '20.00',
      userShareRate: '30.00',
    })
    expect(body.account).not.toHaveProperty('companyShareRate')
    expect(body.account).not.toHaveProperty('ownerType')
    expect(body.account).not.toHaveProperty('user')
    expect(body.account).not.toHaveProperty('version')
  })

  it('returns null for an operator without a fund account', async () => {
    const response = await noAccountBrowser
      .get('/api/fund-accounts/me')
      .expect(200)
    expectPrivateResponse(response)
    expect(responseBody<SelfAccountBody>(response)).toEqual({ account: null })
  })

  it('enforces the self read permission and Session on all three endpoints', async () => {
    const anonymousAccount = await request(application.getHttpServer())
      .get('/api/fund-accounts/me')
      .expect(401)
    expect(responseBody<{ code: string }>(anonymousAccount).code)
      .toBe('AUTHENTICATION_REQUIRED')

    for (const path of [
      '/api/fund-accounts/me',
      '/api/fund-transactions/me',
      '/api/fund-transactions/me/posting-types',
    ]) {
      const financeResponse = await financeBrowser.get(path).expect(403)
      expect(responseBody<{ code: string }>(financeResponse).code)
        .toBe('FORBIDDEN')
      const plainResponse = await plainBrowser.get(path).expect(403)
      expect(responseBody<{ code: string }>(plainResponse).code)
        .toBe('FORBIDDEN')
    }
  })

  it('returns only the caller account entries with batch source information', async () => {
    const response = await opsBrowser
      .get('/api/fund-transactions/me')
      .expect(200)
    expectPrivateResponse(response)

    const body = responseBody<SelfTransactionPageBody>(response)
    const expectedEntryIds = ownUserEntryIds([
      opsOrderPosting,
      opsWithdrawalPosting,
    ])
    const companyEntryIds = [
      ...opsOrderPosting.entries,
      ...opsWithdrawalPosting.entries,
    ]
      .filter(entry => entry.accountTarget === 'COMPANY')
      .map(entry => entry.entryId)
    const otherEntryIds = [
      ...otherOrderPosting.entries,
      ...otherPurchasePosting.entries,
    ].map(entry => entry.entryId)

    expect(body.total).toBe(expectedEntryIds.length)
    expect(body.items.map(item => item.entryId).sort())
      .toEqual(expectedEntryIds.sort())
    for (const item of body.items) {
      expect(companyEntryIds).not.toContain(item.entryId)
      expect(otherEntryIds).not.toContain(item.entryId)
      expect(Object.keys(item).sort()).toEqual(
        [...SELF_TRANSACTION_KEYS].sort(),
      )
      expect(item).not.toHaveProperty('companyShareRateSnapshot')
      expect(item).not.toHaveProperty('account')
      expect(item).not.toHaveProperty('accountTarget')
      expect(item).not.toHaveProperty('batchId')
      expect(item.summary).toContain('个人资金 E2E')
      expect(item.businessSourceName).toBe('个人资金 E2E 来源')
      expect(item.batchNo).not.toBe('')
    }
    expect(body.items.some(item => item.businessNo === 'SELF-ORDER-1'))
      .toBe(true)
  })

  it('filters by direction, business occurred time and posting type', async () => {
    const debitResponse = await opsBrowser
      .get('/api/fund-transactions/me')
      .query({ direction: 'DEBIT' })
      .expect(200)
    const debitBody = responseBody<SelfTransactionPageBody>(debitResponse)
    expect(debitBody.total).toBe(1)
    expect(debitBody.items[0]?.entryId).toBe(
      ownUserEntryIds([opsWithdrawalPosting])[0],
    )

    const typeResponse = await opsBrowser
      .get('/api/fund-transactions/me')
      .query({ postingTypeId: orderSettlementTypeId })
      .expect(200)
    const typeBody = responseBody<SelfTransactionPageBody>(typeResponse)
    expect(typeBody.total).toBe(1)
    expect(typeBody.items[0]?.entryId).toBe(
      ownUserEntryIds([opsOrderPosting])[0],
    )

    const timeResponse = await opsBrowser
      .get('/api/fund-transactions/me')
      .query({
        occurredFrom: '2026-02-01T00:00:00.000Z',
        occurredTo: '2026-03-01T00:00:00.000Z',
      })
      .expect(200)
    const timeBody = responseBody<SelfTransactionPageBody>(timeResponse)
    expect(timeBody.total).toBe(1)
    expect(timeBody.items[0]?.entryId).toBe(
      ownUserEntryIds([opsWithdrawalPosting])[0],
    )
  })

  it('rejects client-supplied user or account scoping parameters', async () => {
    for (const query of [
      { userId: randomUUID() },
      { accountId: otherAccountId },
      { businessSourceId: randomUUID() },
    ]) {
      const response = await opsBrowser
        .get('/api/fund-transactions/me')
        .query(query)
        .expect(422)
      expect(responseBody<{ code: string }>(response).code)
        .toBe('VALIDATION_FAILED')
    }
  })

  it('lists only business types that appear in the caller ledger', async () => {
    const response = await opsBrowser
      .get('/api/fund-transactions/me/posting-types')
      .expect(200)
    expectPrivateResponse(response)

    const body = responseBody<PostingTypeOptionListBody>(response)
    expect(
      body.items.map(item => item.id).sort(),
    ).toEqual([orderSettlementTypeId, userWithdrawalTypeId].sort())
    expect(body.items.map(item => item.id)).not.toContain(
      purchasePaymentTypeId,
    )
    for (const item of body.items) {
      expect(Object.keys(item).sort()).toEqual(['id', 'name'])
      expect(item.name).not.toBe('')
    }
    expect(
      body.items.find(item => item.id === orderSettlementTypeId)?.name,
    ).toBe('订单结算')
    expect(
      body.items.find(item => item.id === userWithdrawalTypeId)?.name,
    ).toBe('用户提款')
  })

  it('returns an empty page and empty options for an operator without a ledger', async () => {
    const pageResponse = await noAccountBrowser
      .get('/api/fund-transactions/me')
      .expect(200)
    expect(responseBody<SelfTransactionPageBody>(pageResponse)).toEqual({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    })

    const optionResponse = await noAccountBrowser
      .get('/api/fund-transactions/me/posting-types')
      .expect(200)
    expect(responseBody<PostingTypeOptionListBody>(optionResponse))
      .toEqual({ items: [] })
  })
})
