import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createNumberingApi } from '../../src/api/modules/numbering'

interface Call {
  method: 'get' | 'patch' | 'post'
  url: string
  data?: unknown
  config?: unknown
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
  } as unknown as AxiosInstance

  return { calls, client }
}

test('编号规则四个 GET 固定 query、URL 编码、AbortSignal 与本地错误展示', async () => {
  const fixture = createClientRecorder()
  const numbering = createNumberingApi(fixture.client)
  const listController = new AbortController()
  const detailController = new AbortController()
  const versionsController = new AbortController()
  const issuancesController = new AbortController()
  const listQuery = {
    page: 2,
    pageSize: 50,
    keyword: '销售订单',
    status: 'ENABLED' as const,
    sortBy: 'updatedAt' as const,
    sortOrder: 'desc' as const,
  }
  const versionsQuery = { page: 1, pageSize: 20 }
  const issuancesQuery = {
    page: 3,
    pageSize: 100,
    periodKey: '20260802',
    consumerCode: 'ORDER.CREATE',
    generatedNumber: 'SO20260802',
    generatedNumberMatch: 'PREFIX' as const,
  }

  await numbering.rules.list(listQuery, listController.signal)
  await numbering.rules.get(
    'rule/id with spaces',
    detailController.signal,
  )
  await numbering.rules.versions(
    'rule/id with spaces',
    versionsQuery,
    versionsController.signal,
  )
  await numbering.rules.issuances(
    'rule/id with spaces',
    issuancesQuery,
    issuancesController.signal,
  )

  assert.deepEqual(fixture.calls, [
    {
      method: 'get',
      url: 'numbering-rules',
      config: {
        errorPresentation: 'local',
        params: listQuery,
        signal: listController.signal,
      },
    },
    {
      method: 'get',
      url: 'numbering-rules/rule%2Fid%20with%20spaces',
      config: {
        errorPresentation: 'local',
        signal: detailController.signal,
      },
    },
    {
      method: 'get',
      url: 'numbering-rules/rule%2Fid%20with%20spaces/versions',
      config: {
        errorPresentation: 'local',
        params: versionsQuery,
        signal: versionsController.signal,
      },
    },
    {
      method: 'get',
      url: 'numbering-rules/rule%2Fid%20with%20spaces/issuances',
      config: {
        errorPresentation: 'local',
        params: issuancesQuery,
        signal: issuancesController.signal,
      },
    },
  ])
})

test('preview/create/update/clone/publish/enable/disable 均本地呈错且禁止自动重试', async () => {
  const fixture = createClientRecorder()
  const numbering = createNumberingApi(fixture.client)
  const previewController = new AbortController()
  const segments = [{
    type: 'SEQUENCE' as const,
    width: 18,
    startValue: '9007199254740993',
    step: '2',
  }]
  const previewPayload = {
    resetPolicy: 'NEVER' as const,
    segments,
    ruleId: 'rule-id',
  }
  const createPayload = {
    resetPolicy: 'NEVER' as const,
    segments,
    ruleCode: 'SALES_ORDER',
    name: '销售订单',
    description: null,
  }
  const updatePayload = {
    resetPolicy: 'NEVER' as const,
    segments,
    name: '销售订单号',
    description: null,
    expectedVersion: 7,
  }
  const clonePayload = {
    expectedVersion: 7,
    ruleCode: 'SALES_ORDER_COPY',
    name: '销售订单副本',
    description: null,
  }
  const publishPayload = { expectedVersion: 7, draftRevision: 3 }
  const statusPayload = { expectedVersion: 8 }

  await numbering.rules.preview(previewPayload, previewController.signal)
  await numbering.rules.create(createPayload)
  await numbering.rules.update('rule/id', updatePayload)
  await numbering.rules.clone('rule/id', clonePayload)
  await numbering.rules.publish('rule/id', publishPayload)
  await numbering.rules.enable('rule/id', statusPayload)
  await numbering.rules.disable('rule/id', statusPayload)

  const localMutationConfig = {
    errorPresentation: 'local',
    retry: false,
  }
  assert.deepEqual(fixture.calls, [
    {
      method: 'post',
      url: 'numbering-rules/preview',
      data: previewPayload,
      config: {
        ...localMutationConfig,
        signal: previewController.signal,
      },
    },
    {
      method: 'post',
      url: 'numbering-rules',
      data: createPayload,
      config: localMutationConfig,
    },
    {
      method: 'patch',
      url: 'numbering-rules/rule%2Fid',
      data: updatePayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'numbering-rules/rule%2Fid/clone',
      data: clonePayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'numbering-rules/rule%2Fid/publish',
      data: publishPayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'numbering-rules/rule%2Fid/enable',
      data: statusPayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'numbering-rules/rule%2Fid/disable',
      data: statusPayload,
      config: localMutationConfig,
    },
  ])
  assert.equal(typeof segments[0]?.startValue, 'string')
  assert.equal(segments[0]?.startValue, '9007199254740993')
  assert.equal('delete' in numbering.rules, false)
})
