import type { DictionaryTypeDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- 纯逻辑契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildCreateDictionaryTypeRequest,
  buildUpdateDictionaryTypeRequest,
  createDictionaryTypeFormModel,
  hasDictionaryTypeFormChanges,
  normalizeDictionaryTypeFormCode,
  normalizeDictionaryTypeFormText,
  rebaseDictionaryTypeFormModel,
  validateDictionaryTypeForm,
} from '../../src/views/system/basic-data/dictionaries/dictionary-type-form.logic'

const TYPE: DictionaryTypeDto = {
  id: '00000000-0000-4000-8000-000000000101',
  code: 'order.status',
  name: '订单状态',
  description: '订单履约状态',
  enabled: false,
  sortOrder: 20,
  itemCount: 3,
  enabledItemCount: 2,
  version: 7,
  createdAt: '2026-08-03T00:00:00.000Z',
  updatedAt: '2026-08-03T00:00:00.000Z',
}

const modalSource = readFileSync(
  new URL(
    '../../src/views/system/basic-data/dictionaries/dictionary-type-form-modal.vue',
    import.meta.url,
  ),
  'utf8',
)

test('字典类型表单为创建与编辑模式生成独立模型', () => {
  assert.deepEqual(createDictionaryTypeFormModel('create', null), {
    code: '',
    description: '',
    name: '',
    sortOrder: '0',
  })
  assert.deepEqual(createDictionaryTypeFormModel('edit', TYPE), {
    code: 'order.status',
    description: '订单履约状态',
    name: '订单状态',
    sortOrder: '20',
  })
})

test('Type code 镜像 Server 的 NFC、Unicode 边缘裁剪、ASCII namespace 与小写规则', () => {
  assert.equal(
    normalizeDictionaryTypeFormCode('\u0085Order.Status\u3000'),
    'order.status',
  )

  const valid = createDictionaryTypeFormModel('create', null)
  Object.assign(valid, {
    code: '\u0085Order.Status\u3000',
    name: '订单状态',
    sortOrder: '0',
  })
  assert.deepEqual(validateDictionaryTypeForm(valid, 'create'), {})

  for (const code of [
    'orders',
    '.order.status',
    'order..status',
    'order.1status',
    'order.状态',
    'ß.a',
    `a.${'b'.repeat(63)}`,
  ]) {
    assert.equal(
      validateDictionaryTypeForm({ ...valid, code }, 'create').code,
      '类型编码必须是 3 到 64 位带点 ASCII namespace',
      code,
    )
  }
})

test('名称与说明按 Unicode 空白折叠并使用码点长度边界', () => {
  assert.equal(
    normalizeDictionaryTypeFormText('  Cafe\u0301\u3000  上海 \n'),
    'Café 上海',
  )

  const model = createDictionaryTypeFormModel('create', null)
  Object.assign(model, {
    code: 'order.status',
    name: '😀'.repeat(128),
    description: '😀'.repeat(500),
  })
  assert.deepEqual(validateDictionaryTypeForm(model, 'create'), {})

  assert.deepEqual(validateDictionaryTypeForm({
    ...model,
    name: '😀'.repeat(129),
    description: '😀'.repeat(501),
  }, 'create'), {
    description: '说明不能超过 500 个字符',
    name: '类型名称必须为 1 到 128 个字符',
  })
  assert.equal(
    validateDictionaryTypeForm({ ...model, name: '\u0085\u3000' }, 'create').name,
    '类型名称必须为 1 到 128 个字符',
  )
})

test('排序严格限制为 Int32 非负整数', () => {
  const model = {
    ...createDictionaryTypeFormModel('create', null),
    code: 'order.status',
    name: '订单状态',
  }

  for (const sortOrder of ['0', '2147483647', 20]) {
    assert.deepEqual(
      validateDictionaryTypeForm({ ...model, sortOrder }, 'create'),
      {},
      String(sortOrder),
    )
  }
  for (const sortOrder of ['-1', '1.5', '1 0', '2147483648', '']) {
    assert.equal(
      validateDictionaryTypeForm({ ...model, sortOrder }, 'create').sortOrder,
      '排序必须是 0 到 2147483647 的整数',
      sortOrder,
    )
  }
})

test('创建请求只输出公开 DTO 字段并省略空说明', () => {
  const model = {
    code: '\u0085Order.Status\u3000',
    description: '  用于\u3000  订单 \n ',
    name: '  订单\u3000 状态  ',
    sortOrder: '020',
  }
  assert.deepEqual(buildCreateDictionaryTypeRequest(model), {
    code: 'order.status',
    description: '用于 订单',
    name: '订单 状态',
    sortOrder: 20,
  })

  const withoutDescription = buildCreateDictionaryTypeRequest({
    ...model,
    description: '\u0085\u3000',
  })
  assert.deepEqual(withoutDescription, {
    code: 'order.status',
    name: '订单 状态',
    sortOrder: 20,
  })
  for (const forbidden of ['enabled', 'id', 'version']) {
    assert.equal(Object.hasOwn(withoutDescription, forbidden), false)
  }
})

test('编辑请求只发送已变更字段与当前 expectedVersion', () => {
  const model = createDictionaryTypeFormModel('edit', TYPE)
  model.code = 'forbidden.change'
  model.description = '   '
  model.name = '  订单\u3000阶段 '

  assert.equal(hasDictionaryTypeFormChanges(model, TYPE), true)
  assert.deepEqual(buildUpdateDictionaryTypeRequest(model, TYPE), {
    description: null,
    expectedVersion: 7,
    name: '订单 阶段',
  })
  for (const forbidden of ['code', 'enabled', 'id']) {
    assert.equal(
      Object.hasOwn(buildUpdateDictionaryTypeRequest(model, TYPE), forbidden),
      false,
    )
  }

  assert.equal(
    buildUpdateDictionaryTypeRequest(model, { ...TYPE, version: 9 }).expectedVersion,
    9,
  )
})

test('编辑语义未变时只保留 version 且禁止提交', () => {
  const model = createDictionaryTypeFormModel('edit', TYPE)
  model.name = '  订单状态 '
  model.description = ' 订单履约状态 '
  model.sortOrder = '020'

  assert.equal(hasDictionaryTypeFormChanges(model, TYPE), false)
  assert.deepEqual(buildUpdateDictionaryTypeRequest(model, TYPE), {
    expectedVersion: 7,
  })
})

test('409 rebase 合并未编辑字段并标记双方同时修改的字段', () => {
  const model = createDictionaryTypeFormModel('edit', TYPE)
  model.name = '用户修改的名称'
  model.sortOrder = '30'

  const rebased = rebaseDictionaryTypeFormModel(
    model,
    TYPE,
    {
      ...TYPE,
      description: '服务器更新的说明',
      name: '服务器更新的名称',
      version: 8,
    },
  )

  assert.deepEqual(rebased.model, {
    code: TYPE.code,
    description: '服务器更新的说明',
    name: '用户修改的名称',
    sortOrder: '30',
  })
  assert.deepEqual(rebased.conflicts, [{
    field: 'name',
    latestValue: '服务器更新的名称',
  }])

  const sameFinalValue = rebaseDictionaryTypeFormModel(
    { ...model, name: ' 服务器更新的名称 ' },
    TYPE,
    { ...TYPE, name: '服务器更新的名称', version: 8 },
  )
  assert.deepEqual(sameFinalValue.conflicts, [])
})

test('字典类型 Modal 复用项目组件并在提交窗口加锁', () => {
  const modelValueWatcherStart = modalSource.indexOf(
    'watch(\n  () => props.modelValue,',
  )
  const modelValueWatcherEnd = modalSource.indexOf(
    '\n\nwatch(',
    modelValueWatcherStart + 1,
  )
  const modelValueWatcher = modalSource.slice(
    modelValueWatcherStart,
    modelValueWatcherEnd,
  )

  assert.notEqual(modelValueWatcherStart, -1)
  assert.notEqual(modelValueWatcherEnd, -1)
  assert.match(
    modalSource,
    /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u,
  )
  assert.match(modalSource, /<QsGenericModal\b/u)
  assert.match(modalSource, /<FaForm\b/u)
  assert.match(modalSource, /<FaTextarea\b/u)
  assert.match(modalSource, /const submitLocked = computed\(/u)
  assert.match(modalSource, /submissionBlocked\?: boolean/u)
  assert.match(modalSource, /props\.submissionBlocked/u)
  assert.match(modalSource, /rebaseDictionaryTypeFormModel/u)
  assert.match(modalSource, /dictionaryType\?\.version/u)
  assert.match(modalSource, /并发字段需要核对/u)
  assert.match(modalSource, /:submitting="submitLocked"/u)
  assert.match(modelValueWatcher, /submitRequested\.value = false/u)
  assert.match(modelValueWatcher, /\{ immediate: true \}/u)
  assert.doesNotMatch(modelValueWatcher, /flush:/u)
  assert.doesNotMatch(modelValueWatcher, /props\.submitting/u)
  assert.match(
    modalSource,
    /<QsGenericModal\s+v-if="modelValue"\s+:model-value="modelValue"/u,
  )
  assert.match(modalSource, /if \(submitLocked\.value\)/u)
  assert.match(modalSource, /requestId:/u)
  assert.match(modalSource, /typeId: editType\.id/u)
  assert.match(modalSource, /expectedVersion/u)
  assert.match(modalSource, /:disabled="isEditing \|\| submitLocked"/u)
  assert.equal(
    modalSource.match(/class="min-h-11 w-full sm:w-auto"/gu)?.length,
    2,
  )
  assert.equal(
    modalSource.match(/input-class="min-h-11 sm:min-h-9"/gu)?.length,
    3,
  )
  assert.doesNotMatch(modalSource, /#[\dA-Fa-f]{3,8}\b/u)
  assert.doesNotMatch(modalSource, /(?:Inter|Roboto|Arial|system-ui)/u)
  assert.doesNotMatch(modalSource, /\p{Extended_Pictographic}/u)
})
