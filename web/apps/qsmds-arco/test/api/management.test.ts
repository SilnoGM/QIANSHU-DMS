import type { AxiosInstance } from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web API 契约测试使用 Node.js 内置 runner。
import test from 'node:test'

import { createManagementApi } from '../../src/api/modules/management'

interface Call {
  method: 'get' | 'patch' | 'post' | 'put'
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
    put(url: string, data?: unknown, config?: unknown) {
      calls.push({ method: 'put', url, data, config })
      return response
    },
  } as unknown as AxiosInstance

  return { calls, client }
}

test('用户管理 API 使用 OpenAPI 路径并禁止密码写请求自动重试', async () => {
  const fixture = createClientRecorder()
  const api = createManagementApi(fixture.client)

  await api.users.list({ page: 2, pageSize: 20, username: 'operator' })
  await api.users.create({
    username: 'operator',
    displayName: '操作员',
    password: 'secret input',
    mustChangePassword: true,
  })
  await api.users.get('user-id')
  await api.users.update('user-id', { displayName: '新名称' })
  await api.users.enable('user-id')
  await api.users.disable('user-id')
  await api.users.replaceRoles('user-id', { roleIds: ['role-id'] })
  await api.users.resetPassword('user-id', {
    newPassword: 'new secret input',
    mustChangePassword: false,
  })

  assert.deepEqual(fixture.calls, [
    {
      method: 'get',
      url: 'users',
      config: { params: { page: 2, pageSize: 20, username: 'operator' } },
    },
    {
      method: 'post',
      url: 'users',
      data: {
        username: 'operator',
        displayName: '操作员',
        password: 'secret input',
        mustChangePassword: true,
      },
      config: { errorPresentation: 'local', retry: false },
    },
    { method: 'get', url: 'users/user-id', config: undefined },
    {
      method: 'patch',
      url: 'users/user-id',
      data: { displayName: '新名称' },
      config: { errorPresentation: 'local' },
    },
    { method: 'post', url: 'users/user-id/enable', data: {}, config: { errorPresentation: 'local' } },
    { method: 'post', url: 'users/user-id/disable', data: {}, config: { errorPresentation: 'local' } },
    {
      method: 'put',
      url: 'users/user-id/roles',
      data: { roleIds: ['role-id'] },
      config: { errorPresentation: 'local' },
    },
    {
      method: 'post',
      url: 'users/user-id/password-reset',
      data: {
        newPassword: 'new secret input',
        mustChangePassword: false,
      },
      config: { errorPresentation: 'local', retry: false },
    },
  ])
})

test('角色、权限目录和审计 API 使用稳定 method、path 与分页参数', async () => {
  const fixture = createClientRecorder()
  const api = createManagementApi(fixture.client)

  await api.roles.list()
  await api.roles.create({ code: 'warehouse_reader', name: '仓库只读' })
  await api.roles.get('role-id')
  await api.roles.update('role-id', { name: '仓库资料员' })
  await api.roles.replacePermissions('role-id', {
    permissionIds: ['permission-id'],
  })
  await api.permissions.list()
  await api.auditEvents.list({ page: 3, pageSize: 50 })

  assert.deepEqual(fixture.calls, [
    { method: 'get', url: 'roles', config: undefined },
    {
      method: 'post',
      url: 'roles',
      data: { code: 'warehouse_reader', name: '仓库只读' },
      config: { errorPresentation: 'local' },
    },
    { method: 'get', url: 'roles/role-id', config: undefined },
    {
      method: 'patch',
      url: 'roles/role-id',
      data: { name: '仓库资料员' },
      config: { errorPresentation: 'local' },
    },
    {
      method: 'put',
      url: 'roles/role-id/permissions',
      data: { permissionIds: ['permission-id'] },
      config: { errorPresentation: 'local' },
    },
    { method: 'get', url: 'permissions', config: undefined },
    {
      method: 'get',
      url: 'audit-events',
      config: { params: { page: 3, pageSize: 50 } },
    },
  ])
})
