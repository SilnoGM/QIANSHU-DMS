<script setup lang="ts">
import type { CalendarDate, DateValue } from '@internationalized/date'
import type { QsDateTimeBounds, QsDateTimePrecision } from './types'
import { toCalendarDate } from '@internationalized/date'
import { cn } from '@/utils'
import { serverNow } from '@/utils/server-clock'
import {
  currentDateTimeParts,
  formatDateTimeValue,
  formatDisplayValue,
  formatDraftTime,
  isDateOutsideBounds,
  parseDateTimeValue,
  parseDraftTime,
  resolveDateTimeBounds,
  validateDateTimeParts,
} from './logic'
import TimeWheelPanel from './time-wheel-panel.vue'

defineOptions({ name: 'QsDateTimeField', inheritAttrs: false })

const props = withDefaults(defineProps<{
  ariaLabel?: string
  clearable?: boolean
  disableFuture?: boolean
  disabled?: boolean
  max?: string
  min?: string
  placeholder?: string
  precision?: QsDateTimePrecision
  triggerClass?: string
}>(), {
  ariaLabel: '',
  clearable: false,
  disableFuture: false,
  disabled: false,
  max: undefined,
  min: undefined,
  placeholder: '',
  precision: 'date',
  triggerClass: '',
})

const emit = defineEmits<{
  'blur': []
  'change': [value: string]
  'update:open': [value: boolean]
}>()

const modelValue = defineModel<string>({ required: true })
const open = ref(false)
const timeOpen = ref(false)
const draftDate = shallowRef<CalendarDate>()
const draftHour = ref(0)
const draftMinute = ref(0)
const draftSecond = ref(0)
const draftMillisecond = ref(0)
const nowDate = shallowRef(new Date())
const panelRef = useTemplateRef<HTMLElement>('panelRef')
const timeFlyoutOffset = ref(8)

const isDateTime = computed(() => props.precision !== 'date')
const placeholderText = computed(() => props.placeholder
  || (isDateTime.value ? '选择日期时间' : '选择日期'))
const accessibleLabel = computed(() => props.ariaLabel || placeholderText.value)
const displayValue = computed(() => formatDisplayValue(modelValue.value, props.precision))
const isEmpty = computed(() => modelValue.value === '')
const triggerLabel = computed(() => displayValue.value || placeholderText.value)
const triggerAriaLabel = computed(() => `${accessibleLabel.value}：${triggerLabel.value}`)
const triggerButtonClass = computed(() => cn(
  'gap-2 font-normal pe-10 text-left min-h-11 w-full justify-start overflow-hidden sm:min-h-9',
  isEmpty.value ? 'text-muted-foreground' : undefined,
  props.triggerClass,
))

const bounds = computed<QsDateTimeBounds>(() => resolveDateTimeBounds({
  disableFuture: props.disableFuture,
  max: props.max,
  min: props.min,
  now: nowDate.value,
  precision: props.precision,
}))

const modelDate = computed<DateValue | undefined>(() => parseDateTimeValue(
  modelValue.value,
  'date',
)?.date)

const applicableMinTime = computed(() => {
  const date = draftDate.value
  const minDate = bounds.value.minDate
  return date && minDate && date.compare(minDate) === 0
    ? bounds.value.minTime
    : undefined
})

const applicableMaxTime = computed(() => {
  const date = draftDate.value
  const maxDate = bounds.value.maxDate
  return date && maxDate && date.compare(maxDate) === 0
    ? bounds.value.maxTime
    : undefined
})

const draftTime = computed(() => formatDraftTime({
  hour: draftHour.value,
  minute: draftMinute.value,
  second: draftSecond.value,
  millisecond: draftMillisecond.value,
}, props.precision))

const draftError = computed(() => draftDate.value
  ? validateDateTimeParts({
      date: draftDate.value,
      hour: draftHour.value,
      minute: draftMinute.value,
      second: draftSecond.value,
      millisecond: draftMillisecond.value,
    }, bounds.value, props.precision)
  : null)

const draftErrorMessage = computed(() => {
  switch (draftError.value) {
    case 'FUTURE':
      return '时间不能晚于当前时间'
    case 'BEFORE_MIN':
      return '时间不能早于最早可选时间'
    case 'AFTER_MAX':
      return '时间不能晚于最晚可选时间'
    default:
      return ''
  }
})

const canConfirm = computed(() => Boolean(draftDate.value && !props.disabled))

function syncNow(): void {
  // 上限必须跟服务端时钟对齐：浏览器时钟偏快时，默认值和服务端"当前时间"会差出几分钟，
  // 提交后才被服务端判成未来时间。
  nowDate.value = serverNow()
}

function initializeDraft(): void {
  syncNow()
  const parts = modelValue.value === ''
    ? null
    : parseDateTimeValue(modelValue.value, props.precision)
  if (!isDateTime.value) {
    draftDate.value = parts?.date
    return
  }
  if (parts) {
    draftDate.value = parts.date
    draftHour.value = parts.hour
    draftMinute.value = parts.minute
    draftSecond.value = parts.second
    draftMillisecond.value = parts.millisecond
  }
  else {
    draftDate.value = undefined
    const now = currentDateTimeParts(nowDate.value)
    draftHour.value = now.hour
    draftMinute.value = now.minute
    draftSecond.value = now.second
    draftMillisecond.value = now.millisecond
  }
}

function commit(value: string): void {
  if (modelValue.value === value) {
    return
  }
  modelValue.value = value
  emit('change', value)
}

function handleOpenChange(value: boolean): void {
  if (value) {
    initializeDraft()
    timeOpen.value = false
  }
  open.value = value
  emit('update:open', value)
}

function handleDateSelect(value: DateValue | DateValue[] | undefined): void {
  if (!value || Array.isArray(value)) {
    return
  }
  commit(toCalendarDate(value).toString())
}

function handleDraftDate(value: DateValue | DateValue[] | undefined): void {
  if (!value || Array.isArray(value)) {
    return
  }
  syncNow()
  draftDate.value = toCalendarDate(value)
}

function isDateDisabled(date: DateValue): boolean {
  return isDateOutsideBounds(date, bounds.value)
}

function handleWheelTime(value: string): void {
  syncNow()
  const parsed = parseDraftTime(value, props.precision)
  if (!parsed) {
    return
  }
  draftHour.value = parsed.hour
  draftMinute.value = parsed.minute
  draftSecond.value = parsed.second
  draftMillisecond.value = 0
}

/** 让时间滚轮落在主面板外侧，而不是盖住主面板底部操作栏。 */
function handleTimeTriggerClick(event: MouseEvent): void {
  const panel = panelRef.value
  const trigger = event.currentTarget
  if (panel && trigger instanceof HTMLElement) {
    timeFlyoutOffset.value = Math.max(
      8,
      panel.getBoundingClientRect().right - trigger.getBoundingClientRect().right + 8,
    )
  }
}

function handleTimeNow(): void {
  syncNow()
  const now = currentDateTimeParts(nowDate.value)
  draftHour.value = now.hour
  draftMinute.value = now.minute
  draftSecond.value = now.second
  draftMillisecond.value = now.millisecond
}

function handleTimeConfirm(): void {
  timeOpen.value = false
  handleConfirm()
}

function closePanel(): void {
  timeOpen.value = false
  open.value = false
  emit('update:open', false)
}

function handleConfirm(): void {
  syncNow()
  if (!draftDate.value) {
    return
  }
  if (draftError.value !== null) {
    return
  }
  commit(formatDateTimeValue({
    date: draftDate.value,
    hour: draftHour.value,
    minute: draftMinute.value,
    second: draftSecond.value,
    millisecond: draftMillisecond.value,
  }, props.precision))
  closePanel()
}

function handleClear(): void {
  commit('')
  closePanel()
}

watch(modelValue, () => {
  if (open.value) {
    initializeDraft()
  }
})

watch(open, (value) => {
  if (!value) {
    timeOpen.value = false
  }
})

watch(() => props.disabled, (value) => {
  if (value && open.value) {
    closePanel()
  }
})
</script>

<template>
  <div class="group max-w-full w-full relative">
    <FaDate
      v-if="!isDateTime"
      :model-value="modelDate"
      :open="open"
      :disabled="props.disabled"
      :min-value="bounds.minDate"
      :max-value="bounds.maxDate"
      :default-placeholder="bounds.today"
      :picker-placeholder="placeholderText"
      :calendar-label="accessibleLabel"
      picker
      prevent-deselect
      @update:model-value="handleDateSelect"
      @update:open="handleOpenChange"
    >
      <template #trigger>
        <FaButton
          v-bind="$attrs"
          type="button"
          variant="outline"
          :aria-label="triggerAriaLabel"
          :disabled="props.disabled"
          :class="triggerButtonClass"
          @blur="emit('blur')"
        >
          <FaIcon name="i-lucide:calendar" class="flex-none size-4" aria-hidden="true" />
          <span class="flex-1 min-w-0 truncate">{{ triggerLabel }}</span>
        </FaButton>
      </template>
    </FaDate>

    <FaPopover
      v-else
      :open="open"
      :auto-focus="true"
      :collision-padding="12"
      prioritize-position
      sticky="always"
      class="p-0 max-w-[calc(100vw-1rem)]"
      @update:open="handleOpenChange"
    >
      <FaButton
        v-bind="$attrs"
        type="button"
        variant="outline"
        :aria-label="triggerAriaLabel"
        :disabled="props.disabled"
        :class="triggerButtonClass"
        @blur="emit('blur')"
      >
        <FaIcon name="i-lucide:calendar-clock" class="flex-none size-4" aria-hidden="true" />
        <span class="flex-1 min-w-0 truncate">{{ triggerLabel }}</span>
      </FaButton>

      <template #panel>
        <div
          ref="panelRef"
          role="dialog"
          :aria-label="accessibleLabel"
          class="flex flex-col"
        >
          <div class="p-3 space-y-3">
            <FaCalendarDate
              :model-value="draftDate"
              :default-placeholder="bounds.today"
              :min-value="bounds.minDate"
              :max-value="bounds.maxDate"
              :is-date-disabled="isDateDisabled"
              :disabled="props.disabled"
              :calendar-label="accessibleLabel"
              class="border-0"
              @update:model-value="handleDraftDate"
            />

            <div class="pt-3 border-t border-border flex flex-wrap gap-2 items-center">
              <span class="qs-type-compact-label">时间</span>
              <FaPopover
                v-model:open="timeOpen"
                side="right"
                align="start"
                :side-offset="timeFlyoutOffset"
                :collision-padding="12"
                :auto-focus="true"
                prioritize-position
                sticky="always"
                class="p-0 w-60 z-3000 min-w-0!"
              >
                <FaButton
                  type="button"
                  variant="outline"
                  size="sm"
                  :disabled="props.disabled || !draftDate"
                  :aria-label="`选择时间：${draftTime}`"
                  class="gap-2 min-h-11 min-w-32 justify-between sm:min-h-9"
                  @click="handleTimeTriggerClick"
                >
                  <FaIcon name="i-lucide:clock" class="flex-none size-4" aria-hidden="true" />
                  <span class="qs-type-data">{{ draftTime }}</span>
                  <FaIcon name="i-lucide:chevron-right" class="text-muted-foreground flex-none size-4" aria-hidden="true" />
                </FaButton>
                <template #panel>
                  <TimeWheelPanel
                    :model-value="draftTime"
                    :precision="props.precision === 'second' ? 'second' : 'minute'"
                    :min-time="applicableMinTime"
                    :max-time="applicableMaxTime"
                    :disabled="props.disabled"
                    @update:model-value="handleWheelTime"
                    @now="handleTimeNow"
                    @cancel="timeOpen = false"
                    @confirm="handleTimeConfirm"
                  />
                </template>
              </FaPopover>
            </div>

            <p v-if="draftErrorMessage" role="alert" class="qs-type-meta text-destructive m-0">
              {{ draftErrorMessage }}
            </p>
          </div>

          <div class="p-3 border-t border-border flex shrink-0 flex-wrap gap-2 items-center justify-end">
            <FaButton
              v-if="props.clearable"
              type="button"
              variant="ghost"
              size="sm"
              :disabled="props.disabled || isEmpty"
              class="me-auto min-h-11 sm:min-h-9"
              @click="handleClear"
            >
              清除
            </FaButton>
            <FaButton
              type="button"
              variant="outline"
              size="sm"
              class="min-h-11 sm:min-h-9"
              @click="closePanel"
            >
              取消
            </FaButton>
            <FaButton
              type="button"
              size="sm"
              :disabled="!canConfirm"
              class="min-h-11 sm:min-h-9"
              @click="handleConfirm"
            >
              完成
            </FaButton>
          </div>
        </div>
      </template>
    </FaPopover>

    <FaButton
      v-if="props.clearable && !isEmpty && !props.disabled"
      type="button"
      variant="ghost"
      size="icon-sm"
      :aria-label="`清除${accessibleLabel}`"
      class="text-muted-foreground opacity-100 size-8 transition-opacity end-1 top-1/2 absolute md:opacity-0 md:pointer-events-none -translate-y-1/2 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-hover:pointer-events-auto"
      @click.stop="handleClear"
    >
      <FaIcon name="i-lucide:x" class="size-4" aria-hidden="true" />
    </FaButton>
  </div>
</template>
