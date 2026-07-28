import type { RegionDto } from '../../src/api/generated/types.gen'
import type { RegionFormModel } from '../../src/views/system/basic-data/regions/region-form.logic'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 地区表单纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildCreateRegionFormSubmit,
  buildUpdateRegionFormSubmit,
  createRegionFormModel,
  firstRegionFormErrorField,
  formatRegionFormParentPath,
  normalizeRegionFormCode,
  normalizeRegionFormText,
  resolveRegionFormFieldErrors,
  validateRegionForm,
} from '../../src/views/system/basic-data/regions/region-form.logic'

const EDIT_REGION: RegionDto = {
  administrativeType: 'CITY',
  code: 'TW-64000',
  createdAt: '2026-07-27T00:00:00.000Z',
  effectiveEnabled: true,
  enabled: true,
  englishName: 'Kaohsiung City',
  id: '00000000-0000-4000-8000-000000000003',
  level: 'CITY',
  name: '高雄市',
  parentId: '00000000-0000-4000-8000-000000000002',
  sortOrder: 10,
  sourceCode: null,
  sourceName: null,
  updatedAt: '2026-07-27T00:00:00.000Z',
}

function validCreateModel(): RegionFormModel {
  return {
    code: ' tw-64000 ',
    enabled: true,
    englishName: '  Kaohsiung\u3000City  ',
    name: '  高雄市  ',
    sortOrder: '10',
  }
}

test('地区表单按 Server 规则执行 NFC、Unicode 空白与 code 大写规范化', () => {
  assert.equal(
    normalizeRegionFormText('  Cafe\u0301\u3000  上海 \n'),
    'Café 上海',
  )
  assert.equal(normalizeRegionFormCode(' tw-64000 '), 'TW-64000')
})

test('地区表单父级路径使用空格分隔完整地址', () => {
  assert.equal(formatRegionFormParentPath([]), '全部地区（根）')
  assert.equal(
    formatRegionFormParentPath(['中国台湾', '台湾']),
    '中国台湾 台湾',
  )
})

test('创建校验固定名称、code、整数排序和启用状态边界', () => {
  assert.deepEqual(validateRegionForm(validCreateModel(), 'create'), {})

  const invalid: RegionFormModel = {
    code: 'bad code',
    enabled: undefined as unknown as boolean,
    englishName: '😀'.repeat(129),
    name: '\u3000 \n',
    sortOrder: '2147483648',
  }

  assert.deepEqual(validateRegionForm(invalid, 'create'), {
    name: '名称长度必须为 1 到 128 个字符',
    englishName: '英文名长度不能超过 128 个字符',
    code: 'Code 只能包含 2 到 64 位英文字母、数字、点、下划线和连字符',
    sortOrder: '排序必须是 0 到 2147483647 之间的整数',
    enabled: '请选择自身状态',
  })
})

test('创建提交只输出创建 DTO，规范化 code 且空英文名不进入请求', () => {
  assert.deepEqual(
    buildCreateRegionFormSubmit(
      validCreateModel(),
      '00000000-0000-4000-8000-000000000002',
    ),
    {
      mode: 'create',
      value: {
        code: 'TW-64000',
        enabled: true,
        englishName: 'Kaohsiung City',
        name: '高雄市',
        parentId: '00000000-0000-4000-8000-000000000002',
        sortOrder: 10,
      },
    },
  )

  const withoutEnglishName = validCreateModel()
  withoutEnglishName.englishName = '\u3000'
  assert.equal(
    Object.hasOwn(
      buildCreateRegionFormSubmit(withoutEnglishName, null).value,
      'englishName',
    ),
    false,
  )
})

test('number input 回写有限 number 时仍按整数排序校验与提交', () => {
  const model = validCreateModel()
  model.sortOrder = 9900

  assert.deepEqual(validateRegionForm(model, 'create'), {})
  assert.equal(
    buildCreateRegionFormSubmit(model, null).value.sortOrder,
    9900,
  )
})

test('编辑只提交实际变化的三个可变字段，规范化等价值不会制造 patch', () => {
  const unchanged = createRegionFormModel('edit', EDIT_REGION)
  unchanged.name = ' 高雄市 '
  unchanged.englishName = 'Kaohsiung\u3000 City'
  unchanged.sortOrder = '010'

  assert.deepEqual(
    buildUpdateRegionFormSubmit(unchanged, EDIT_REGION),
    {
      mode: 'edit',
      value: {},
    },
  )

  unchanged.name = '高雄'
  unchanged.englishName = ' \u3000 '
  unchanged.sortOrder = '20'
  const submit = buildUpdateRegionFormSubmit(unchanged, EDIT_REGION)

  assert.deepEqual(submit, {
    mode: 'edit',
    value: {
      englishName: null,
      name: '高雄',
      sortOrder: 20,
    },
  })
  for (const forbidden of [
    'id',
    'code',
    'level',
    'parentId',
    'enabled',
  ]) {
    assert.equal(Object.hasOwn(submit.value, forbidden), false)
  }
})

test('编辑校验忽略只读 code/enabled，首错顺序与视觉表单一致', () => {
  const model = createRegionFormModel('edit', EDIT_REGION)
  model.code = 'invalid code'
  model.enabled = undefined as unknown as boolean
  assert.deepEqual(validateRegionForm(model, 'edit'), {})

  assert.equal(
    firstRegionFormErrorField({
      code: 'Code 冲突',
      name: '名称冲突',
      sortOrder: '排序错误',
    }, 'create'),
    'name',
  )
  assert.equal(
    firstRegionFormErrorField({
      code: '不应聚焦编辑只读字段',
      sortOrder: '排序错误',
    }, 'edit'),
    'sortOrder',
  )
})

test('Server 字段错误支持字符串数组且编辑态丢弃只读字段', () => {
  assert.deepEqual(
    resolveRegionFormFieldErrors({
      code: ['Code 已存在', '第二条不展示'],
      enabled: '状态错误',
      name: ['名称已存在'],
      sortOrder: [],
    }, 'create'),
    {
      code: 'Code 已存在',
      enabled: '状态错误',
      name: '名称已存在',
    },
  )
  assert.deepEqual(
    resolveRegionFormFieldErrors({
      code: '编辑请求不应出现',
      enabled: '编辑请求不应出现',
      name: '名称已存在',
    }, 'edit'),
    {
      name: '名称已存在',
    },
  )
})
