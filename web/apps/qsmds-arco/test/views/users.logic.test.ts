import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner，避免引入浏览器测试依赖。
import test from 'node:test'

import {
  buildUserListQuery,
  canManageUserRoles,
  canSubmitRoleAssignment,
  clearPasswordFields,
  createPasswordFields,
  getApiFailure,
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

test('用户列表只发送分页和规范化后的精确用户名，不添加 status 查询', () => {
  assert.deepEqual(buildUserListQuery(2, 50, '  Alice  '), {
    page: 2,
    pageSize: 50,
    username: 'Alice',
  })
  assert.deepEqual(buildUserListQuery(1, 20, '   '), {
    page: 1,
    pageSize: 20,
  })
  assert.equal('status' in buildUserListQuery(1, 20, 'Alice'), false)
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

test('管理员设置密码使用 15 至 128 个 Unicode 字符并校验两次输入一致', () => {
  assert.deepEqual(validatePasswordFields('a'.repeat(15), 'a'.repeat(15)), {})
  assert.deepEqual(validatePasswordFields('😀'.repeat(14), '😀'.repeat(14)), {
    newPassword: '密码长度应为 15 至 128 个字符',
  })
  assert.deepEqual(validatePasswordFields('a'.repeat(15), 'b'.repeat(15)), {
    confirmPassword: '两次输入的密码不一致',
  })
})

test('密码字段可集中清空，避免成功、关闭或未知结果后残留', () => {
  const fields = createPasswordFields()
  fields.newPassword = 'a'.repeat(15)
  fields.confirmPassword = 'a'.repeat(15)

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
