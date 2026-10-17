import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { FundAccountCommandService } from './application/fund-account-command.service'
import { FundAccountQueryService } from './application/fund-account-query.service'
import { FundConfigurationCommandService } from './application/fund-configuration-command.service'
import { FundConfigurationQueryService } from './application/fund-configuration-query.service'
import { FundPostingApplicationService } from './application/fund-posting.service'
import { FundTransactionQueryService } from './application/fund-transaction-query.service'
import { FundAccountsController } from './fund-accounts.controller'
import { FundBusinessSourcesController } from './fund-business-sources.controller'
import { FundPostingTypesController } from './fund-posting-types.controller'
import { FundTransactionsController } from './fund-transactions.controller'

@Module({
  controllers: [
    FundAccountsController,
    FundTransactionsController,
    FundPostingTypesController,
    FundBusinessSourcesController,
  ],
  providers: [
    { provide: FundAccountQueryService, useValue: {} },
    { provide: FundAccountCommandService, useValue: {} },
    { provide: FundPostingApplicationService, useValue: {} },
    { provide: FundTransactionQueryService, useValue: {} },
    { provide: FundConfigurationQueryService, useValue: {} },
    { provide: FundConfigurationCommandService, useValue: {} },
  ],
})
class FundAccountsControllerContractModule {}

type HttpMethod = 'get' | 'patch' | 'post' | 'put'

const OPERATIONS = [
  ['get', '/api/fund-accounts', 'fund_accounts_list'],
  [
    'get',
    '/api/fund-accounts/owner-candidates',
    'fund_accounts_owner_candidates',
  ],
  ['post', '/api/fund-accounts', 'fund_accounts_create'],
  [
    'patch',
    '/api/fund-accounts/{accountId}/share-rate',
    'fund_accounts_update_share_rate',
  ],
  [
    'post',
    '/api/fund-accounts/{accountId}/manual-adjustments',
    'fund_accounts_manual_adjust',
  ],
  ['get', '/api/fund-transactions', 'fund_transactions_list'],
  [
    'get',
    '/api/fund-posting-batches/{batchId}',
    'fund_posting_batches_get_by_id',
  ],
  [
    'post',
    '/api/fund-posting-batches/{batchId}/reversals',
    'fund_posting_batches_reverse',
  ],
  ['get', '/api/fund-posting-types', 'fund_posting_types_list'],
  ['post', '/api/fund-posting-types', 'fund_posting_types_create'],
  [
    'patch',
    '/api/fund-posting-types/{postingTypeId}',
    'fund_posting_types_update',
  ],
  [
    'put',
    '/api/fund-posting-types/{postingTypeId}/draft-rule',
    'fund_posting_types_replace_draft_rule',
  ],
  [
    'post',
    '/api/fund-posting-types/{postingTypeId}/publish',
    'fund_posting_types_publish',
  ],
  [
    'post',
    '/api/fund-posting-types/{postingTypeId}/enable',
    'fund_posting_types_enable',
  ],
  [
    'post',
    '/api/fund-posting-types/{postingTypeId}/disable',
    'fund_posting_types_disable',
  ],
  ['get', '/api/fund-business-sources', 'fund_business_sources_list'],
  ['post', '/api/fund-business-sources', 'fund_business_sources_create'],
  [
    'patch',
    '/api/fund-business-sources/{businessSourceId}',
    'fund_business_sources_update',
  ],
  [
    'post',
    '/api/fund-business-sources/{businessSourceId}/enable',
    'fund_business_sources_enable',
  ],
  [
    'post',
    '/api/fund-business-sources/{businessSourceId}/disable',
    'fund_business_sources_disable',
  ],
] as const satisfies readonly (readonly [HttpMethod, string, string])[]

const STATUS_BY_OPERATION: Readonly<Record<string, readonly string[]>> = {
  fund_accounts_list: ['200', '400', '401', '403', '422', '500'],
  fund_accounts_owner_candidates: ['200', '400', '401', '403', '422', '500'],
  fund_accounts_create: ['201', '400', '401', '403', '404', '409', '422', '500'],
  fund_accounts_update_share_rate: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_accounts_manual_adjust: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_transactions_list: ['200', '400', '401', '403', '422', '500'],
  fund_posting_batches_get_by_id: ['200', '400', '401', '403', '404', '422', '500'],
  fund_posting_batches_reverse: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_posting_types_list: ['200', '400', '401', '403', '422', '500'],
  fund_posting_types_create: ['201', '400', '401', '403', '409', '422', '500'],
  fund_posting_types_update: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_posting_types_replace_draft_rule: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_posting_types_publish: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_posting_types_enable: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_posting_types_disable: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_business_sources_list: ['200', '400', '401', '403', '422', '500'],
  fund_business_sources_create: ['201', '400', '401', '403', '404', '409', '422', '500'],
  fund_business_sources_update: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_business_sources_enable: ['200', '400', '401', '403', '404', '409', '422', '500'],
  fund_business_sources_disable: ['200', '400', '401', '403', '404', '409', '422', '500'],
}

interface ContractErrorExpectation {
  readonly status: number
  readonly codes: readonly string[]
}

const READ_FORBIDDEN_ERROR = {
  status: 403,
  codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const
const WRITE_FORBIDDEN_ERROR = {
  status: 403,
  codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
} as const
const VALIDATION_ERROR = {
  status: 422,
  codes: ['FUND_VALIDATION_FAILED', 'VALIDATION_FAILED'],
} as const
const READ_ERRORS = [READ_FORBIDDEN_ERROR, VALIDATION_ERROR] as const

const ERRORS_BY_OPERATION: Readonly<
  Record<string, readonly ContractErrorExpectation[]>
> = {
  fund_accounts_list: READ_ERRORS,
  fund_accounts_owner_candidates: READ_ERRORS,
  fund_accounts_create: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_USER_NOT_FOUND'] },
    { status: 409, codes: ['FUND_ACCOUNT_ALREADY_EXISTS'] },
    {
      status: 422,
      codes: [
        'FUND_SHARE_RATE_INVALID',
        'FUND_VALIDATION_FAILED',
        'VALIDATION_FAILED',
      ],
    },
  ],
  fund_accounts_update_share_rate: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_ACCOUNT_NOT_FOUND'] },
    {
      status: 409,
      codes: ['FUND_ACCOUNT_STATE_CHANGED', 'FUND_ACCOUNT_UNAVAILABLE'],
    },
    {
      status: 422,
      codes: [
        'FUND_SHARE_RATE_INVALID',
        'FUND_VALIDATION_FAILED',
        'VALIDATION_FAILED',
      ],
    },
  ],
  fund_accounts_manual_adjust: [
    WRITE_FORBIDDEN_ERROR,
    {
      status: 404,
      codes: [
        'FUND_ACCOUNT_NOT_FOUND',
        'FUND_BUSINESS_SOURCE_NOT_FOUND',
        'FUND_POSTING_TYPE_NOT_FOUND',
      ],
    },
    {
      status: 409,
      codes: [
        'FUND_ACCOUNT_UNAVAILABLE',
        'FUND_BUSINESS_SOURCE_DISABLED',
        'FUND_COMPANY_ACCOUNT_UNAVAILABLE',
        'FUND_CONCURRENT_STATE_CHANGED',
        'FUND_IDEMPOTENCY_CONFLICT',
        'FUND_POSTING_NUMBERING_UNAVAILABLE',
        'FUND_POSTING_RULE_UNAVAILABLE',
        'FUND_POSTING_TYPE_DISABLED',
        'FUND_POSTING_TYPE_NOT_ALLOWED',
      ],
    },
    {
      status: 422,
      codes: [
        'FUND_ADJUSTMENT_MODE_INVALID',
        'FUND_METADATA_INVALID',
        'FUND_POSTING_AMOUNT_INVALID',
        'FUND_POSTING_RULE_INVALID',
        'FUND_VALIDATION_FAILED',
        'VALIDATION_FAILED',
      ],
    },
  ],
  fund_transactions_list: READ_ERRORS,
  fund_posting_batches_get_by_id: [
    READ_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_POSTING_BATCH_NOT_FOUND'] },
    VALIDATION_ERROR,
  ],
  fund_posting_batches_reverse: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_POSTING_BATCH_NOT_FOUND'] },
    {
      status: 409,
      codes: [
        'FUND_ACCOUNT_UNAVAILABLE',
        'FUND_CONCURRENT_STATE_CHANGED',
        'FUND_IDEMPOTENCY_CONFLICT',
        'FUND_POSTING_NUMBERING_UNAVAILABLE',
        'FUND_REVERSAL_REQUIRES_RECEIPT_VOID',
        'FUND_REVERSAL_STATE_CHANGED',
      ],
    },
    {
      status: 422,
      codes: [
        'FUND_POSTING_AMOUNT_INVALID',
        'FUND_REVERSAL_EXCEEDS_REMAINING',
        'FUND_REVERSAL_TARGET_INVALID',
        'FUND_VALIDATION_FAILED',
        'VALIDATION_FAILED',
      ],
    },
  ],
  fund_posting_types_list: READ_ERRORS,
  fund_posting_types_create: [
    WRITE_FORBIDDEN_ERROR,
    { status: 409, codes: ['FUND_POSTING_TYPE_CODE_ALREADY_EXISTS'] },
    {
      status: 422,
      codes: [
        'FUND_POSTING_RULE_INVALID',
        'FUND_VALIDATION_FAILED',
        'VALIDATION_FAILED',
      ],
    },
  ],
  fund_posting_types_update: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_POSTING_TYPE_NOT_FOUND'] },
    { status: 409, codes: ['FUND_CONFIG_STATE_CHANGED'] },
    VALIDATION_ERROR,
  ],
  fund_posting_types_replace_draft_rule: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_POSTING_TYPE_NOT_FOUND'] },
    { status: 409, codes: ['FUND_CONFIG_STATE_CHANGED'] },
    {
      status: 422,
      codes: [
        'FUND_POSTING_RULE_INVALID',
        'FUND_VALIDATION_FAILED',
        'VALIDATION_FAILED',
      ],
    },
  ],
  fund_posting_types_publish: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_POSTING_TYPE_NOT_FOUND'] },
    {
      status: 409,
      codes: ['FUND_CONFIG_STATE_CHANGED', 'FUND_POSTING_RULE_UNAVAILABLE'],
    },
    {
      status: 422,
      codes: [
        'FUND_POSTING_RULE_INVALID',
        'FUND_VALIDATION_FAILED',
        'VALIDATION_FAILED',
      ],
    },
  ],
  fund_posting_types_enable: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_POSTING_TYPE_NOT_FOUND'] },
    {
      status: 409,
      codes: ['FUND_CONFIG_STATE_CHANGED', 'FUND_POSTING_RULE_UNAVAILABLE'],
    },
    VALIDATION_ERROR,
  ],
  fund_posting_types_disable: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_POSTING_TYPE_NOT_FOUND'] },
    { status: 409, codes: ['FUND_CONFIG_STATE_CHANGED'] },
    VALIDATION_ERROR,
  ],
  fund_business_sources_list: READ_ERRORS,
  fund_business_sources_create: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_POSTING_TYPE_NOT_FOUND'] },
    { status: 409, codes: ['FUND_BUSINESS_SOURCE_CODE_ALREADY_EXISTS'] },
    VALIDATION_ERROR,
  ],
  fund_business_sources_update: [
    WRITE_FORBIDDEN_ERROR,
    {
      status: 404,
      codes: [
        'FUND_BUSINESS_SOURCE_NOT_FOUND',
        'FUND_POSTING_TYPE_NOT_FOUND',
      ],
    },
    { status: 409, codes: ['FUND_CONFIG_STATE_CHANGED'] },
    VALIDATION_ERROR,
  ],
  fund_business_sources_enable: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_BUSINESS_SOURCE_NOT_FOUND'] },
    { status: 409, codes: ['FUND_CONFIG_STATE_CHANGED'] },
    VALIDATION_ERROR,
  ],
  fund_business_sources_disable: [
    WRITE_FORBIDDEN_ERROR,
    { status: 404, codes: ['FUND_BUSINESS_SOURCE_NOT_FOUND'] },
    { status: 409, codes: ['FUND_CONFIG_STATE_CHANGED'] },
    VALIDATION_ERROR,
  ],
}

function requireOperation(
  document: OpenAPIObject,
  method: HttpMethod,
  path: string,
): NonNullable<OpenAPIObject['paths'][string]['get']> & {
  'x-qianshu-contract'?: unknown
} {
  const operation = document.paths[path]?.[method]
  if (!operation) throw new Error(`Missing ${method.toUpperCase()} ${path}`)
  return operation
}

describe('Fund account management OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(
      FundAccountsControllerContractModule,
    )
  })

  it.each(OPERATIONS)(
    'publishes %s %s as %s',
    (method, path, operationId) => {
      const operation = requireOperation(document, method, path)

      expect(operation.operationId).toBe(operationId)
      expect(operation.security).toEqual([{ sessionCookie: [] }])
      expect(operation['x-qianshu-contract']).toMatchObject({
        kind: 'application',
        authentication: true,
        authorization: true,
        privateNoStore: true,
        session: 'required',
      })
      expect(Object.keys(operation.responses).sort()).toEqual(
        STATUS_BY_OPERATION[operationId],
      )
      const contract = operation['x-qianshu-contract'] as {
        csrf?: boolean
        retry?: boolean
      }
      if (method === 'get') {
        expect(contract.csrf).toBeUndefined()
        expect(contract.retry).toBeUndefined()
      }
      else {
        expect(contract.csrf).toBe(true)
        expect(contract.retry).toBe(false)
      }
      for (const response of Object.values(operation.responses)) {
        if (response && !('$ref' in response)) {
          expect(response.headers).toMatchObject({
            'Cache-Control': {
              schema: { enum: ['private, no-store'] },
            },
            'X-Request-Id': {
              schema: { type: 'string' },
            },
          })
        }
      }
    },
  )

  it('contains no remote business posting or DELETE operation', () => {
    const serialized = JSON.stringify(document)

    expect(serialized).not.toContain('postBusinessEvent')
    expect(serialized).not.toContain('fund_postings_create')
    for (const pathItem of Object.values(document.paths)) {
      expect(pathItem?.delete).toBeUndefined()
    }
  })

  it.each(OPERATIONS)(
    'publishes the exact local error matrix for %s %s',
    (method, path, operationId) => {
      const operation = requireOperation(document, method, path)
      const contract = operation['x-qianshu-contract'] as {
        errors?: readonly ContractErrorExpectation[]
      }

      expect(contract.errors).toEqual(ERRORS_BY_OPERATION[operationId])
    },
  )

  it('publishes Idempotency-Key only for manual adjustment and reversal', () => {
    const idempotentOperations = [
      requireOperation(
        document,
        'post',
        '/api/fund-accounts/{accountId}/manual-adjustments',
      ),
      requireOperation(
        document,
        'post',
        '/api/fund-posting-batches/{batchId}/reversals',
      ),
    ]

    for (const operation of idempotentOperations) {
      expect(operation.parameters).toEqual(expect.arrayContaining([
        expect.objectContaining({
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
        }),
      ]))
      expect(JSON.stringify(operation.requestBody)).not.toContain(
        'idempotencyKey',
      )
    }

    for (const [method, path] of OPERATIONS) {
      const operation = requireOperation(document, method, path)
      if (idempotentOperations.includes(operation)) continue
      expect(operation.parameters).not.toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'Idempotency-Key' }),
      ]))
    }
  })
})

describe('Fund account management permissions', () => {
  const reflector = new Reflector()

  it.each([
    [FundAccountsController, 'list', 'fund-accounts:read'],
    [FundAccountsController, 'ownerCandidates', 'fund-accounts:read'],
    [FundAccountsController, 'create', 'fund-accounts:create'],
    [FundAccountsController, 'updateShareRate', 'fund-accounts:update-share-rate'],
    [FundAccountsController, 'manualAdjust', 'fund-accounts:manual-adjust'],
    [FundTransactionsController, 'list', 'fund-accounts:read'],
    [FundTransactionsController, 'getBatch', 'fund-accounts:read'],
    [FundTransactionsController, 'reverse', 'fund-transactions:reverse'],
    [FundPostingTypesController, 'list', 'fund-posting-types:manage'],
    [FundPostingTypesController, 'create', 'fund-posting-types:manage'],
    [FundPostingTypesController, 'update', 'fund-posting-types:manage'],
    [FundPostingTypesController, 'replaceDraftRule', 'fund-posting-types:manage'],
    [FundPostingTypesController, 'publish', 'fund-posting-types:manage'],
    [FundPostingTypesController, 'enable', 'fund-posting-types:manage'],
    [FundPostingTypesController, 'disable', 'fund-posting-types:manage'],
    [FundBusinessSourcesController, 'list', 'fund-business-sources:manage'],
    [FundBusinessSourcesController, 'create', 'fund-business-sources:manage'],
    [FundBusinessSourcesController, 'update', 'fund-business-sources:manage'],
    [FundBusinessSourcesController, 'enable', 'fund-business-sources:manage'],
    [FundBusinessSourcesController, 'disable', 'fund-business-sources:manage'],
  ] as const)(
    '%s.%s requires only %s',
    (controller, method, permission) => {
      const target = (
        controller.prototype as unknown as Record<string, unknown>
      )[method]
      if (typeof target !== 'function') {
        throw new Error(`Missing controller method: ${method}`)
      }
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        target,
      )).toEqual([permission])
    },
  )
})
