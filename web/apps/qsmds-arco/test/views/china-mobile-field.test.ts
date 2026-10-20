import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 页面纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import { reactive } from 'vue'

import { useChinaMobileField } from '../../src/composables/app/use-china-mobile-field'

test('手机号字段把存量 +86 号码剥离为 11 位展示并保留原始 E.164', () => {
  const model = reactive({ mobileE164: '+8615224205635' })
  const field = useChinaMobileField({
    getInitial: () => '+8615224205635',
    getValue: () => model.mobileE164,
    setValue: (value) => {
      model.mobileE164 = value
    },
  })

  assert.equal(field.national.value, '15224205635')
  assert.equal(field.unsupported.value, false)
  assert.equal(model.mobileE164, '+8615224205635')
})

test('手机号字段输入只写回 +86 拼接值，清空写回空串', () => {
  const model = reactive({ mobileE164: '' })
  const field = useChinaMobileField({
    getInitial: () => null,
    getValue: () => model.mobileE164,
    setValue: (value) => {
      model.mobileE164 = value
    },
  })

  field.onInput('13800138000')
  assert.equal(model.mobileE164, '+8613800138000')
  field.syncFromModel()
  assert.equal(field.national.value, '13800138000')

  field.onInput('139 0013 9000')
  assert.equal(model.mobileE164, '+8613900139000')
  field.syncFromModel()
  assert.equal(field.national.value, '13900139000')

  field.onInput('139001390011')
  assert.equal(model.mobileE164, '+8613900139000')
  assert.equal(field.inputNotice.value, 'length')

  field.onInput('+886912345678')
  assert.equal(model.mobileE164, '+8613900139000')
  assert.equal(field.inputNotice.value, 'foreign')

  field.clearUnsupported()
  assert.equal(model.mobileE164, '')
  assert.equal(field.national.value, '')
})
