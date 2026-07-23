<script setup lang="ts">
import type { DateTimeDisplayFormat, DateTimeDisplayValue } from './format'
import {
  DEFAULT_TIME_ZONE,
  EMPTY_DATE_TIME_TEXT,
  formatDateTime,
} from './format'

defineOptions({ name: 'DateTimeDisplay' })

const props = withDefaults(defineProps<{
  format?: DateTimeDisplayFormat
  timeZone?: string
  value: DateTimeDisplayValue
}>(), {
  format: 'datetime',
  timeZone: DEFAULT_TIME_ZONE,
})

const formattedDateTime = computed(() => formatDateTime(
  props.value,
  props.format,
  props.timeZone,
))
const ariaLabel = computed(() => formattedDateTime.value === EMPTY_DATE_TIME_TEXT
  ? `${props.timeZone} 时间不可用`
  : `${props.timeZone} ${formattedDateTime.value}`)
</script>

<template>
  <time
    :aria-label="ariaLabel"
    :data-empty="formattedDateTime === EMPTY_DATE_TIME_TEXT"
    :data-format="format"
    :data-time-zone="timeZone"
    class="qs-type-data inline-flex whitespace-nowrap items-baseline"
  >
    {{ formattedDateTime }}
  </time>
</template>
