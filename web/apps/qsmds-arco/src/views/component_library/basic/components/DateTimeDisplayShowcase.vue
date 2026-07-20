<script setup lang="ts">
import type {
  DateTimeDisplayFormat,
  DateTimeDisplayValue,
} from '@/components/base/DateTimeDisplay/format'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'

const referenceInstant = '2026-07-20T08:16:35.000Z'

interface TimeZoneExample {
  description: string
  label: string
  timeZone: string
}

const timeZoneExamples: readonly TimeZoneExample[] = [
  {
    description: '中国标准时间 UTC+8',
    label: '上海',
    timeZone: 'Asia/Shanghai',
  },
  {
    description: '台北标准时间 UTC+8',
    label: '台北',
    timeZone: 'Asia/Taipei',
  },
  {
    description: '马来西亚时间 UTC+8',
    label: '吉隆坡',
    timeZone: 'Asia/Kuala_Lumpur',
  },
  {
    description: '北美东部夏令时间 UTC-4',
    label: '纽约',
    timeZone: 'America/New_York',
  },
]

interface DateTimeStateExample {
  description: string
  format: DateTimeDisplayFormat
  label: string
  timeZone: string
  value: DateTimeDisplayValue
}

const stateExamples: readonly DateTimeStateExample[] = [
  {
    description: '仅展示年月日',
    format: 'date',
    label: '日期',
    timeZone: 'Asia/Shanghai',
    value: referenceInstant,
  },
  {
    description: '默认展示到秒',
    format: 'datetime',
    label: '日期时间',
    timeZone: 'Asia/Shanghai',
    value: referenceInstant,
  },
  {
    description: '固定使用 24 小时制',
    format: 'time',
    label: '时间',
    timeZone: 'Asia/Shanghai',
    value: referenceInstant,
  },
  {
    description: 'number 始终按 Unix 毫秒解释',
    format: 'datetime',
    label: '毫秒时间戳',
    timeZone: 'UTC',
    value: Date.parse(referenceInstant),
  },
  {
    description: '空值与非法输入统一使用占位符',
    format: 'datetime',
    label: '空值',
    timeZone: 'Asia/Shanghai',
    value: null,
  },
]
</script>

<template>
  <section class="mt-8" aria-labelledby="date-time-display-title">
    <div class="p-5 border border-border rounded-xl bg-background sm-p-7">
      <div class="flex flex-wrap gap-4 items-start justify-between">
        <div class="min-w-0">
          <div class="text-primary flex gap-2 items-center">
            <FaIcon name="i-lucide:clock-3" class="size-5" />
            <span class="text-xs tracking-[0.16em] font-semibold">基础显示组件</span>
          </div>
          <h3 id="date-time-display-title" class="text-xl tracking-tight font-semibold m-0 mt-3 sm-text-2xl">
            日期时间格式化显示
          </h3>
          <p class="text-sm text-muted-foreground leading-6 m-0 mt-2 max-w-2xl">
            同一时刻按明确 IANA 时区稳定显示。字符串输入必须包含 Z 或 UTC offset，避免不同运行环境产生时间偏移。
          </p>
        </div>
        <FaTag variant="secondary">
          DateTimeDisplay
        </FaTag>
      </div>

      <div class="mt-7 gap-8 grid lg-grid-cols-[minmax(0,1.55fr)_minmax(17rem,0.72fr)]">
        <div>
          <div class="flex flex-wrap gap-3 items-end justify-between">
            <div>
              <h4 class="text-base font-semibold m-0">
                同一时刻，四个时区
              </h4>
              <p class="text-xs text-muted-foreground m-0 mt-1">
                基准时刻：2026-07-20T08:16:35.000Z
              </p>
            </div>
            <span class="text-xs text-muted-foreground">IANA time zone</span>
          </div>

          <div class="mt-4 border-y border-border divide-border divide-y">
            <article
              v-for="example in timeZoneExamples"
              :key="example.timeZone"
              class="py-5 gap-4 grid items-center sm-grid-cols-[minmax(0,1fr)_auto]"
            >
              <div class="min-w-0">
                <div class="flex flex-wrap gap-x-2 gap-y-1 items-center">
                  <span class="text-sm font-semibold">{{ example.label }}</span>
                  <code class="text-xs text-muted-foreground break-all">{{ example.timeZone }}</code>
                </div>
                <p class="text-xs text-muted-foreground m-0 mt-1">
                  {{ example.description }}
                </p>
              </div>
              <DateTimeDisplay
                :value="referenceInstant"
                :time-zone="example.timeZone"
                class="text-lg sm-text-xl"
              />
            </article>
          </div>
        </div>

        <aside class="p-5 border border-border rounded-xl bg-muted/20 self-start">
          <p class="text-xs text-primary tracking-[0.16em] font-semibold m-0">
            稳定接口
          </p>
          <dl class="text-sm m-0 mt-5 space-y-4">
            <div class="pb-4 border-b border-border">
              <dt class="text-muted-foreground">
                value
              </dt>
              <dd class="text-xs font-mono m-0 mt-1 break-all">
                string | number | Date | null
              </dd>
            </div>
            <div class="pb-4 border-b border-border">
              <dt class="text-muted-foreground">
                format
              </dt>
              <dd class="text-xs font-mono m-0 mt-1 break-all">
                date | datetime | time
              </dd>
            </div>
            <div class="pb-4 border-b border-border">
              <dt class="text-muted-foreground">
                timeZone
              </dt>
              <dd class="text-xs leading-5 m-0 mt-1">
                默认 Asia/Shanghai，接收有效 IANA 标识
              </dd>
            </div>
            <div>
              <dt class="text-muted-foreground">
                解析边界
              </dt>
              <dd class="text-xs leading-5 m-0 mt-1">
                字符串要求显式时区；number 只表示 Unix 毫秒
              </dd>
            </div>
          </dl>
        </aside>
      </div>

      <div class="mt-8 pt-7 border-t border-border">
        <div class="flex flex-wrap gap-3 items-end justify-between">
          <div>
            <h4 class="text-base font-semibold m-0">
              格式与边界状态
            </h4>
            <p class="text-xs text-muted-foreground m-0 mt-1">
              输出固定数字宽度，空值与非法值保持一致反馈。
            </p>
          </div>
          <span class="text-xs text-muted-foreground">只读展示</span>
        </div>

        <div class="mt-4 border-y border-border divide-border divide-y">
          <div
            v-for="example in stateExamples"
            :key="example.label"
            class="py-4 gap-3 grid items-center sm-grid-cols-[7rem_minmax(0,1fr)_auto]"
          >
            <span class="text-sm font-medium">{{ example.label }}</span>
            <span class="text-xs text-muted-foreground">{{ example.description }}</span>
            <DateTimeDisplay
              :value="example.value"
              :format="example.format"
              :time-zone="example.timeZone"
              class="text-base"
            />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
