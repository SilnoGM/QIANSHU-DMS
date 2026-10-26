<script setup lang="ts">
import { ref } from 'vue'
import QsDateTimeField from '@/components/business/QsDateTimeField/index.vue'
import {
  currentDateTimeParts,
  currentDateTimeValue,
  formatDateTimeValue,
} from '@/components/business/QsDateTimeField/logic'

const emptyDate = ref('')
const filledDate = ref(currentDateTimeValue('date'))
const minuteValue = ref(currentDateTimeValue('minute'))
const secondValue = ref(currentDateTimeValue('second'))
const boundedValue = ref('')
const disabledValue = ref(currentDateTimeValue('minute'))
const futureValue = ref('')

const nowParts = currentDateTimeParts()
const earliest = formatDateTimeValue({
  ...nowParts,
  date: nowParts.date.subtract({ days: 7 }),
  hour: 0,
  minute: 0,
  second: 0,
  millisecond: 0,
}, 'second')
const latest = formatDateTimeValue({
  ...nowParts,
  date: nowParts.date.add({ days: 7 }),
  hour: 23,
  minute: 59,
  second: 59,
  millisecond: 999,
}, 'second')
</script>

<template>
  <section
    aria-labelledby="date-time-field-showcase-title"
    data-testid="date-time-field-showcase"
  >
    <div class="p-5 border border-border rounded-xl bg-background sm:p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:calendar-clock" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">日期时间输入</span>
          </div>
          <h3
            id="date-time-field-showcase-title"
            class="text-xl tracking-tight font-semibold m-0 mt-3 sm:text-2xl"
          >
            精度、边界与清除
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-3xl">
            下方值就是 v-model 实际内容：日期为 YYYY-MM-DD，时间字段为规范化 UTC ISO。
            所有示例都按 Asia/Shanghai 墙钟显示，不读取真实业务数据。
          </p>
        </div>
        <FaTag variant="secondary">
          QsDateTimeField
        </FaTag>
      </div>

      <div class="mt-6 border-y border-border divide-border divide-y">
        <div class="py-5 gap-4 grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <div>
            <span class="qs-type-meta text-muted-foreground">日期 · 空值</span>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              默认空值，可清除，禁止未来日期。
            </p>
          </div>
          <div class="max-w-md min-w-0 space-y-2">
            <QsDateTimeField
              v-model="emptyDate"
              precision="date"
              clearable
              disable-future
              aria-label="示例出单日期"
            />
            <code class="qs-type-data block break-all">{{ emptyDate || '（空）' }}</code>
          </div>
        </div>

        <div class="py-5 gap-4 grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <div>
            <span class="qs-type-meta text-muted-foreground">日期 · 已有值</span>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              值仍是 YYYY-MM-DD，没有隐藏时间。
            </p>
          </div>
          <div class="max-w-md min-w-0 space-y-2">
            <QsDateTimeField
              v-model="filledDate"
              precision="date"
              clearable
              disable-future
              aria-label="示例已有日期"
            />
            <code class="qs-type-data block break-all">{{ filledDate || '（空）' }}</code>
          </div>
        </div>

        <div class="py-5 gap-4 grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <div>
            <span class="qs-type-meta text-muted-foreground">分钟精度</span>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              time 滚轮到分钟，提交值秒与毫秒归零。
            </p>
          </div>
          <div class="max-w-md min-w-0 space-y-2">
            <QsDateTimeField
              v-model="minuteValue"
              precision="minute"
              clearable
              disable-future
              aria-label="示例收款时间"
            />
            <code class="qs-type-data block break-all">{{ minuteValue || '（空）' }}</code>
          </div>
        </div>

        <div class="py-5 gap-4 grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <div>
            <span class="qs-type-meta text-muted-foreground">秒精度</span>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              time 滚轮到秒，保留默认时刻的毫秒。
            </p>
          </div>
          <div class="max-w-md min-w-0 space-y-2">
            <QsDateTimeField
              v-model="secondValue"
              precision="second"
              clearable
              disable-future
              aria-label="示例到仓时间"
            />
            <code class="qs-type-data block break-all">{{ secondValue || '（空）' }}</code>
          </div>
        </div>

        <div class="py-5 gap-4 grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <div>
            <span class="qs-type-meta text-muted-foreground">最早/最晚边界</span>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              今天前后 7 天（上海时间），到秒。
            </p>
          </div>
          <div class="max-w-md min-w-0 space-y-2">
            <QsDateTimeField
              v-model="boundedValue"
              precision="second"
              clearable
              :min="earliest"
              :max="latest"
              aria-label="示例边界时间"
            />
            <code class="qs-type-data block break-all">{{ boundedValue || '（空）' }}</code>
          </div>
        </div>

        <div class="py-5 gap-4 grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <div>
            <span class="qs-type-meta text-muted-foreground">允许未来</span>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              不启用 disableFuture 时可以选未来时间。
            </p>
          </div>
          <div class="max-w-md min-w-0 space-y-2">
            <QsDateTimeField
              v-model="futureValue"
              precision="minute"
              clearable
              aria-label="示例未来时间"
            />
            <code class="qs-type-data block break-all">{{ futureValue || '（空）' }}</code>
          </div>
        </div>

        <div class="py-5 gap-4 grid sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <div>
            <span class="qs-type-meta text-muted-foreground">禁用</span>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              触发器不可打开，清除按钮隐藏。
            </p>
          </div>
          <div class="max-w-md min-w-0 space-y-2">
            <QsDateTimeField
              v-model="disabledValue"
              precision="minute"
              clearable
              disabled
              aria-label="示例禁用时间"
            />
            <code class="qs-type-data block break-all">{{ disabledValue }}</code>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
