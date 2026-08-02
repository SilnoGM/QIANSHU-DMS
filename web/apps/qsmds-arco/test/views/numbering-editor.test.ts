import type { NumberingRuleFormModel } from '../../src/views/system/basic-data/numbering/numbering-management.logic'

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 编号编辑器纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  cloneNumberingRuleFormModel,
  createNumberingEditorCloseBypass,
  createNumberingSegment,
  formatNumberingSegmentActionLabel,
  isNumberingRuleFormDirty,
  replaceNumberingSegment,
  resolveNumberingEditorFieldErrors,
} from '../../src/views/system/basic-data/numbering/numbering-editor.logic'

const VIEW_ROOT = new URL(
  '../../src/views/system/basic-data/numbering/',
  import.meta.url,
)

const SOURCE_MODEL: NumberingRuleFormModel = {
  description: '销售订单编号',
  name: '销售订单',
  resetPolicy: 'DAILY',
  ruleCode: 'SALES_ORDER',
  segments: [
    { type: 'FIXED', value: 'SO' },
    { type: 'DATE', format: 'YYYYMMDD' },
    { type: 'SEPARATOR', value: '-' },
    {
      type: 'SEQUENCE',
      startValue: '1',
      step: '1',
      width: 6,
    },
  ],
}

test('表单深拷贝、替换与 dirty 比较不共享任何片段引用', () => {
  const cloned = cloneNumberingRuleFormModel(SOURCE_MODEL)
  const replaced = replaceNumberingSegment(
    cloned.segments,
    0,
    { type: 'FIXED', value: 'PO' },
  )

  assert.notEqual(cloned, SOURCE_MODEL)
  assert.notEqual(cloned.segments, SOURCE_MODEL.segments)
  assert.notEqual(cloned.segments[0], SOURCE_MODEL.segments[0])
  assert.equal(isNumberingRuleFormDirty(cloned, SOURCE_MODEL), false)
  assert.deepEqual(replaced.map(segment => segment.type), [
    'FIXED',
    'DATE',
    'SEPARATOR',
    'SEQUENCE',
  ])
  assert.equal((replaced[0] as { value: string }).value, 'PO')
  assert.equal((SOURCE_MODEL.segments[0] as { value: string }).value, 'SO')
  assert.equal(isNumberingRuleFormDirty({ ...cloned, segments: replaced }, SOURCE_MODEL), true)
})

test('五类片段工厂返回可直接编辑且相互隔离的默认值', () => {
  assert.deepEqual(createNumberingSegment('FIXED'), {
    type: 'FIXED',
    value: 'PREFIX',
  })
  assert.deepEqual(createNumberingSegment('DATE'), {
    type: 'DATE',
    format: 'YYYYMMDD',
  })
  assert.deepEqual(createNumberingSegment('SEPARATOR'), {
    type: 'SEPARATOR',
    value: '-',
  })
  assert.deepEqual(createNumberingSegment('SEQUENCE'), {
    type: 'SEQUENCE',
    width: 6,
    startValue: '1',
    step: '1',
  })
  assert.deepEqual(createNumberingSegment('RANDOM'), {
    type: 'RANDOM',
    letterLength: 4,
    digitLength: 4,
    mode: 'LETTERS_THEN_DIGITS',
  })

  const first = createNumberingSegment('SEQUENCE')
  const second = createNumberingSegment('SEQUENCE')
  assert.notEqual(first, second)
})

test('片段操作名称同时包含动作、可见序号与片段类型', () => {
  assert.equal(
    formatNumberingSegmentActionLabel('up', 0, 'FIXED'),
    '上移第 1 个固定字符片段',
  )
  assert.equal(
    formatNumberingSegmentActionLabel('down', 2, 'SEQUENCE'),
    '下移第 3 个自增数字片段',
  )
  assert.equal(
    formatNumberingSegmentActionLabel('remove', 4, 'RANDOM'),
    '删除第 5 个随机字符串片段',
  )
})

test('关闭 bypass 只允许下一次关闭，消费后立即恢复 dirty 守卫', () => {
  const bypass = createNumberingEditorCloseBypass()

  assert.equal(bypass.consume(), false)
  bypass.arm()
  assert.equal(bypass.consume(), true)
  assert.equal(bypass.consume(), false)
  bypass.arm()
  bypass.reset()
  assert.equal(bypass.consume(), false)
})

test('本地与 Server fieldErrors 合并时保留片段路径并由本地结果优先', () => {
  assert.deepEqual(resolveNumberingEditorFieldErrors(
    {
      'name': '本地名称错误',
      'segments[1].width': '本地位数错误',
    },
    {
      'name': 'Server 名称错误',
      'segments[2].step': 'Server 步长错误',
    },
  ), {
    'name': '本地名称错误',
    'segments[1].width': '本地位数错误',
    'segments[2].step': 'Server 步长错误',
  })
})

test('编辑抽屉契约覆盖 xl、隔离模型、预览提交、错误和一次性关闭旁路', async () => {
  const source = await readFile(new URL('numbering-rule-editor-drawer.vue', VIEW_ROOT), 'utf8')

  assert.match(source, /QsGenericDrawer/)
  assert.match(source, /size="xl"/)
  assert.match(source, /create:\s*'新建编号规则'/)
  assert.match(source, /formModel:\s*NumberingRuleFormModel/)
  assert.match(source, /loading\?:\s*boolean/)
  assert.match(source, /'update:formModel'/)
  assert.match(source, /'closed': \[\]/)
  assert.match(source, /'preview'/)
  assert.match(source, /'submit'/)
  assert.match(source, /'closeRequest'/)
  assert.match(source, /:before-close="handleBeforeClose"/)
  assert.match(source, /@closed="handleClosed"/)
  assert.match(source, /closeWithoutDirtyGuard/)
  assert.match(source, /cloneNumberingRuleFormModel/)
  assert.match(source, /role="alert"/)
  assert.match(source, /requestId:/)
  assert.match(source, /Asia\/Shanghai/)
  assert.match(source, /:submitting="submitLocked"/)
  assert.match(source, /:loading="loading"/)
  assert.match(source, /props\.loading/)
  assert.match(source, /emit\('closed'\)/)
  assert.match(source, /submitRequested/)
  assert.match(source, /label="规则编码"/)
  assert.match(source, /Rule Code/)
  assert.doesNotMatch(source, /name="name"[\s\S]{0,360}maxlength=/)
  assert.doesNotMatch(source, /name="description"[\s\S]{0,360}maxlength=/)
  assert.match(source, /mode === 'clone'/)
  assert.match(source, /来源配置由 Server 复制，只可改 code\/name\/description/)
  assert.match(source, /effectiveConfigurationLocked/)
  assert.match(source, /hasIssuances/)
  assert.match(source, /Server 只接受名称、说明或自增数字位数扩大/)
  assert.match(source, /:disabled="submitLocked \|\| effectiveConfigurationLocked"/)
  assert.match(source, /<FaFormItem name="segments" hide-label :auto-bind="false">/)
  assert.match(source, /class="gap-6 grid min-w-0"/)
  assert.match(source, /<aside class="min-w-0">/)
  assert.doesNotMatch(source, /lg:grid-cols-/)
  assert.doesNotMatch(source, /lg:sticky/)
  assert.doesNotMatch(source, /timezone[^\n]*(?:select|option)/i)
  assert.doesNotMatch(source, /<FaCard\b/)
  assert.doesNotMatch(source, /gradient/i)
  assert.doesNotMatch(source, /#[\dA-F]{3,8}/i)
})

test('片段编辑器支持五类有序片段和可访问的上移、下移、删除操作', async () => {
  const source = await readFile(new URL('numbering-segment-editor.vue', VIEW_ROOT), 'utf8')

  for (const type of ['FIXED', 'DATE', 'SEPARATOR', 'SEQUENCE', 'RANDOM']) {
    assert.match(source, new RegExp(`['"]${type}['"]`))
  }
  assert.match(source, /formatNumberingSegmentActionLabel/)
  assert.match(source, /:aria-label="formatNumberingSegmentActionLabel\('up', index, segment\.type\)"/)
  assert.match(source, /:aria-label="formatNumberingSegmentActionLabel\('down', index, segment\.type\)"/)
  assert.match(source, /:aria-label="formatNumberingSegmentActionLabel\('remove', index, segment\.type\)"/)
  assert.match(source, /moveNumberingSegment/)
  assert.match(source, /removeNumberingSegment/)
  assert.match(source, /update:modelValue/)
  assert.match(
    source,
    /id="numbering-segment-editor-title"[\s\S]{0,260}<\/div>[\s\S]{0,180}grid-cols-\[minmax\(0,1fr\)_auto\]/,
  )
  assert.doesNotMatch(
    source,
    /id="numbering-segment-editor-title"[\s\S]{0,420}sm:flex-row/,
  )

  const sequenceBlock = source.match(
    /v-else-if="segment\.type === 'SEQUENCE'"[\s\S]+?v-else-if="segment\.type === 'RANDOM'"/,
  )?.[0]
  const randomBlock = source.match(
    /v-else-if="segment\.type === 'RANDOM'"[\s\S]+?<\/div>\s*<\/li>/,
  )?.[0]

  assert.ok(sequenceBlock)
  assert.ok(randomBlock)
  const constrainedControlCount = (block: string): number =>
    [...block.matchAll(/class="([^"]+)"/g)].filter(([, className]) => {
      const tokens = className?.split(/\s+/u) ?? []
      return tokens.includes('min-w-0') && tokens.includes('w-full')
    }).length

  assert.equal(
    sequenceBlock.match(/<label class="gap-1\.5 grid min-w-0">/g)?.length,
    3,
  )
  assert.equal(constrainedControlCount(sequenceBlock), 3)
  assert.equal(
    randomBlock.match(/<label class="gap-1\.5 grid min-w-0">/g)?.length,
    3,
  )
  assert.equal(constrainedControlCount(randomBlock), 3)
  assert.doesNotMatch(source, /sortable|draggable|drag-handle/i)
  assert.doesNotMatch(source, /<FaCard\b/)
  assert.doesNotMatch(source, /gradient/i)
  assert.doesNotMatch(source, /#[\dA-F]{3,8}/i)
})

test('预览组件完整展示 Server 样例、容量、使用量、剩余量和下一编号', async () => {
  const source = await readFile(new URL('numbering-rule-preview.vue', VIEW_ROOT), 'utf8')

  assert.match(source, /preview\.samples/)
  assert.match(source, /preview\.capacity/)
  assert.match(source, /preview\.usedCount/)
  assert.match(source, /preview\.remainingCount/)
  assert.match(source, /preview\.nextNumberPreview/)
  assert.match(source, /data-testid="numbering-preview-title"/)
  assert.match(source, /formatNumberingDecimal/)
  assert.match(source, /role="alert"/)
  assert.match(source, /Asia\/Shanghai/)
  assert.doesNotMatch(source, /<FaCard\b/)
  assert.doesNotMatch(source, /gradient/i)
  assert.doesNotMatch(source, /#[\dA-F]{3,8}/i)
})
