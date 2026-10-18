import { randomUUID } from 'node:crypto'

import type { Response } from 'supertest'

import { AuditWriteFailedError } from '../src/modules/audit/audit.service'
import { ProductCreateE2eHarness } from './product-create-e2e-harness'

interface ApiErrorBody {
  readonly code: string
  readonly fieldErrors?: Record<string, string[]>
  readonly message: string
  readonly requestId: string
}

function readBody<T>(response: Response): T {
  return response.body as T
}

function expectApiError(
  response: Response,
  status: number,
  code: string,
): void {
  expect(response.status).toBe(status)
  const body = readBody<ApiErrorBody>(response)
  expect(body.code).toBe(code)
  expect(typeof body.requestId).toBe('string')
  expect(body.requestId.length).toBeGreaterThan(0)
  expect(response.headers['cache-control']).toContain('no-store')
}

function expectSafeError(response: Response, forbiddenValues: string[]): void {
  const serialized = JSON.stringify(response.body)
  for (const value of forbiddenValues) {
    expect(serialized).not.toContain(value)
  }
}

describe('Product create API with isolated PostgreSQL', () => {
  jest.setTimeout(120_000)

  let harness: ProductCreateE2eHarness

  beforeAll(async () => {
    harness = await ProductCreateE2eHarness.start()
  })

  afterEach(async () => {
    jest.restoreAllMocks()
    if (harness !== undefined) {
      await Promise.all([
        harness.setSupplierEnabled(true),
        harness.setCurrencyEnabled('TWD', true),
        harness.setCurrencyEnabled('MYR', true),
      ])
    }
  })

  afterAll(async () => {
    await harness?.dispose()
  })

  it('fails closed for missing, draft and disabled PRODUCT rules before enabling the fixture', async () => {
    const missingKey = randomUUID()
    const missing = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey: missingKey,
      body: harness.validBody(),
    })

    await harness.createProductRuleDraft()
    const draftKey = randomUUID()
    const draft = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey: draftKey,
      body: harness.validBody(),
    })

    await harness.publishProductRule()
    const disabledKey = randomUUID()
    const disabled = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey: disabledKey,
      body: harness.validBody(),
    })
    await harness.enableProductRule()

    for (const [response, key] of [
      [missing, missingKey],
      [draft, draftKey],
      [disabled, disabledKey],
    ] as const) {
      expectApiError(response, 409, 'PRODUCT_NUMBERING_UNAVAILABLE')
      expect((await harness.countCreateState(key)).issuances).toBe(0)
      expectSafeError(response, [key, harness.supplierValue, '1280.50'])
    }
  })

  it('rejects unauthenticated, unauthorized, forced-password and CSRF requests before Command', async () => {
    const ordinary = await harness.createAccount()
    const forced = await harness.createAccount({
      mustChangePassword: true,
      systemAdmin: true,
    })
    const commandSpy = jest.spyOn(harness.productCommands, 'create')
    const cases = [
      {
        browser: harness.anonymousBrowser,
        code: 'AUTHENTICATION_REQUIRED',
        includeCsrf: true,
        status: 401,
      },
      {
        browser: ordinary.browser,
        code: 'FORBIDDEN',
        includeCsrf: true,
        status: 403,
      },
      {
        browser: forced.browser,
        code: 'PASSWORD_CHANGE_REQUIRED',
        includeCsrf: true,
        status: 403,
      },
      {
        browser: harness.creatorBrowser,
        code: 'CSRF_REJECTED',
        includeCsrf: false,
        status: 403,
      },
    ] as const

    for (const testCase of cases) {
      const idempotencyKey = randomUUID()
      const response = await harness.createProduct({
        browser: testCase.browser,
        idempotencyKey,
        body: harness.validBody(),
        includeCsrf: testCase.includeCsrf,
      })
      expectApiError(response, testCase.status, testCase.code)
      expect((await harness.countCreateState(idempotencyKey)).issuances).toBe(0)
    }
    expect(commandSpy).not.toHaveBeenCalled()
  })

  it('rejects invalid headers, unknown fields, Active supplier and amount bounds before issuance', async () => {
    const initialGlobalState = await harness.countCreateState(randomUUID())
    const missingHeader = await harness.createProduct({
      browser: harness.creatorBrowser,
      body: harness.validBody(),
    })
    expectApiError(missingHeader, 422, 'VALIDATION_FAILED')
    expect(readBody<ApiErrorBody>(missingHeader).fieldErrors).toHaveProperty(
      'idempotencyKey',
    )

    const cases = [
      {
        body: harness.validBody(),
        code: 'VALIDATION_FAILED',
        key: randomUUID().toUpperCase(),
      },
      {
        body: { ...harness.validBody(), mainImage: 'SECRET_MEDIA_URL' },
        code: 'VALIDATION_FAILED',
        key: randomUUID(),
      },
      {
        body: { ...harness.validBody(), supplierValue: null },
        code: 'VALIDATION_FAILED',
        key: randomUUID(),
      },
      {
        body: harness.validBody({
          twdSalePrice: { amount: '1.000', currency: 'TWD' },
        }),
        code: 'VALIDATION_FAILED',
        key: randomUUID(),
      },
      {
        body: harness.validBody({
          purchaseCost: { amount: '9'.repeat(27), currency: 'CNY' },
        }),
        code: 'VALIDATION_FAILED',
        key: randomUUID(),
      },
    ] as const

    for (const testCase of cases) {
      const response = await harness.createProduct({
        browser: harness.creatorBrowser,
        idempotencyKey: testCase.key,
        body: testCase.body,
      })
      expectApiError(response, 422, testCase.code)
      expect((await harness.countCreateState(testCase.key)).issuances).toBe(0)
      expectSafeError(response, [
        testCase.key,
        harness.supplierValue,
        'SECRET_MEDIA_URL',
        '999999999999999999999999999',
      ])
    }
    expect(await harness.countCreateState(randomUUID())).toEqual(
      initialGlobalState,
    )
  })

  it('creates an inactive product at the supported 26-digit money boundary', async () => {
    const idempotencyKey = randomUUID()
    const amount = `${'9'.repeat(26)}.12`
    const response = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody({
        status: 'INACTIVE',
        twdSalePrice: { amount, currency: 'TWD' },
        attributes: [],
      }),
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      status: 'INACTIVE',
      supplier: { value: harness.supplierValue },
      twdSalePrice: { amount, currency: 'TWD' },
      attributes: [],
    })
  })

  it('creates one fully persisted Product and atomically records safe audit metadata', async () => {
    const idempotencyKey = randomUUID()
    const response = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody(),
    })

    if (response.status !== 201) {
      throw new Error(`Unexpected create response: ${JSON.stringify(response.body)}`)
    }
    await harness.expectSuccessfulProductState(response, {
      idempotencyKey,
      expectedActorId: harness.creatorUserId,
    })
  })

  it('replays the same actor, key and normalized payload without duplicate state', async () => {
    const idempotencyKey = randomUUID()
    const baseline = await harness.countCreateState(idempotencyKey)
    const first = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody(),
    })
    const replay = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody({ name: 'Product E2E' }),
    })

    expect(first.status).toBe(201)
    expect(replay.status).toBe(201)
    expect(replay.body).toEqual(first.body)
    const finalState = await harness.countCreateState(idempotencyKey)
    expect(finalState).toEqual({
      audits: baseline.audits + 1,
      issuances: baseline.issuances + 1,
      products: baseline.products + 1,
    })
  })

  it('rejects the same key with a different payload or actor', async () => {
    const payloadKey = randomUUID()
    const firstPayload = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey: payloadKey,
      body: harness.validBody(),
    })
    const changedPayload = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey: payloadKey,
      body: harness.validBody({ name: 'Changed secret product' }),
    })
    expect(firstPayload.status).toBe(201)
    expectApiError(
      changedPayload,
      409,
      'PRODUCT_CREATE_IDEMPOTENCY_CONFLICT',
    )
    expectSafeError(changedPayload, [payloadKey, 'Changed secret product'])

    const otherCreator = await harness.createAccount({ systemAdmin: true })
    const actorKey = randomUUID()
    const firstActor = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey: actorKey,
      body: harness.validBody(),
    })
    const changedActor = await harness.createProduct({
      browser: otherCreator.browser,
      idempotencyKey: actorKey,
      body: harness.validBody(),
    })
    expect(firstActor.status).toBe(201)
    expectApiError(
      changedActor,
      409,
      'PRODUCT_CREATE_IDEMPOTENCY_CONFLICT',
    )
    expectSafeError(changedActor, [actorKey, harness.supplierValue])
  })

  it('keeps an issuance gap on audit failure and recovers with the same request', async () => {
    const idempotencyKey = randomUUID()
    const baseline = await harness.countCreateState(idempotencyKey)
    const auditSpy = jest.spyOn(harness.audit, 'record')
      .mockRejectedValueOnce(new AuditWriteFailedError())
    const failed = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody(),
    })

    expectApiError(failed, 500, 'INTERNAL_ERROR')
    expectSafeError(failed, [idempotencyKey, harness.supplierValue, '1280.50'])
    expect(await harness.countCreateState(idempotencyKey)).toEqual({
      audits: baseline.audits,
      issuances: baseline.issuances + 1,
      products: baseline.products,
    })

    auditSpy.mockRestore()
    const recovered = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody(),
    })
    expect(recovered.status).toBe(201)
    expect(await harness.countCreateState(idempotencyKey)).toEqual({
      audits: baseline.audits + 1,
      issuances: baseline.issuances + 1,
      products: baseline.products + 1,
    })
  })

  it('commits only one Product, Audit and issuance for concurrent same-key requests', async () => {
    const idempotencyKey = randomUUID()
    const baseline = await harness.countCreateState(idempotencyKey)
    const responses = await Promise.all([
      harness.createProduct({
        browser: harness.creatorBrowser,
        idempotencyKey,
        body: harness.validBody(),
      }),
      harness.createProduct({
        browser: harness.creatorBrowser,
        idempotencyKey,
        body: harness.validBody(),
      }),
    ])

    expect(responses.map(response => response.status)).toEqual([201, 201])
    expect(responses[1]?.body).toEqual(responses[0]?.body)
    expect(await harness.countCreateState(idempotencyKey)).toEqual({
      audits: baseline.audits + 1,
      issuances: baseline.issuances + 1,
      products: baseline.products + 1,
    })
  })

  it('retains the issued number when the supplier changes before the write transaction', async () => {
    const idempotencyKey = randomUUID()
    const baseline = await harness.countCreateState(idempotencyKey)
    const original = harness.dictionaryLookup.requireEffectiveValue
      .bind(harness.dictionaryLookup)
    let callCount = 0
    const lookupSpy = jest.spyOn(
      harness.dictionaryLookup,
      'requireEffectiveValue',
    ).mockImplementation(async (transaction, input) => {
      callCount += 1
      if (callCount === 2) await harness.setSupplierEnabled(false)
      return original(transaction, input)
    })

    const response = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody(),
    })
    lookupSpy.mockRestore()
    await harness.setSupplierEnabled(true)

    expectApiError(response, 422, 'PRODUCT_SUPPLIER_UNAVAILABLE')
    expectSafeError(response, [idempotencyKey, harness.supplierValue])
    expect(await harness.countCreateState(idempotencyKey)).toEqual({
      audits: baseline.audits,
      issuances: baseline.issuances + 1,
      products: baseline.products,
    })
  })

  it('retains the issued number when a currency changes before the write transaction', async () => {
    const idempotencyKey = randomUUID()
    const baseline = await harness.countCreateState(idempotencyKey)
    const original = harness.currencyLookup.requireEnabledCodes
      .bind(harness.currencyLookup)
    let callCount = 0
    const lookupSpy = jest.spyOn(
      harness.currencyLookup,
      'requireEnabledCodes',
    ).mockImplementation(async (transaction, input) => {
      callCount += 1
      if (callCount === 2) await harness.setCurrencyEnabled('TWD', false)
      return original(transaction, input)
    })

    const response = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody(),
    })
    lookupSpy.mockRestore()
    await harness.setCurrencyEnabled('TWD', true)

    expectApiError(response, 422, 'PRODUCT_CURRENCY_UNAVAILABLE')
    expectSafeError(response, [idempotencyKey, harness.supplierValue, '1280.50'])
    expect(await harness.countCreateState(idempotencyKey)).toEqual({
      audits: baseline.audits,
      issuances: baseline.issuances + 1,
      products: baseline.products,
    })
  })

  it('fails closed without issuance when the PRODUCT sequence is exhausted', async () => {
    await harness.exhaustProductRuleCapacity()
    const idempotencyKey = randomUUID()
    const baseline = await harness.countCreateState(idempotencyKey)
    const response = await harness.createProduct({
      browser: harness.creatorBrowser,
      idempotencyKey,
      body: harness.validBody(),
    })

    expectApiError(response, 409, 'PRODUCT_NUMBERING_UNAVAILABLE')
    expectSafeError(response, [idempotencyKey, harness.supplierValue, '1280.50'])
    expect(await harness.countCreateState(idempotencyKey)).toEqual(baseline)
  })
})
