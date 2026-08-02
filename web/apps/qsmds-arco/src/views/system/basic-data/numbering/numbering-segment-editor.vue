<script setup lang="ts">
import type { NumberingSegmentType } from './numbering-editor.logic'
import type {
  NumberingRuleSegment,
} from './numbering-management.logic'

import {
  coerceNumberingEditorInteger,
  createNumberingSegment,
  formatNumberingSegmentActionLabel,
  replaceNumberingSegment,
} from './numbering-editor.logic'
import {
  addNumberingSegment,
  moveNumberingSegment,
  removeNumberingSegment,
} from './numbering-management.logic'

defineOptions({ name: 'NumberingSegmentEditor' })

const props = withDefaults(defineProps<{
  disabled?: boolean
  errors?: Readonly<Record<string, string>>
  modelValue: readonly NumberingRuleSegment[]
}>(), {
  disabled: false,
  errors: () => ({}),
})

const emit = defineEmits<{
  'update:modelValue': [segments: NumberingRuleSegment[]]
}>()

const segmentType = ref<NumberingSegmentType>('FIXED')

const SEGMENT_TYPE_OPTIONS: Array<{
  label: string
  value: NumberingSegmentType
}> = [
  { label: '固定字符', value: 'FIXED' },
  { label: '日期', value: 'DATE' },
  { label: '分隔符', value: 'SEPARATOR' },
  { label: '自增数字', value: 'SEQUENCE' },
  { label: '随机字符串', value: 'RANDOM' },
]

const DATE_FORMAT_OPTIONS: Array<{
  label: string
  value: Extract<NumberingRuleSegment, { type: 'DATE' }>['format']
}> = [
  { label: 'YYYY（四位年）', value: 'YYYY' },
  { label: 'YY（两位年）', value: 'YY' },
  { label: 'MM（月）', value: 'MM' },
  { label: 'DD（日）', value: 'DD' },
  { label: 'YYYYMM', value: 'YYYYMM' },
  { label: 'YYYYMMDD', value: 'YYYYMMDD' },
  { label: 'YYMMDD', value: 'YYMMDD' },
]

const SEPARATOR_OPTIONS: Array<{
  label: string
  value: Extract<NumberingRuleSegment, { type: 'SEPARATOR' }>['value']
}> = [
  { label: '-（短横线）', value: '-' },
  { label: '_（下划线）', value: '_' },
  { label: '.（点）', value: '.' },
  { label: '/（斜杠）', value: '/' },
]

const RANDOM_MODE_OPTIONS: Array<{
  label: string
  value: Extract<NumberingRuleSegment, { type: 'RANDOM' }>['mode']
}> = [
  { label: '先字母后数字', value: 'LETTERS_THEN_DIGITS' },
  { label: '字母数字打散', value: 'SHUFFLED' },
]

function segmentLabel(type: NumberingSegmentType): string {
  return SEGMENT_TYPE_OPTIONS.find(option => option.value === type)?.label ?? type
}

function emitSegments(segments: readonly NumberingRuleSegment[]): void {
  // 发出的每个片段都重新复制，避免父层与本组件随后共享可变引用。
  emit('update:modelValue', segments.map(segment => ({ ...segment })))
}

function handleSegmentType(value: unknown): void {
  if (SEGMENT_TYPE_OPTIONS.some(option => option.value === value)) {
    segmentType.value = value as NumberingSegmentType
  }
}

function addSegment(): void {
  if (props.disabled || props.modelValue.length >= 32) {
    return
  }
  emitSegments(addNumberingSegment(
    props.modelValue,
    createNumberingSegment(segmentType.value),
  ))
}

function moveSegment(index: number, direction: 'down' | 'up'): void {
  if (!props.disabled) {
    emitSegments(moveNumberingSegment(props.modelValue, index, direction))
  }
}

function removeSegment(index: number): void {
  if (!props.disabled) {
    emitSegments(removeNumberingSegment(props.modelValue, index))
  }
}

function replaceSegment(index: number, segment: NumberingRuleSegment): void {
  if (!props.disabled) {
    emitSegments(replaceNumberingSegment(props.modelValue, index, segment))
  }
}

function updateFixed(
  index: number,
  segment: Extract<NumberingRuleSegment, { type: 'FIXED' }>,
  value: unknown,
): void {
  replaceSegment(index, {
    ...segment,
    value: String(value ?? '').toUpperCase(),
  })
}

function updateDate(
  index: number,
  segment: Extract<NumberingRuleSegment, { type: 'DATE' }>,
  value: unknown,
): void {
  if (DATE_FORMAT_OPTIONS.some(option => option.value === value)) {
    replaceSegment(index, {
      ...segment,
      format: value as typeof segment.format,
    })
  }
}

function updateSeparator(
  index: number,
  segment: Extract<NumberingRuleSegment, { type: 'SEPARATOR' }>,
  value: unknown,
): void {
  if (SEPARATOR_OPTIONS.some(option => option.value === value)) {
    replaceSegment(index, {
      ...segment,
      value: value as typeof segment.value,
    })
  }
}

function updateSequence(
  index: number,
  segment: Extract<NumberingRuleSegment, { type: 'SEQUENCE' }>,
  field: 'startValue' | 'step' | 'width',
  value: unknown,
): void {
  replaceSegment(index, {
    ...segment,
    [field]: field === 'width'
      ? coerceNumberingEditorInteger(value)
      : String(value ?? ''),
  })
}

function updateRandom(
  index: number,
  segment: Extract<NumberingRuleSegment, { type: 'RANDOM' }>,
  field: 'digitLength' | 'letterLength',
  value: unknown,
): void {
  replaceSegment(index, {
    ...segment,
    [field]: coerceNumberingEditorInteger(value),
  })
}

function updateRandomMode(
  index: number,
  segment: Extract<NumberingRuleSegment, { type: 'RANDOM' }>,
  value: unknown,
): void {
  if (RANDOM_MODE_OPTIONS.some(option => option.value === value)) {
    replaceSegment(index, {
      ...segment,
      mode: value as typeof segment.mode,
    })
  }
}

function fieldError(index: number, field?: string): string | undefined {
  const path = field === undefined
    ? `segments[${index}]`
    : `segments[${index}].${field}`
  return props.errors[path]
}
</script>

<template>
  <section aria-labelledby="numbering-segment-editor-title">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0">
        <h3 id="numbering-segment-editor-title" class="qs-type-section-title m-0">
          编号片段
        </h3>
        <p class="qs-type-description mb-0 mt-1">
          片段按列表顺序拼接。使用上移、下移调整顺序，最多 32 个片段。
        </p>
      </div>

      <div class="flex flex-col gap-2 min-[390px]:flex-row min-[390px]:items-end">
        <label class="gap-1.5 grid min-w-48">
          <span class="qs-type-compact-label">新片段类型</span>
          <FaSelect
            :model-value="segmentType"
            :options="SEGMENT_TYPE_OPTIONS"
            :disabled="disabled"
            aria-label="新片段类型"
            class="w-full"
            @update:model-value="handleSegmentType"
          />
        </label>
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 md:min-h-9"
          :disabled="disabled || modelValue.length >= 32"
          @click="addSegment"
        >
          <FaIcon name="i-lucide:plus" />
          添加片段
        </FaButton>
      </div>
    </div>

    <FaAlert
      v-if="errors.segments"
      class="mb-4"
      icon="i-lucide:circle-alert"
      title="片段配置有误"
      :description="errors.segments"
      variant="destructive"
      role="alert"
    />

    <FaEmpty
      v-if="modelValue.length === 0"
      icon="i-lucide:brackets"
      title="尚未配置编号片段"
      description="至少添加一个自增数字或随机字符串片段。"
      class="border border-border rounded-lg min-h-40"
    />

    <ol v-else class="m-0 p-0 list-none gap-3 grid">
      <li
        v-for="(segment, index) in modelValue"
        :key="`${segment.type}-${index}`"
        class="p-4 border border-border rounded-lg bg-background min-w-0"
      >
        <div class="mb-4 flex gap-3 min-w-0 items-start justify-between">
          <div class="flex gap-2 min-w-0 items-center">
            <span
              class="qs-type-meta border border-border rounded-md bg-muted flex shrink-0 size-7 items-center justify-center tabular-nums"
              aria-hidden="true"
            >
              {{ index + 1 }}
            </span>
            <div class="min-w-0">
              <h4 class="qs-type-body-medium m-0">
                {{ segmentLabel(segment.type) }}
              </h4>
              <p class="qs-type-meta m-0">
                {{ segment.type }}
              </p>
            </div>
          </div>

          <div class="flex shrink-0 items-center">
            <FaButton
              type="button"
              variant="ghost"
              size="icon"
              class="size-11 md:size-9"
              :aria-label="formatNumberingSegmentActionLabel('up', index, segment.type)"
              :disabled="disabled || index === 0"
              @click="moveSegment(index, 'up')"
            >
              <FaIcon name="i-lucide:arrow-up" class="size-4" />
            </FaButton>
            <FaButton
              type="button"
              variant="ghost"
              size="icon"
              class="size-11 md:size-9"
              :aria-label="formatNumberingSegmentActionLabel('down', index, segment.type)"
              :disabled="disabled || index === modelValue.length - 1"
              @click="moveSegment(index, 'down')"
            >
              <FaIcon name="i-lucide:arrow-down" class="size-4" />
            </FaButton>
            <FaButton
              type="button"
              variant="ghost"
              size="icon"
              class="size-11 md:size-9"
              :aria-label="formatNumberingSegmentActionLabel('remove', index, segment.type)"
              :disabled="disabled"
              @click="removeSegment(index)"
            >
              <FaIcon name="i-lucide:trash-2" class="size-4" />
            </FaButton>
          </div>
        </div>

        <div v-if="segment.type === 'FIXED'" class="gap-1.5 grid">
          <label :for="`numbering-fixed-${index}`" class="qs-type-compact-label">
            固定字符
          </label>
          <FaInput
            :id="`numbering-fixed-${index}`"
            :model-value="segment.value"
            autocapitalize="characters"
            autocomplete="off"
            class="font-mono w-full uppercase"
            :disabled="disabled"
            maxlength="64"
            placeholder="例如 SO"
            spellcheck="false"
            @update:model-value="value => updateFixed(index, segment, value)"
          />
          <p v-if="fieldError(index, 'value')" class="qs-type-meta text-destructive m-0" role="alert">
            {{ fieldError(index, 'value') }}
          </p>
        </div>

        <div v-else-if="segment.type === 'DATE'" class="gap-1.5 grid">
          <label :for="`numbering-date-${index}`" class="qs-type-compact-label">
            日期格式
          </label>
          <FaSelect
            :id="`numbering-date-${index}`"
            :model-value="segment.format"
            :options="DATE_FORMAT_OPTIONS"
            :disabled="disabled"
            class="w-full"
            @update:model-value="value => updateDate(index, segment, value)"
          />
          <p v-if="fieldError(index, 'format')" class="qs-type-meta text-destructive m-0" role="alert">
            {{ fieldError(index, 'format') }}
          </p>
        </div>

        <div v-else-if="segment.type === 'SEPARATOR'" class="gap-1.5 grid">
          <label :for="`numbering-separator-${index}`" class="qs-type-compact-label">
            分隔符
          </label>
          <FaSelect
            :id="`numbering-separator-${index}`"
            :model-value="segment.value"
            :options="SEPARATOR_OPTIONS"
            :disabled="disabled"
            class="w-full"
            @update:model-value="value => updateSeparator(index, segment, value)"
          />
          <p v-if="fieldError(index, 'value')" class="qs-type-meta text-destructive m-0" role="alert">
            {{ fieldError(index, 'value') }}
          </p>
        </div>

        <div
          v-else-if="segment.type === 'SEQUENCE'"
          class="gap-4 grid grid-cols-1 sm:grid-cols-3"
        >
          <label class="gap-1.5 grid">
            <span class="qs-type-compact-label">位数</span>
            <FaInput
              :model-value="segment.width"
              :disabled="disabled"
              inputmode="numeric"
              min="1"
              max="18"
              step="1"
              type="number"
              @update:model-value="value => updateSequence(index, segment, 'width', value)"
            />
            <span v-if="fieldError(index, 'width')" class="qs-type-meta text-destructive" role="alert">
              {{ fieldError(index, 'width') }}
            </span>
          </label>
          <label class="gap-1.5 grid">
            <span class="qs-type-compact-label">起始值</span>
            <FaInput
              :model-value="segment.startValue"
              :disabled="disabled"
              class="font-mono"
              inputmode="numeric"
              placeholder="1"
              @update:model-value="value => updateSequence(index, segment, 'startValue', value)"
            />
            <span v-if="fieldError(index, 'startValue')" class="qs-type-meta text-destructive" role="alert">
              {{ fieldError(index, 'startValue') }}
            </span>
          </label>
          <label class="gap-1.5 grid">
            <span class="qs-type-compact-label">步长</span>
            <FaInput
              :model-value="segment.step"
              :disabled="disabled"
              class="font-mono"
              inputmode="numeric"
              placeholder="1"
              @update:model-value="value => updateSequence(index, segment, 'step', value)"
            />
            <span v-if="fieldError(index, 'step')" class="qs-type-meta text-destructive" role="alert">
              {{ fieldError(index, 'step') }}
            </span>
          </label>
        </div>

        <div
          v-else-if="segment.type === 'RANDOM'"
          class="gap-4 grid grid-cols-1 sm:grid-cols-3"
        >
          <label class="gap-1.5 grid">
            <span class="qs-type-compact-label">大写字母长度</span>
            <FaInput
              :model-value="segment.letterLength"
              :disabled="disabled"
              inputmode="numeric"
              min="0"
              max="32"
              step="1"
              type="number"
              @update:model-value="value => updateRandom(index, segment, 'letterLength', value)"
            />
            <span v-if="fieldError(index, 'letterLength')" class="qs-type-meta text-destructive" role="alert">
              {{ fieldError(index, 'letterLength') }}
            </span>
          </label>
          <label class="gap-1.5 grid">
            <span class="qs-type-compact-label">数字长度</span>
            <FaInput
              :model-value="segment.digitLength"
              :disabled="disabled"
              inputmode="numeric"
              min="0"
              max="32"
              step="1"
              type="number"
              @update:model-value="value => updateRandom(index, segment, 'digitLength', value)"
            />
            <span v-if="fieldError(index, 'digitLength')" class="qs-type-meta text-destructive" role="alert">
              {{ fieldError(index, 'digitLength') }}
            </span>
          </label>
          <label class="gap-1.5 grid">
            <span class="qs-type-compact-label">组合方式</span>
            <FaSelect
              :model-value="segment.mode"
              :options="RANDOM_MODE_OPTIONS"
              :disabled="disabled"
              class="w-full"
              @update:model-value="value => updateRandomMode(index, segment, value)"
            />
            <span v-if="fieldError(index, 'mode')" class="qs-type-meta text-destructive" role="alert">
              {{ fieldError(index, 'mode') }}
            </span>
          </label>
          <p
            v-if="fieldError(index)"
            class="qs-type-meta text-destructive m-0 sm:col-span-3"
            role="alert"
          >
            {{ fieldError(index) }}
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>
