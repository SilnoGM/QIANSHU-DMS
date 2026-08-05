import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createSuppliersApi } from '../../src/api/modules/suppliers'

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

test('供应商两个 GET 固定 query、URL 编码、AbortSignal 与本地错误展示', async () => {
  const fixture = createClientRecorder()
  const suppliers = createSuppliersApi(fixture.client)
  const listController = new AbortController()
  const detailController = new AbortController()
  const query = {
    page: 2,
    pageSize: 50,
    query: '千树',
    status: 'ENABLED' as const,
    entityType: 'ORGANIZATION' as const,
    sortBy: 'updatedAt' as const,
    sortOrder: 'desc' as const,
  }

  await suppliers.list(query, listController.signal)
  await suppliers.get('supplier/id with spaces', detailController.signal)

  assert.deepEqual(fixture.calls, [
    {
      method: 'get',
      url: 'suppliers',
      config: {
        errorPresentation: 'local',
        params: query,
        signal: listController.signal,
      },
    },
    {
      method: 'get',
      url: 'suppliers/supplier%2Fid%20with%20spaces',
      config: {
        errorPresentation: 'local',
        signal: detailController.signal,
      },
    },
  ])
})

test('供应商创建显式传 Idempotency-Key，四个 mutation 均禁止自动重试', async () => {
  const fixture = createClientRecorder()
  const suppliers = createSuppliersApi(fixture.client)
  const createPayload = {
    legalName: '千树供方',
    entityType: 'ORGANIZATION' as const,
    primaryContact: {
      name: '联系人',
      phone: null,
      wechatId: 'qianshu',
    },
  }
  const updatePayload = {
    expectedVersion: 2,
    remark: null,
  }
  const statusPayload = { expectedVersion: 3 }
  const idempotencyKey = '2f1adcbc-5d63-4f0f-9a9f-265d4c823241'

  await suppliers.create(createPayload, idempotencyKey)
  await suppliers.update('supplier/id', updatePayload)
  await suppliers.enable('supplier/id', statusPayload)
  await suppliers.disable('supplier/id', statusPayload)

  const localMutationConfig = {
    errorPresentation: 'local',
    retry: false,
  }
  assert.deepEqual(fixture.calls, [
    {
      method: 'post',
      url: 'suppliers',
      data: createPayload,
      config: {
        ...localMutationConfig,
        headers: { 'Idempotency-Key': idempotencyKey },
      },
    },
    {
      method: 'patch',
      url: 'suppliers/supplier%2Fid',
      data: updatePayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'suppliers/supplier%2Fid/enable',
      data: statusPayload,
      config: localMutationConfig,
    },
    {
      method: 'post',
      url: 'suppliers/supplier%2Fid/disable',
      data: statusPayload,
      config: localMutationConfig,
    },
  ])
  assert.equal('delete' in suppliers, false)
  assert.equal('catalog' in suppliers, false)
  assert.equal('generate' in suppliers, false)
})
