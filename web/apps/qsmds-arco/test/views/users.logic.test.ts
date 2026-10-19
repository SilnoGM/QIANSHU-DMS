import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner，避免引入浏览器测试依赖。
import test from 'node:test'

import {
  buildCreateUserFundAccountInput,
  buildUserListQuery,
  canManageUserRoles,
  canSubmitRoleAssignment,
  clearPasswordFields,
  createPasswordFields,
  getApiFailure,
  refreshAfterRoleAssignment,
  refreshAfterUserUpdate,
  resolveUserAdminActions,
  validateFundAccountFields,
  validateIdentityFields,
  validatePasswordFields,
} from '../../src/views/system/users/users.logic'

test('角色目录不可读或加载失败时禁止打开或提交角色替换', () => {
  assert.equal(canManageUserRoles(true, true), true)
  assert.equal(canManageUserRoles(true, false), false)
  assert.equal(canManageUserRoles(false, true), false)
  assert.equal(canSubmitRoleAssignment(false, ''), true)
  assert.equal(canSubmitRoleAssignment(true, ''), false)
  assert.equal(canSubmitRoleAssignment(false, '角色目录加载失败'), false)
})

test('当前登录用户只保留角色分配，不暴露管理员重置密码或状态变更入口', () => {
  assert.deepEqual(resolveUserAdminActions({
    canAssignRoles: true,
    canDisable: true,
    canEnable: true,
    canResetPassword: true,
    currentUserId: 'current-user',
    status: 'ACTIVE',
    userId: 'current-user',
  }), {
    canAssignRoles: true,
    canDisable: false,
    canEnable: false,
    canResetPassword: false,
    hasMoreAction: false,
  })

  assert.deepEqual(resolveUserAdminActions({
    canAssignRoles: false,
    canDisable: true,
    canEnable: true,
    canResetPassword: true,
    currentUserId: 'current-user',
    status: 'ACTIVE',
    userId: 'current-user',
  }), {
    canAssignRoles: false,
    canDisable: false,
    canEnable: false,
    canResetPassword: false,
    hasMoreAction: false,
  })

  assert.deepEqual(resolveUserAdminActions({
    canAssignRoles: false,
    canDisable: true,
    canEnable: true,
    canResetPassword: true,
    currentUserId: 'current-user',
    status: 'ACTIVE',
    userId: 'other-user',
  }), {
    canAssignRoles: false,
    canDisable: true,
    canEnable: false,
    canResetPassword: true,
    hasMoreAction: true,
  })
})

test('本人角色变更先刷新 AuthContext 再刷新列表，其他用户只刷新列表', async () => {
  const currentUserCalls: string[] = []
  await refreshAfterRoleAssignment({
    currentUserId: 'current-user',
    reloadUsers: async () => {
      currentUserCalls.push('reload-users')
    },
    revalidateCurrentAuth: async () => {
      currentUserCalls.push('revalidate-auth')
    },
    userId: 'current-user',
  })
  assert.deepEqual(currentUserCalls, ['revalidate-auth', 'reload-users'])

  const otherUserCalls: string[] = []
  await refreshAfterRoleAssignment({
    currentUserId: 'current-user',
    reloadUsers: async () => {
      otherUserCalls.push('reload-users')
    },
    revalidateCurrentAuth: async () => {
      otherUserCalls.push('revalidate-auth')
    },
    userId: 'other-user',
  })
  assert.deepEqual(otherUserCalls, ['reload-users'])
})

test('管理员编辑本人资料后依次刷新身份、Profile 和列表，其他用户只刷新列表', async () => {
  const currentUserCalls: string[] = []
  await refreshAfterUserUpdate({
    currentUserId: 'current-user',
    refreshCurrentProfile: async () => {
      currentUserCalls.push('refresh-profile')
    },
    reloadUsers: async () => {
      currentUserCalls.push('reload-users')
    },
    revalidateCurrentAuth: async () => {
      currentUserCalls.push('revalidate-auth')
    },
    userId: 'current-user',
  })
  assert.deepEqual(currentUserCalls, [
    'revalidate-auth',
    'refresh-profile',
    'reload-users',
  ])

  const otherUserCalls: string[] = []
  await refreshAfterUserUpdate({
    currentUserId: 'current-user',
    refreshCurrentProfile: async () => {
      otherUserCalls.push('refresh-profile')
    },
    reloadUsers: async () => {
      otherUserCalls.push('reload-users')
    },
    revalidateCurrentAuth: async () => {
      otherUserCalls.push('revalidate-auth')
    },
    userId: 'other-user',
  })
  assert.deepEqual(otherUserCalls, ['reload-users'])
})

test('用户列表发送分页、规范化后的精确用户名和状态筛选', () => {
  assert.deepEqual(buildUserListQuery(2, 50, '  Alice  ', 'DISABLED'), {
    page: 2,
    pageSize: 50,
    status: 'DISABLED',
    username: 'Alice',
  })
  assert.deepEqual(buildUserListQuery(1, 20, '   ', undefined), {
    page: 1,
    pageSize: 20,
  })
  assert.equal(
    'status' in buildUserListQuery(1, 20, 'Alice', 'UNKNOWN'),
    false,
  )
})

test('用户身份字段按 Unicode code point 校验并只在提交值中裁剪首尾空白', () => {
  assert.deepEqual(validateIdentityFields('  alice  ', '  Alice  '), {})
  assert.deepEqual(validateIdentityFields('', ''), {
    displayName: '请输入显示名称',
    username: '请输入用户名',
  })
  assert.deepEqual(validateIdentityFields('😀'.repeat(129), 'Alice'), {
    username: '用户名不能超过 128 个字符',
  })
})

test('管理员设置密码使用 8 至 20 个 Unicode 字符并校验两次输入一致', () => {
  assert.deepEqual(validatePasswordFields('a'.repeat(8), 'a'.repeat(8)), {})
  assert.deepEqual(validatePasswordFields('😀'.repeat(20), '😀'.repeat(20)), {})
  assert.deepEqual(validatePasswordFields('😀'.repeat(7), '😀'.repeat(7)), {
    newPassword: '密码长度应为 8 至 20 个字符',
  })
  assert.deepEqual(validatePasswordFields('😀'.repeat(21), '😀'.repeat(21)), {
    newPassword: '密码长度应为 8 至 20 个字符',
  })
  assert.deepEqual(validatePasswordFields('a'.repeat(8), 'b'.repeat(8)), {
    confirmPassword: '两次输入的密码不一致',
  })
})

test('资金账户比例只在勾选时校验，并规范化为两位小数', () => {
  assert.deepEqual(validateFundAccountFields(false, ''), {})
  assert.deepEqual(validateFundAccountFields(false, 'not-a-rate'), {})
  assert.deepEqual(validateFundAccountFields(true, ''), {
    userShareRate: '请输入用户分成比例',
  })

  for (const value of ['-1', '30.555', '100.01', 'abc', '010']) {
    assert.deepEqual(validateFundAccountFields(true, value), {
      userShareRate: '分成比例应为 0 到 100，最多两位小数',
    })
  }

  for (const value of ['0', '100', '30', '30.5', '30.50', '100.00']) {
    assert.deepEqual(validateFundAccountFields(true, value), {})
  }

  assert.equal(
    buildCreateUserFundAccountInput(' 30.5 ').userShareRate,
    '30.50',
  )
  assert.equal(buildCreateUserFundAccountInput('100').userShareRate, '100.00')
})

test('密码字段可集中清空，避免成功、关闭或未知结果后残留', () => {
  const fields = createPasswordFields()
  fields.newPassword = 'a'.repeat(8)
  fields.confirmPassword = 'a'.repeat(8)

  clearPasswordFields(fields)

  assert.deepEqual(fields, { confirmPassword: '', newPassword: '' })
})

test('错误展示保留契约消息和 requestId，并识别不可自动重放的未知结果', () => {
  assert.deepEqual(getApiFailure({
    body: {
      code: 'USERNAME_CONFLICT',
      message: '用户名已存在',
      requestId: 'req-1',
    },
    kind: 'http',
    status: 409,
  }), {
    message: '用户名已存在',
    requestId: 'req-1',
    unknownResult: false,
  })
  assert.deepEqual(getApiFailure({
    code: 'NETWORK_ERROR',
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  }), {
    message: '网络连接失败，请稍后重试',
    requestId: undefined,
    unknownResult: true,
  })
  assert.equal(getApiFailure({
    body: { code: 'SERVER_ERROR', message: '服务异常', requestId: 'req-5' },
    kind: 'http',
    status: 503,
  }).unknownResult, true)
})
