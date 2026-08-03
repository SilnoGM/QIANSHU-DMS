import type {
  CreateDictionaryTypeRequestDto,
  DictionaryTypeDto,
  UpdateDictionaryTypeRequestDto,
} from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- 字典 Type 启停确认框与纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildDictionaryTypeCreateReconciliationQuery,
  createDictionaryStatusChangeRequest,
  dictionaryStatusChangeCopy,
  findMatchingCreatedDictionaryType,
  getDictionaryTypeMutationFailure,
  matchesDictionaryTypeStatus,
  matchesDictionaryTypeUpdate,
  resolveDictionaryTypeActions,
} from '../../src/views/system/basic-data/dictionaries/dictionary-status.logic'

const disabledType: DictionaryTypeDto = {
  code: 'sales.order_status',
  createdAt: '2026-08-03T01:00:00.000Z',
  description: '销售订单状态',
  enabled: false,
  enabledItemCount: 2,
  id: 'type-sales-order-status',
  itemCount: 4,
  name: '订单状态',
  sortOrder: 10,
  updatedAt: '2026-08-03T01:00:00.000Z',
  version: 1,
}

const enabledType: DictionaryTypeDto = {
  ...disabledType,
  enabled: true,
  updatedAt: '2026-08-03T02:00:00.000Z',
  version: 2,
}

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('Type 动作同时受 update/enable/disable 权限与当前状态约束', () => {
  assert.deepEqual(resolveDictionaryTypeActions(disabledType, {
    canDisable: true,
    canEnable: true,
    canUpdate: true,
  }), {
    canDisable: false,
    canEdit: true,
    canEnable: true,
    hasAny: true,
    readonlyReason: '仅查看',
  })

  assert.deepEqual(resolveDictionaryTypeActions(enabledType, {
    canDisable: true,
    canEnable: true,
    canUpdate: true,
  }), {
    canDisable: true,
    canEdit: true,
    canEnable: false,
    hasAny: true,
    readonlyReason: '仅查看',
  })

  assert.deepEqual(resolveDictionaryTypeActions(enabledType, {
    canDisable: false,
    canEnable: false,
    canUpdate: false,
  }), {
    canDisable: false,
    canEdit: false,
    canEnable: false,
    hasAny: false,
    readonlyReason: '仅查看',
  })
})

test('只有标准 network 错误进入结果未知，HTTP 500 仍是已知失败', () => {
  assert.deepEqual(getDictionaryTypeMutationFailure({
    code: 'NETWORK_ERROR',
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  }), {
    code: undefined,
    fieldErrors: {},
    message: '网络连接失败，请稍后重试',
    requestId: undefined,
    stateChanged: false,
    unknownResult: true,
  })

  assert.deepEqual(getDictionaryTypeMutationFailure({
    body: {
      code: 'SERVER_ERROR',
      message: '服务暂不可用',
      requestId: 'request-http-500',
    },
    kind: 'http',
    status: 500,
  }), {
    code: 'SERVER_ERROR',
    fieldErrors: {},
    message: '服务暂不可用',
    requestId: 'request-http-500',
    stateChanged: false,
    unknownResult: false,
  })
})

test('Mutation fieldErrors 只接受 Type 白名单且重复 code 稳定映射字段', () => {
  assert.deepEqual(getDictionaryTypeMutationFailure({
    body: {
      code: 'VALIDATION_FAILED',
      fieldErrors: {
        code: ['编码格式无效'],
        description: ['说明过长'],
        enabled: ['不得由表单修改'],
        expectedVersion: ['内部并发字段'],
        name: ['名称不能为空'],
        sortOrder: ['排序无效'],
      },
      message: '请求参数校验失败',
      requestId: 'request-validation',
    },
    kind: 'http',
    status: 422,
  }).fieldErrors, {
    code: '编码格式无效',
    description: '说明过长',
    name: '名称不能为空',
    sortOrder: '排序无效',
  })

  assert.deepEqual(getDictionaryTypeMutationFailure({
    body: {
      code: 'DICTIONARY_TYPE_CODE_ALREADY_EXISTS',
      message: '字典类型编码已存在',
      requestId: 'request-duplicate',
    },
    kind: 'http',
    status: 409,
  }).fieldErrors, {
    code: '字典类型编码已存在',
  })
})

test('并发刷新只识别 409 DICTIONARY_TYPE_STATE_CHANGED 稳定组合', () => {
  assert.equal(getDictionaryTypeMutationFailure({
    body: {
      code: 'DICTIONARY_TYPE_STATE_CHANGED',
      message: '字典类型状态已变化',
      requestId: 'request-conflict',
    },
    kind: 'http',
    status: 409,
  }).stateChanged, true)

  assert.equal(getDictionaryTypeMutationFailure({
    body: {
      code: 'SOME_OTHER_CONFLICT',
      message: '其他冲突',
      requestId: 'request-other-conflict',
    },
    kind: 'http',
    status: 409,
  }).stateChanged, false)

  assert.equal(getDictionaryTypeMutationFailure({
    body: {
      code: 'DICTIONARY_TYPE_STATE_CHANGED',
      message: '错误状态码',
      requestId: 'request-wrong-status',
    },
    kind: 'http',
    status: 400,
  }).stateChanged, false)
})

test('不可信 error 读取异常时 fail-closed 且不泄漏任意结构', () => {
  const throwingError = Object.defineProperty({}, 'kind', {
    get() {
      throw new Error('sensitive getter output')
    },
  })
  assert.deepEqual(getDictionaryTypeMutationFailure(throwingError), {
    code: undefined,
    fieldErrors: {},
    message: '操作失败，请稍后重试',
    requestId: undefined,
    stateChanged: false,
    unknownResult: false,
  })
  assert.deepEqual(getDictionaryTypeMutationFailure({
    kind: 'custom',
    message: 'untrusted internal message',
  }), {
    code: undefined,
    fieldErrors: {},
    message: '操作失败，请稍后重试',
    requestId: undefined,
    stateChanged: false,
    unknownResult: false,
  })
})

test('创建结果未知以规范化 code 构造最小只读搜索，不自动重放 Mutation', () => {
  assert.deepEqual(
    buildDictionaryTypeCreateReconciliationQuery(
      '\u0085Sales.Order_Status\u3000',
    ),
    {
      page: 1,
      pageSize: 20,
      query: 'sales.order_status',
      sortBy: 'code',
      sortOrder: 'asc',
    },
  )
})

test('创建对账只返回唯一完整候选，页面仍不得据此证明本次 create 成功', () => {
  const request: CreateDictionaryTypeRequestDto = {
    code: 'sales.order_status',
    description: '销售订单状态',
    name: '订单状态',
    sortOrder: 10,
  }
  const newlyCreatedType: DictionaryTypeDto = {
    ...disabledType,
    enabledItemCount: 0,
    itemCount: 0,
    version: 1,
  }

  assert.equal(
    findMatchingCreatedDictionaryType([newlyCreatedType], request)?.id,
    newlyCreatedType.id,
  )
  assert.equal(findMatchingCreatedDictionaryType([], request), undefined)
  assert.equal(findMatchingCreatedDictionaryType([
    { ...newlyCreatedType, name: '其他状态' },
  ], request), undefined)
  assert.equal(findMatchingCreatedDictionaryType([
    { ...newlyCreatedType, enabled: true },
  ], request), undefined)
  assert.equal(findMatchingCreatedDictionaryType([
    { ...newlyCreatedType, version: 2 },
  ], request), undefined)
  assert.equal(findMatchingCreatedDictionaryType([
    { ...newlyCreatedType, enabledItemCount: 1, itemCount: 1 },
  ], request), undefined)
  assert.equal(findMatchingCreatedDictionaryType([
    newlyCreatedType,
    { ...newlyCreatedType, id: 'duplicate-response' },
  ], request), undefined)
})

test('编辑与启停只确认目标 ID 和全部期望字段，未命中保持 inconclusive', () => {
  const update: UpdateDictionaryTypeRequestDto = {
    description: null,
    expectedVersion: 1,
    name: '销售订单状态',
    sortOrder: 20,
  }
  const updatedType: DictionaryTypeDto = {
    ...disabledType,
    description: null,
    name: '销售订单状态',
    sortOrder: 20,
    version: 2,
  }

  assert.equal(
    matchesDictionaryTypeUpdate(updatedType, disabledType.id, update),
    true,
  )
  assert.equal(
    matchesDictionaryTypeUpdate(updatedType, 'type-other', update),
    false,
  )
  assert.equal(matchesDictionaryTypeUpdate({
    ...updatedType,
    sortOrder: 21,
  }, disabledType.id, update), false)

  assert.equal(
    matchesDictionaryTypeStatus(enabledType, enabledType.id, true),
    true,
  )
  assert.equal(
    matchesDictionaryTypeStatus(enabledType, 'type-other', true),
    false,
  )
  assert.equal(
    matchesDictionaryTypeStatus(disabledType, disabledType.id, true),
    false,
  )
})

test('启停文案与提交请求明确领域约束并阻止重复触发', () => {
  const enableCopy = dictionaryStatusChangeCopy('enable')
  const disableCopy = dictionaryStatusChangeCopy('disable')

  assert.equal(enableCopy.title, '确认启用字典类型')
  assert.match(enableCopy.consequence, /至少一个自身启用条目/u)
  assert.equal(disableCopy.title, '确认停用字典类型')
  assert.match(disableCopy.consequence, /保留全部条目的自身状态/u)

  assert.deepEqual(
    createDictionaryStatusChangeRequest('enable', disabledType, false),
    {
      action: 'enable',
      typeId: disabledType.id,
    },
  )
  assert.equal(
    createDictionaryStatusChangeRequest('enable', disabledType, true),
    null,
  )
  assert.equal(createDictionaryStatusChangeRequest('enable', null, false), null)
})

test('启停确认框复用 QsGenericModal，展示 name/code、稳定错误与领域约束', () => {
  const source = readSource(
    '../../src/views/system/basic-data/dictionaries/dictionary-status-change-modal.vue',
  )
  const logicSource = readSource(
    '../../src/views/system/basic-data/dictionaries/dictionary-status.logic.ts',
  )

  assert.match(source, /defineOptions\(\{ name: 'DictionaryStatusChangeModal' \}\)/u)
  assert.match(
    source,
    /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u,
  )
  assert.match(source, /<QsGenericModal\b/u)
  assert.match(logicSource, /submissionBlocked\?: boolean/u)
  assert.match(source, /props\.submissionBlocked/u)
  assert.match(source, /:submitting="interactionLocked"/u)
  assert.match(source, /@update:model-value="handleVisibilityChange"/u)
  assert.match(source, /type\?\.name/u)
  assert.match(source, /type\.code/u)
  assert.match(source, /DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED/u)
  assert.match(source, /至少一个自身启用/u)
  assert.match(logicSource, /保留全部条目的自身状态/u)
  assert.doesNotMatch(source, /停用会保留条目的自身状态/u)
  assert.match(source, /requestId:/u)
  assert.match(source, /role="alert"/u)
  assert.doesNotMatch(source, /<a-switch|<FaSwitch|<Switch\b|type="checkbox"/iu)
  assert.doesNotMatch(
    source,
    /@\/api|useApp\w*Store|dictionariesApi|DictionaryCatalogProvider|provider/u,
  )
})

test('Modal 本地提交锁禁止重复、关闭且 Footer 触控高度不少于 44px', () => {
  const source = readSource(
    '../../src/views/system/basic-data/dictionaries/dictionary-status-change-modal.vue',
  )

  assert.match(source, /const interactionLocked = computed\([\s\S]*?props\.submitting \|\| submitRequested\.value/u)
  assert.match(source, /if \(interactionLocked\.value\) \{\s*return\s*\}/u)
  assert.match(source, /submitRequested\.value = true/u)
  assert.match(source, /emit\('submit', request\)/u)
  assert.match(
    source,
    /if \(value \|\| interactionLocked\.value\) \{\s*return\s*\}[\s\S]*?emit\('cancel'\)/u,
  )
  assert.match(
    source,
    /watch\(\s*\(\) => props\.submitting,[\s\S]*?submitRequested\.value = false/u,
  )
  assert.match(source, /<template #footer>/u)
  assert.equal(
    source.match(/class="min-h-11 w-full sm:w-auto"/gu)?.length,
    2,
  )
})
