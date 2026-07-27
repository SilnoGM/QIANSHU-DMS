import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 地区表单组件契约使用 Node.js 内置 runner。
import test from 'node:test'

const source = readFileSync(
  new URL(
    '../../src/views/system/basic-data/regions/region-form-modal.vue',
    import.meta.url,
  ),
  'utf8',
)

test('地区表单只组合 QsGenericModal 并把副作用留在页面', () => {
  assert.match(source, /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u)
  assert.match(source, /<QsGenericModal\b/u)
  assert.match(source, /defineProps<RegionFormModalProps>/u)
  assert.match(source, /defineEmits<RegionFormModalEmits>/u)
  assert.doesNotMatch(source, /<FaModal\b|@\/api|useApp\w*Store|RegionSelectorProvider|useFaToast/u)
})

test('创建和编辑字段差异明确且编辑 code 只读', () => {
  assert.match(source, /父级路径/u)
  assert.match(source, /目标层级/u)
  assert.match(source, /v-if="mode === 'edit'"[\s\S]*?地区 Code/u)
  assert.match(source, /v-if="mode === 'create'"[\s\S]*?name="code"/u)
  assert.match(source, /v-if="mode === 'create'"[\s\S]*?name="enabled"/u)
  assert.match(source, /name="name"/u)
  assert.match(source, /name="englishName"/u)
  assert.match(source, /name="sortOrder"/u)
  assert.match(
    source,
    /<FaFormItem[\s\S]*?name="enabled"[\s\S]*?>\s*<FaSwitch/u,
  )
})

test('提交锁覆盖 Modal、表单、footer 和同步重复点击窗口', () => {
  assert.match(source, /const submitRequested = ref\(false\)/u)
  assert.match(source, /const submitLocked = computed\(\(\) => props\.submitting \|\| submitRequested\.value\)/u)
  assert.match(source, /if \(submitLocked\.value\) \{\s*return\s*\}/u)
  assert.match(source, /:submitting="submitLocked"/u)
  assert.match(source, /:disabled="submitLocked"/u)
  assert.match(source, /:loading="submitLocked"/u)
})

test('字段错误保留安全摘要、requestId 并聚焦首个错误字段', () => {
  assert.match(source, /role="alert"/u)
  assert.match(source, /requestId:/u)
  assert.match(source, /formRef\.value\?\.setFieldError/u)
  assert.match(source, /formRef\.value\?\.scrollToField\(firstField\)/u)
  assert.match(source, /await nextTick\(\)/u)
})

test('FaInput 清空统一回写空字符串且窄屏 footer 使用全宽按钮', () => {
  assert.equal(source.match(/@clear="model\.\w+ = ''"/gu)?.length, 4)
  assert.match(source, /class="min-h-11 w-full sm:w-auto"/u)
  assert.doesNotMatch(source, /gradient|#[\dA-Fa-f]{3,8}\b|rgba?\(/u)
})
