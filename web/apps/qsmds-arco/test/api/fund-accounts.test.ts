import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createFundAccountsApi } from '../../src/api/modules/fund-accounts'

interface Call {
  readonly config?: unknown
  readonly data?: unknown
  readonly method: 'get' | 'patch' | 'post' | 'put'
  readonly url: string
}

function createClientRecorder(): { calls: Call[], client: AxiosInstance } {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    get(url: string, config?: unknown) {
      calls.push({ method: 'get', url, config })
      return response
    },
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'patch', url, data, config })
      return response
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'post', url, data, config })
      return response
    },
    put(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'put', url, data, config })
      return response
    },
  } as unknown as AxiosInstance

  return { calls, client }
}

test('五个资金 GET 使用 generated query、编码路径、AbortSignal 与本地呈错', async () => {
  const fixture = createClientRecorder()
  const fund = createFundAccountsApi(fixture.client)
  const accountController = new AbortController()
  const transactionController = new AbortController()
  const batchController = new AbortController()
  const typeController = new AbortController()
  const sourceController = new AbortController()
  const accountQuery = {
    ownerType: 'USER' as const,
    page: 2,
    pageSize: 50,
    search: '用户 A',
    sortBy: 'balance' as const,
    sortOrder: 'asc' as const,
  }
  const transactionQuery = {
    accountId: 'account-id',
    businessCategory: 'COST' as const,
    businessNo: 'ORDER/0000011',
    businessSourceId: 'source-id',
    direction: 'DEBIT' as const,
    occurredFrom: '2026-08-01T00:00:00.000Z',
    occurredTo: '2026-09-01T00:00:00.000Z',
    page: 3,
    pageSize: 100,
    postingTypeId: 'type-id',
    reversalStatus: 'PARTIAL' as const,
    sortBy: 'postedAt' as const,
    sortOrder: 'desc' as const,
    userId: 'user-id',
  }
  const postingTypeQuery = {
    businessCategory: 'REVENUE' as const,
    enabled: true,
    page: 1,
    pageSize: 20,
    search: '订单',
    sortBy: 'code' as const,
    sortOrder: 'asc' as const,
  }
  const businessSourceQuery = {
    enabled: false,
    page: 4,
    pageSize: 20,
    search: '管理员',
    sortBy: 'name' as const,
    sortOrder: 'desc' as const,
  }

  await fund.accounts.list(accountQuery, accountController.signal)
  await fund.transactions.list(transactionQuery, transactionController.signal)
  await fund.batches.get('batch/id with spaces', batchController.signal)
  await fund.postingTypes.list(postingTypeQuery, typeController.signal)
  await fund.businessSources.list(
    businessSourceQuery,
    sourceController.signal,
  )

  assert.deepEqual(fixture.calls, [
    {
      method: 'get',
      url: 'fund-accounts',
      config: {
        errorPresentation: 'local',
        params: accountQuery,
        signal: accountController.signal,
      },
    },
    {
      method: 'get',
      url: 'fund-transactions',
      config: {
        errorPresentation: 'local',
        params: transactionQuery,
        signal: transactionController.signal,
      },
    },
    {
      method: 'get',
      url: 'fund-posting-batches/batch%2Fid%20with%20spaces',
      config: {
        errorPresentation: 'local',
        signal: batchController.signal,
      },
    },
    {
      method: 'get',
      url: 'fund-posting-types',
      config: {
        errorPresentation: 'local',
        params: postingTypeQuery,
        signal: typeController.signal,
      },
    },
    {
      method: 'get',
      url: 'fund-business-sources',
      config: {
        errorPresentation: 'local',
        params: businessSourceQuery,
        signal: sourceController.signal,
      },
    },
  ])
})

test('十四个资金 mutation 均本地呈错且禁止自动重试', async () => {
  const fixture = createClientRecorder()
  const fund = createFundAccountsApi(fixture.client)
  const createAccount = { userId: 'user-id', userShareRate: '30.0000' }
  const shareRate = {
    expectedVersion: 3,
    reason: '调整未来业务分成',
    userShareRate: '45.0000',
  }
  const adjustment = {
    adjustmentMode: 'USER_AND_COMPANY_BY_SHARE' as const,
    amount: '-100.0000',
    metadata: { operatorNote: 'ticket-1' },
    reason: '管理员纠正余额',
  }
  const reversal = { amount: '40.0000', reason: '原订单重复结算' }
  const ruleLeg = {
    accountTarget: 'COMPANY' as const,
    amountStrategy: 'FULL_AMOUNT' as const,
    directionPolicy: 'DEBIT' as const,
    position: 1,
  }
  const createPostingType = {
    amountSignPolicy: 'POSITIVE_ONLY' as const,
    businessCategory: 'COST' as const,
    code: 'CUSTOM_FEE',
    description: null,
    legs: [ruleLeg],
    name: '自定义费用',
    requiresUser: false,
  }
  const updatePostingType = {
    description: '更新说明',
    expectedVersion: 4,
    name: '自定义成本',
  }
  const replaceRule = { expectedVersion: 4, legs: [ruleLeg] }
  const publishRule = { draftRuleVersionId: 'draft-id', expectedVersion: 5 }
  const status = { expectedVersion: 6 }
  const createSource = {
    allowedPostingTypeIds: ['posting-type-id'],
    code: 'ORDER_DOMAIN',
    description: null,
    enabled: true,
    name: '订单域',
  }
  const updateSource = {
    allowedPostingTypeIds: ['posting-type-id'],
    description: '订单结算调用来源',
    expectedVersion: 7,
    name: '订单业务域',
  }

  await fund.accounts.create(createAccount)
  await fund.accounts.updateShareRate('account/id', shareRate)
  await fund.accounts.manualAdjust('account/id', adjustment, 'adjust-key')
  await fund.batches.reverse('batch/id', reversal, 'reversal-key')
  await fund.postingTypes.create(createPostingType)
  await fund.postingTypes.update('type/id', updatePostingType)
  await fund.postingTypes.replaceDraftRule('type/id', replaceRule)
  await fund.postingTypes.publish('type/id', publishRule)
  await fund.postingTypes.enable('type/id', status)
  await fund.postingTypes.disable('type/id', status)
  await fund.businessSources.create(createSource)
  await fund.businessSources.update('source/id', updateSource)
  await fund.businessSources.enable('source/id', status)
  await fund.businessSources.disable('source/id', status)

  const localMutationConfig = {
    errorPresentation: 'local',
    retry: false,
  }
  assert.deepEqual(fixture.calls, [
    {
      method: 'post',
      url: 'fund-accounts',
      data: createAccount,
      config: localMutationConfig,
    },
    {
      method: 'patch',
      url: 'fund-accounts/account%2Fid/share-rate',
      data: shareRate,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'fund-accounts/account%2Fid/manual-adjustments',
      data: adjustment,
      config: {
        ...localMutationConfig,
        headers: { 'Idempotency-Key': 'adjust-key' },
      },
    },
    {
      method: 'post',
      url: 'fund-posting-batches/batch%2Fid/reversals',
      data: reversal,
      config: {
        ...localMutationConfig,
        headers: { 'Idempotency-Key': 'reversal-key' },
      },
    },
    {
      method: 'post',
      url: 'fund-posting-types',
      data: createPostingType,
      config: localMutationConfig,
    },
    {
      method: 'patch',
      url: 'fund-posting-types/type%2Fid',
      data: updatePostingType,
      config: localMutationConfig,
    },
    {
      method: 'put',
      url: 'fund-posting-types/type%2Fid/draft-rule',
      data: replaceRule,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'fund-posting-types/type%2Fid/publish',
      data: publishRule,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'fund-posting-types/type%2Fid/enable',
      data: status,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'fund-posting-types/type%2Fid/disable',
      data: status,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'fund-business-sources',
      data: createSource,
      config: localMutationConfig,
    },
    {
      method: 'patch',
      url: 'fund-business-sources/source%2Fid',
      data: updateSource,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'fund-business-sources/source%2Fid/enable',
      data: status,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'fund-business-sources/source%2Fid/disable',
      data: status,
      config: localMutationConfig,
    },
  ])
})

test('资金 adapter 不暴露删除或远程业务动账入口', () => {
  const fund = createFundAccountsApi(createClientRecorder().client)

  assert.equal('delete' in fund.accounts, false)
  assert.equal('postBusinessTransaction' in fund, false)
  assert.equal('delete' in fund.postingTypes, false)
  assert.equal('delete' in fund.businessSources, false)
})
