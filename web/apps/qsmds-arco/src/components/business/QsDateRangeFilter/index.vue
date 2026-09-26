<script setup lang="ts">
import type {
  CalendarDateRangeCompleteValue,
  CalendarDateRangeValue,
} from '@fantastic-admin/components'
import type { DateValue } from '@internationalized/date'

defineOptions({ name: 'QsDateRangeFilter' })

const props = withDefaults(defineProps<{
  calendarLabel?: string
  maxValue?: DateValue
  minValue?: DateValue
  placeholder?: string
  /** 触发器宽度工具类；筛选栏空间充裕的页面可以调宽。 */
  widthClass?: string
}>(), {
  calendarLabel: '日期范围',
  placeholder: '日期范围',
  widthClass: 'w-[280px]',
})

const emit = defineEmits<{
  clear: []
  complete: [value: CalendarDateRangeCompleteValue]
}>()

const modelValue = defineModel<CalendarDateRangeValue>({ required: true })
const pickerOpen = ref(false)
const hasValue = computed(() => modelValue.value.start !== undefined
  || modelValue.value.end !== undefined)

function handleComplete(value: CalendarDateRangeCompleteValue): void {
  // 子日历先后发出 model 与 complete；这里再次收敛完整区间，保证业务页收到
  // complete 时可以立即使用最新值发起查询，而不依赖父组件下一次渲染时机。
  modelValue.value = { end: value.end, start: value.start }
  emit('complete', value)
}

function clear(): void {
  pickerOpen.value = false
  modelValue.value = { end: undefined, start: undefined }
  emit('clear')
}
</script>

<template>
  <div
    data-slot="qs-date-range-filter"
    class="group max-w-full relative"
    :class="widthClass"
  >
    <FaCalendarDateRange
      v-model="modelValue"
      v-model:open="pickerOpen"
      picker
      popover-align="start"
      :calendar-label="props.calendarLabel"
      :max-value="props.maxValue"
      :min-value="props.minValue"
      :picker-placeholder="props.placeholder"
      trigger-class="pe-10 min-h-11 w-full sm:min-h-9"
      @complete="handleComplete"
    >
      <template #trigger="{ disabled, label, readonly }">
        <!--
          FaCalendarDateRange 的默认触发器没有包含业务日期名称的可访问标签。
          统一组件必须保留这条语义，浏览器测试和读屏都能区分采购、销售等日期范围。
        -->
        <FaButton
          type="button"
          variant="outline"
          :disabled="disabled"
          :aria-label="`打开${props.calendarLabel}选择：${label}`"
          :aria-readonly="readonly || undefined"
          class="font-normal pe-10 text-left min-h-11 w-full justify-start overflow-hidden sm:min-h-9"
          :class="hasValue ? undefined : 'text-muted-foreground'"
        >
          <FaIcon name="i-lucide:calendar" class="flex-none size-4" aria-hidden="true" />
          <span class="flex-1 min-w-0 truncate">{{ label }}</span>
        </FaButton>
      </template>
    </FaCalendarDateRange>

    <!-- 触屏环境始终保留清除入口；具备 hover 的桌面端按需显现，同时支持键盘聚焦。 -->
    <FaButton
      v-if="hasValue"
      type="button"
      variant="ghost"
      size="icon-sm"
      :aria-label="`清除${props.calendarLabel}`"
      class="text-muted-foreground opacity-100 size-8 transition-opacity end-1 top-1/2 absolute md:opacity-0 md:pointer-events-none -translate-y-1/2 md:group-focus-within:opacity-100 md:group-hover:opacity-100 md:group-focus-within:pointer-events-auto md:group-hover:pointer-events-auto"
      @click.stop="clear"
    >
      <FaIcon name="i-lucide:x" class="size-4" aria-hidden="true" />
    </FaButton>
  </div>
</template>
