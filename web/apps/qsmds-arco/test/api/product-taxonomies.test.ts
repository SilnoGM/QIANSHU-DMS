import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 产品分类 API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createProductTaxonomiesApi } from '../../src/api/modules/product-taxonomies'

interface Call {
  readonly data?: unknown
  readonly method: 'delete' | 'get' | 'patch' | 'post'
  readonly url: string
}

test('产品分类 API 使用稳定资源路径、Supplier scoped query 与禁止自动重试', async () => {
  const calls: Call[] = []
  const response = Promise.resolve({ data: {} })
  const client = {
    delete(url: string, config?: unknown) {
      calls.push({ config, method: 'delete', url })
      return response
    },
    get(url: string, config?: unknown) {
      calls.push({ config, method: 'get', url })
      return response
    },
    patch(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'patch', url })
      return response
    },
    post(url: string, data?: unknown, config?: unknown) {
      calls.push({ config, data, method: 'post', url })
      return response
    },
  } as unknown as AxiosInstance
  const api = createProductTaxonomiesApi(client)
  const controller = new AbortController()
  const categoryId = '11111111-1111-4111-8111-111111111111'
  const headId = '22222222-2222-4222-8222-222222222222'

  await api.listCategories({ supplierValue: 'SUPPLIER_A' }, controller.signal)
  await api.createCategory({ name: '分类', supplierValue: 'SUPPLIER_A' }, controller.signal)
  await api.renameCategory(categoryId, { name: '新分类' }, controller.signal)
  await api.moveCategory(categoryId, { direction: 'down' }, controller.signal)
  await api.deleteCategory(categoryId, controller.signal)
  await api.createHead({ categoryId, name: '产品头' }, controller.signal)
  await api.renameHead(headId, { name: '新产品头' }, controller.signal)
  await api.moveHead(headId, { direction: 'up' }, controller.signal)
  await api.deleteHead(headId, controller.signal)

  assert.deepEqual(calls, [
    {
      config: {
        errorPresentation: 'local',
        params: { supplierValue: 'SUPPLIER_A' },
        signal: controller.signal,
      },
      method: 'get',
      url: 'product-categories',
    },
    {
      config: { errorPresentation: 'local', retry: false, signal: controller.signal },
      data: { name: '分类', supplierValue: 'SUPPLIER_A' },
      method: 'post',
      url: 'product-categories',
    },
    {
      config: { errorPresentation: 'local', retry: false, signal: controller.signal },
      data: { name: '新分类' },
      method: 'patch',
      url: `product-categories/${categoryId}`,
    },
    {
      config: { errorPresentation: 'local', retry: false, signal: controller.signal },
      data: { direction: 'down' },
      method: 'patch',
      url: `product-categories/${categoryId}/move`,
    },
    {
      config: { errorPresentation: 'local', retry: false, signal: controller.signal },
      method: 'delete',
      url: `product-categories/${categoryId}`,
    },
    {
      config: { errorPresentation: 'local', retry: false, signal: controller.signal },
      data: { categoryId, name: '产品头' },
      method: 'post',
      url: 'product-heads',
    },
    {
      config: { errorPresentation: 'local', retry: false, signal: controller.signal },
      data: { name: '新产品头' },
      method: 'patch',
      url: `product-heads/${headId}`,
    },
    {
      config: { errorPresentation: 'local', retry: false, signal: controller.signal },
      data: { direction: 'up' },
      method: 'patch',
      url: `product-heads/${headId}/move`,
    },
    {
      config: { errorPresentation: 'local', retry: false, signal: controller.signal },
      method: 'delete',
      url: `product-heads/${headId}`,
    },
  ])
})
