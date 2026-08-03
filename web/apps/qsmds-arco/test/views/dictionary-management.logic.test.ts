import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 字典管理状态机使用 Node.js 内置 runner 验证。
import test from 'node:test'

import {
  canApplyDictionaryItemResponse,
  canApplyDictionaryMutationResult,
  canApplyDictionaryQueryResponse,
  createDictionaryManagementState,
  createDictionarySelection,
  isDictionaryAbortError,
  resolveDictionaryAccessTransition,
  transitionDictionaryMutationState,
  transitionDictionaryQueryState,
} from '../../src/views/system/basic-data/dictionaries/dictionary-management.logic'

test('初始状态按读取权限建立且不携带受保护上下文', () => {
  assert.deepEqual(createDictionaryManagementState(true), {
    access: 'active',
    itemQuery: 'idle',
    mutation: 'closed',
    selection: {
      kind: 'none',
      typeId: null,
    },
    typeQuery: 'idle',
  })
  assert.deepEqual(createDictionaryManagementState(false), {
    access: 'forbidden',
    itemQuery: 'idle',
    mutation: 'closed',
    selection: {
      kind: 'none',
      typeId: null,
    },
    typeQuery: 'idle',
  })
  assert.notEqual(
    createDictionaryManagementState(true).selection,
    createDictionaryManagementState(true).selection,
  )
})

test('撤权强制中止查询、清空数据、关闭浮层且不触发重载', () => {
  const transition = resolveDictionaryAccessTransition({
    authorized: false,
    identityChanged: false,
    previousState: {
      access: 'active',
      itemQuery: 'ready',
      mutation: 'submitting',
      selection: createDictionarySelection('type-1'),
      typeQuery: 'ready',
    },
  })

  assert.deepEqual(transition, {
    nextState: createDictionaryManagementState(false),
    shouldAbortQueries: true,
    shouldClearProtectedData: true,
    shouldCloseOverlays: true,
    shouldReload: false,
  })
})

test('身份变化即使仍有读取权限也清空旧身份并重新加载', () => {
  const transition = resolveDictionaryAccessTransition({
    authorized: true,
    identityChanged: true,
    previousState: {
      access: 'active',
      itemQuery: 'empty',
      mutation: 'editing',
      selection: createDictionarySelection('type-old'),
      typeQuery: 'ready',
    },
  })

  assert.deepEqual(transition, {
    nextState: createDictionaryManagementState(true),
    shouldAbortQueries: true,
    shouldClearProtectedData: true,
    shouldCloseOverlays: true,
    shouldReload: true,
  })
})

test('重新授权从空状态重载，未变化的权限快照没有副作用', () => {
  const forbidden = createDictionaryManagementState(false)
  assert.deepEqual(resolveDictionaryAccessTransition({
    authorized: true,
    identityChanged: false,
    previousState: forbidden,
  }), {
    nextState: createDictionaryManagementState(true),
    shouldAbortQueries: true,
    shouldClearProtectedData: true,
    shouldCloseOverlays: true,
    shouldReload: true,
  })

  const active = createDictionaryManagementState(true)
  assert.deepEqual(resolveDictionaryAccessTransition({
    authorized: true,
    identityChanged: false,
    previousState: active,
  }), {
    nextState: active,
    shouldAbortQueries: false,
    shouldClearProtectedData: false,
    shouldCloseOverlays: false,
    shouldReload: false,
  })
})

test('query 状态区分首次加载、保留数据刷新、空结果和错误', () => {
  assert.equal(
    transitionDictionaryQueryState('idle', { type: 'request', hasData: false }),
    'loading',
  )
  assert.equal(
    transitionDictionaryQueryState('ready', { type: 'request', hasData: true }),
    'refreshing',
  )
  assert.equal(
    transitionDictionaryQueryState('loading', { type: 'success', itemCount: 0 }),
    'empty',
  )
  assert.equal(
    transitionDictionaryQueryState('refreshing', { type: 'success', itemCount: 2 }),
    'ready',
  )
  assert.equal(
    transitionDictionaryQueryState('loading', { type: 'failure' }),
    'error',
  )
  assert.equal(
    transitionDictionaryQueryState('error', { type: 'reset' }),
    'idle',
  )
})

test('selection 只表达页面本地 Type，不包含 URL 或默认选择策略', () => {
  assert.deepEqual(createDictionarySelection(null), {
    kind: 'none',
    typeId: null,
  })
  assert.deepEqual(createDictionarySelection('type-1'), {
    kind: 'selected',
    typeId: 'type-1',
  })
  assert.deepEqual(createDictionarySelection(''), {
    kind: 'none',
    typeId: null,
  })
})

test('mutation 只允许合法生命周期且撤权可绕过提交关闭保护', () => {
  assert.equal(transitionDictionaryMutationState('closed', 'open'), 'editing')
  assert.equal(transitionDictionaryMutationState('editing', 'submit'), 'submitting')
  assert.equal(
    transitionDictionaryMutationState('submitting', 'unknown-result'),
    'reconciling',
  )
  assert.equal(
    transitionDictionaryMutationState('reconciling', 'complete'),
    'closed',
  )
  assert.equal(transitionDictionaryMutationState('editing', 'fail'), 'error')
  assert.equal(transitionDictionaryMutationState('error', 'cancel'), 'closed')
  assert.equal(
    transitionDictionaryMutationState('submitting', 'cancel'),
    'submitting',
  )
  assert.equal(
    transitionDictionaryMutationState('reconciling', 'cancel'),
    'reconciling',
  )
  const failedReconciliation = transitionDictionaryMutationState(
    'reconciling',
    'fail',
  )
  assert.equal(failedReconciliation, 'error')
  assert.equal(
    transitionDictionaryMutationState(failedReconciliation, 'submit'),
    'error',
  )
  assert.equal(
    transitionDictionaryMutationState('submitting', 'authority-loss'),
    'closed',
  )
  assert.equal(transitionDictionaryMutationState('closed', 'submit'), 'closed')
})

test('Type 响应必须同时匹配权限、Abort、身份与最新请求版本', () => {
  const current = {
    aborted: false,
    authorized: true,
    authEpoch: 7,
    currentAuthEpoch: 7,
    latestRequestVersion: 3,
    requestVersion: 3,
  }

  assert.equal(canApplyDictionaryQueryResponse(current), true)
  assert.equal(canApplyDictionaryQueryResponse({ ...current, aborted: true }), false)
  assert.equal(canApplyDictionaryQueryResponse({ ...current, authorized: false }), false)
  assert.equal(canApplyDictionaryQueryResponse({ ...current, currentAuthEpoch: 8 }), false)
  assert.equal(canApplyDictionaryQueryResponse({ ...current, latestRequestVersion: 4 }), false)
})

test('Item 响应还必须匹配当前选中 Type，A-B-A 仍由版本拒绝旧响应', () => {
  const current = {
    aborted: false,
    authorized: true,
    authEpoch: 7,
    currentAuthEpoch: 7,
    latestRequestVersion: 5,
    requestVersion: 5,
    currentTypeId: 'type-a',
    requestedTypeId: 'type-a',
  }

  assert.equal(canApplyDictionaryItemResponse(current), true)
  assert.equal(canApplyDictionaryItemResponse({
    ...current,
    currentTypeId: 'type-b',
  }), false)
  assert.equal(canApplyDictionaryItemResponse({
    ...current,
    currentTypeId: null,
  }), false)
  assert.equal(canApplyDictionaryItemResponse({
    ...current,
    requestVersion: 3,
  }), false)
})

test('Mutation 迟到结果必须匹配权限、身份、代次和当前目标', () => {
  const current = {
    authorized: true,
    authEpoch: 9,
    currentAuthEpoch: 9,
    latestMutationVersion: 4,
    mutationVersion: 4,
    currentTargetId: 'type-1',
    targetId: 'type-1',
  }

  assert.equal(canApplyDictionaryMutationResult(current), true)
  assert.equal(canApplyDictionaryMutationResult({ ...current, authorized: false }), false)
  assert.equal(canApplyDictionaryMutationResult({ ...current, currentAuthEpoch: 10 }), false)
  assert.equal(canApplyDictionaryMutationResult({ ...current, latestMutationVersion: 5 }), false)
  assert.equal(canApplyDictionaryMutationResult({
    ...current,
    currentTargetId: 'type-2',
  }), false)
  assert.equal(canApplyDictionaryMutationResult({ ...current, currentTargetId: null }), false)
  assert.equal(canApplyDictionaryMutationResult({
    ...current,
    currentTargetId: null,
    targetId: null,
  }), false)
})

test('Abort 识别覆盖 DOM 与 Axios 取消且不吞普通网络错误', () => {
  assert.equal(isDictionaryAbortError({ name: 'AbortError' }), true)
  assert.equal(isDictionaryAbortError({ code: 'ERR_CANCELED' }), true)
  assert.equal(isDictionaryAbortError({ name: 'CanceledError' }), true)
  assert.equal(isDictionaryAbortError(new Error('network failed')), false)
  assert.equal(isDictionaryAbortError({ code: 'ERR_NETWORK' }), false)
  assert.equal(isDictionaryAbortError(null), false)
  assert.equal(isDictionaryAbortError('AbortError'), false)
})
