import type {
  DictionaryItemDto,
  DictionaryTypeDto,
} from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- 纯逻辑契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildCreateDictionaryItemRequest,
  buildUpdateDictionaryItemRequest,
  createDictionaryItemFormModel,
  findMatchingCreatedDictionaryItem,
  hasDictionaryItemFormChanges,
  matchesDictionaryItemUpdateResult,
  normalizeDictionaryItemFormText,
  normalizeDictionaryItemFormValue,
  rebaseDictionaryItemFormModel,
  validateDictionaryItemForm,
} from '../../src/views/system/basic-data/dictionaries/dictionary-item-form.logic'

const TYPE: DictionaryTypeDto = {
  id: '00000000-0000-4000-8000-000000000201',
  code: 'order.status',
  name: '订单状态',
  description: '订单履约状态',
  enabled: true,
  sortOrder: 10,
  itemCount: 3,
  enabledItemCount: 2,
  version: 5,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
}

const ITEM: DictionaryItemDto = {
  id: '00000000-0000-4000-8000-000000000202',
  dictionaryTypeId: TYPE.id,
  value: 'PENDING',
  label: '待处理',
  description: '等待业务人员处理',
  tone: 'WARNING',
  enabled: true,
  effectiveEnabled: true,
  sortOrder: 20,
  version: 7,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
}

const modalSource = readFileSync(
  new URL(
    '../../src/views/system/basic-data/dictionaries/dictionary-item-form-modal.vue',
    import.meta.url,
  ),
  'utf8',
)

test('字典条目表单为创建与编辑模式生成独立模型', () => {
  assert.deepEqual(createDictionaryItemFormModel('create', null), {
    value: '',
    label: '',
    description: '',
    tone: 'DEFAULT',
    sortOrder: '0',
  })
  assert.deepEqual(createDictionaryItemFormModel('edit', ITEM), {
    value: 'PENDING',
    label: '待处理',
    description: '等待业务人员处理',
    tone: 'WARNING',
    sortOrder: '20',
  })
})

test('Item value 镜像 Server 的 NFC、Unicode 边缘裁剪、ASCII 与大写规则', () => {
  assert.equal(
    normalizeDictionaryItemFormValue('\u0085pending-state_1\u3000'),
    'PENDING-STATE_1',
  )

  const valid = createDictionaryItemFormModel('create', null)
  Object.assign(valid, {
    value: '\u0085pending.value-1\u3000',
    label: '待处理',
    sortOrder: '0',
  })
  assert.deepEqual(validateDictionaryItemForm(valid, 'create'), {})

  for (const value of [
    '',
    '.PENDING',
    '-PENDING',
    '_PENDING',
    'PENDING/VALUE',
    'PENDING VALUE',
    '待处理',
    'A'.repeat(65),
  ]) {
    assert.equal(
      validateDictionaryItemForm({ ...valid, value }, 'create').value,
      '条目值必须是 1 到 64 位 ASCII 技术标识',
      value,
    )
  }
})

test('标签与说明按 Unicode 空白折叠并使用码点长度边界', () => {
  assert.equal(
    normalizeDictionaryItemFormText('  Cafe\u0301\u3000  上海 \n'),
    'Café 上海',
  )

  const model = createDictionaryItemFormModel('create', null)
  Object.assign(model, {
    value: 'PENDING',
    label: '😀'.repeat(128),
    description: '😀'.repeat(500),
  })
  assert.deepEqual(validateDictionaryItemForm(model, 'create'), {})

  assert.deepEqual(validateDictionaryItemForm({
    ...model,
    label: '😀'.repeat(129),
    description: '😀'.repeat(501),
  }, 'create'), {
    description: '说明不能超过 500 个字符',
    label: '条目标签必须为 1 到 128 个字符',
  })
})

test('Tone 只接受六个固定枚举，排序严格限制为 Int32 非负整数', () => {
  const model = {
    ...createDictionaryItemFormModel('create', null),
    value: 'PENDING',
    label: '待处理',
  }

  for (const tone of [
    'DEFAULT',
    'PRIMARY',
    'SUCCESS',
    'WARNING',
    'DANGER',
    'INFO',
  ] as const) {
    assert.deepEqual(validateDictionaryItemForm({ ...model, tone }, 'create'), {})
  }

  assert.equal(
    validateDictionaryItemForm({ ...model, tone: 'CUSTOM' as never }, 'create').tone,
    '请选择有效的语义色调',
  )
  for (const sortOrder of ['-1', '1.5', '1 0', '2147483648', '']) {
    assert.equal(
      validateDictionaryItemForm({ ...model, sortOrder }, 'create').sortOrder,
      '排序必须是 0 到 2147483647 的整数',
      sortOrder,
    )
  }
})

test('创建请求只输出公开 DTO 字段、省略空说明且不允许启用', () => {
  const request = buildCreateDictionaryItemRequest({
    value: '\u0085pending.value\u3000',
    label: '  待　 处理  ',
    description: '\u0085\u3000',
    tone: 'WARNING',
    sortOrder: '020',
  })
  assert.deepEqual(request, {
    value: 'PENDING.VALUE',
    label: '待 处理',
    tone: 'WARNING',
    sortOrder: 20,
  })
  for (const forbidden of [
    'dictionaryTypeId',
    'effectiveEnabled',
    'enabled',
    'id',
    'version',
  ]) {
    assert.equal(Object.hasOwn(request, forbidden), false)
  }
})

test('编辑请求忽略 value 与归属，只发送变更字段及当前 expectedVersion', () => {
  const model = createDictionaryItemFormModel('edit', ITEM)
  model.value = 'FORBIDDEN_CHANGE'
  model.description = '   '
  model.label = '  待　审核 '
  model.tone = 'DANGER'

  assert.equal(hasDictionaryItemFormChanges(model, ITEM), true)
  assert.deepEqual(buildUpdateDictionaryItemRequest(model, ITEM), {
    description: null,
    expectedVersion: 7,
    label: '待 审核',
    tone: 'DANGER',
  })
  for (const forbidden of [
    'dictionaryTypeId',
    'effectiveEnabled',
    'enabled',
    'id',
    'value',
  ]) {
    assert.equal(
      Object.hasOwn(buildUpdateDictionaryItemRequest(model, ITEM), forbidden),
      false,
    )
  }
  assert.equal(
    buildUpdateDictionaryItemRequest(model, { ...ITEM, version: 9 })
      .expectedVersion,
    9,
  )
})

test('编辑语义未变时只保留 version 且禁止提交', () => {
  const model = createDictionaryItemFormModel('edit', ITEM)
  model.value = 'ILLEGAL_BUT_IGNORED'
  model.label = '  待处理 '
  model.description = ' 等待业务人员处理 '
  model.sortOrder = '020'

  assert.equal(hasDictionaryItemFormChanges(model, ITEM), false)
  assert.deepEqual(buildUpdateDictionaryItemRequest(model, ITEM), {
    expectedVersion: 7,
  })
})

test('Item update 最终状态必须命中父子身份、字段且版本前进', () => {
  const request = {
    expectedVersion: ITEM.version,
    label: '已更新',
    tone: 'INFO' as const,
  }
  const updated = {
    ...ITEM,
    label: '已更新',
    tone: 'INFO' as const,
    version: ITEM.version + 1,
  }

  assert.equal(matchesDictionaryItemUpdateResult(
    updated,
    TYPE.id,
    ITEM.id,
    request,
  ), true)
  assert.equal(matchesDictionaryItemUpdateResult(
    { ...updated, version: ITEM.version },
    TYPE.id,
    ITEM.id,
    request,
  ), false)
  assert.equal(matchesDictionaryItemUpdateResult(
    updated,
    TYPE.id,
    ITEM.id,
    { expectedVersion: ITEM.version },
  ), false)
  assert.equal(matchesDictionaryItemUpdateResult(
    updated,
    '00000000-0000-4000-8000-000000000299',
    ITEM.id,
    request,
  ), false)
})

test('Item create 对账只返回唯一且保持默认停用的严格候选', () => {
  const request = {
    label: ITEM.label,
    sortOrder: ITEM.sortOrder,
    tone: ITEM.tone,
    value: ITEM.value,
  }
  const candidate = {
    ...ITEM,
    description: null,
    effectiveEnabled: false,
    enabled: false,
    version: 1,
  }

  assert.deepEqual(findMatchingCreatedDictionaryItem(
    [candidate],
    TYPE.id,
    request,
  ), candidate)
  assert.equal(findMatchingCreatedDictionaryItem(
    [{ ...candidate, enabled: true }],
    TYPE.id,
    request,
  ), undefined)
  assert.equal(findMatchingCreatedDictionaryItem(
    [candidate, { ...candidate, id: '00000000-0000-4000-8000-000000000298' }],
    TYPE.id,
    request,
  ), undefined)
})

test('409 rebase 合并未编辑字段、锁定最新稳定身份并标记真冲突', () => {
  const model = createDictionaryItemFormModel('edit', ITEM)
  model.value = 'FORBIDDEN_CHANGE'
  model.label = '用户修改的标签'
  model.sortOrder = '30'

  const rebased = rebaseDictionaryItemFormModel(
    model,
    ITEM,
    {
      ...ITEM,
      description: '服务器更新的说明',
      label: '服务器更新的标签',
      tone: 'INFO',
      version: 8,
    },
  )

  assert.deepEqual(rebased.model, {
    value: ITEM.value,
    label: '用户修改的标签',
    description: '服务器更新的说明',
    tone: 'INFO',
    sortOrder: '30',
  })
  assert.deepEqual(rebased.conflicts, [{
    field: 'label',
    latestValue: '服务器更新的标签',
  }])

  const sameFinalValue = rebaseDictionaryItemFormModel(
    { ...model, label: ' 服务器更新的标签 ' },
    ITEM,
    { ...ITEM, label: '服务器更新的标签', version: 8 },
  )
  assert.deepEqual(sameFinalValue.conflicts, [])
})

test('字典条目 Modal 锁定 Type 与 value，复用项目组件并在提交窗口加锁', () => {
  assert.match(
    modalSource,
    /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u,
  )
  assert.match(modalSource, /<QsGenericModal\b/u)
  assert.match(modalSource, /<FaForm\b/u)
  assert.match(modalSource, /<FaSelect\b/u)
  assert.match(modalSource, /<FaTextarea\b/u)
  assert.match(modalSource, /dictionaryType\?: DictionaryTypeDto \| null/u)
  assert.match(modalSource, /dictionaryItem\?: DictionaryItemDto \| null/u)
  assert.match(modalSource, /dictionaryItem\.dictionaryTypeId !== dictionaryType\.id/u)
  assert.match(modalSource, /typeId: dictionaryType\.id/u)
  assert.match(modalSource, /itemId: editItem\.id/u)
  assert.match(modalSource, /:disabled="isEditing \|\| submitLocked"/u)
  assert.match(modalSource, /所属类型已锁定/u)
  assert.match(modalSource, /新建条目默认停用/u)
  assert.match(modalSource, /const submitLocked = computed\(/u)
  assert.match(modalSource, /submissionBlocked\?: boolean/u)
  assert.match(modalSource, /props\.submissionBlocked/u)
  assert.match(modalSource, /rebaseDictionaryItemFormModel/u)
  assert.match(modalSource, /dictionaryItem\?\.version/u)
  assert.match(modalSource, /并发字段需要核对/u)
  assert.match(modalSource, /:submitting="submitLocked"/u)
  assert.match(modalSource, /requestId:/u)
  assert.equal(
    modalSource.match(/class="min-h-11 w-full sm:w-auto"/gu)?.length,
    2,
  )
  assert.doesNotMatch(modalSource, /#[\dA-Fa-f]{3,8}\b/u)
  assert.doesNotMatch(modalSource, /(?:Inter|Roboto|Arial|system-ui)/u)
  assert.doesNotMatch(modalSource, /\p{Extended_Pictographic}/u)
})
