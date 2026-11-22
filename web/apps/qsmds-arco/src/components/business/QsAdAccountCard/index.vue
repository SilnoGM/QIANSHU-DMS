<script lang="ts" setup>
import type { AdAccountDto } from '@/api/generated/types.gen'
import dayjs from '@/utils/dayjs'

/**
 * 猎豹广告账户卡片（横向细长版）。
 *
 * 13 个字段里只有「可用余额 / 7 天日均 / 预计可用 / DSL」进主指标区，
 * 已花费与花费上限合成进度条，三个时间放页脚——运营扫一列就能比出谁先停投。
 */
const props = withDefaults(defineProps<{
  account: AdAccountDto
  mode?: 'operations' | 'management'
}>(), {
  mode: 'operations',
})

defineEmits<{
  assign: []
  release: []
}>()

const daysText = computed(() => {
  const days = props.account.sustainableDays
  return days === null ? '—' : `${days} 天`
})

/** 续航告警分档：0 天最紧急，1~3 天次之，其余保持常规色。 */
const daysTone = computed(() => {
  const days = props.account.sustainableDays

  if (days === null) {
    return 'text-muted-foreground'
  }

  if (days <= 0) {
    return 'text-destructive'
  }

  return days <= 3 ? 'text-warning' : 'text-foreground'
})

const balanceTone = computed(() => (props.account.lowBalance ? 'text-destructive' : 'text-foreground'))

const balanceText = computed(() => `$${props.account.availableBalance ?? '—'}`)

const spendPercent = computed(() => {
  const cap = Number(props.account.spendCap)
  const spent = Number(props.account.amountSpent)

  if (!Number.isFinite(cap) || cap <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((spent / cap) * 100)))
})

const assigneeName = computed(() => props.account.assignedUser?.displayName ?? '未绑定')

function formatTime(value: string): string {
  return dayjs(value).format('MM-DD HH:mm')
}
</script>

<template>
  <FaCard content-class="p-0" class="overflow-hidden">
    <div class="px-4 py-3 border-b flex flex-wrap gap-3 items-start justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap gap-2 items-center">
          <span class="font-medium">{{ account.accountName }}</span>
          <FaTag
            v-if="account.freeze === 1"
            variant="outline"
            class="text-destructive border-destructive/35 bg-destructive/10"
          >
            冻结
          </FaTag>
          <FaTag
            v-if="account.lowBalance"
            variant="outline"
            class="border-warning/35 bg-warning/10 text-warning"
          >
            余额预警
          </FaTag>
          <FaTag v-if="account.vendorMissing" variant="outline" class="text-muted-foreground">
            未同步
          </FaTag>
        </div>
        <div class="text-xs text-muted-foreground mt-1 truncate">
          {{ account.accountId }} · {{ account.companyCn ?? '—' }}
          <template v-if="mode === 'management'">
            · 绑定：{{ assigneeName }}
          </template>
        </div>
      </div>

      <div v-if="mode === 'management'" class="flex shrink-0 gap-2">
        <FaButton size="sm" variant="outline" @click="$emit('assign')">
          {{ account.assignedUser ? '改绑' : '绑定' }}
        </FaButton>
        <FaButton v-if="account.assignedUser" size="sm" variant="ghost" @click="$emit('release')">
          解绑
        </FaButton>
      </div>
    </div>

    <div class="px-4 py-3 gap-4 grid grid-cols-2">
      <div>
        <div class="text-xs text-muted-foreground">
          可用余额
        </div>
        <div class="text-lg font-semibold mt-1" :class="balanceTone">
          {{ balanceText }}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">
          7 天日均
        </div>
        <div class="text-lg font-semibold mt-1">
          ${{ account.sevenDayAverage }}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">
          预计可用
        </div>
        <div class="text-lg font-semibold mt-1" :class="daysTone">
          {{ daysText }}
        </div>
      </div>
      <div>
        <div class="text-xs text-muted-foreground">
          DSL 日限额
        </div>
        <div class="text-lg font-semibold mt-1">
          {{ account.dailySpendLimit === null ? '—' : `$${account.dailySpendLimit}` }}
        </div>
      </div>
    </div>

    <div class="px-4 pb-3">
      <div class="text-xs text-muted-foreground flex justify-between">
        <span>已花费 ${{ account.amountSpent }} / 上限 ${{ account.spendCap }}</span>
        <span>{{ spendPercent }}%</span>
      </div>
      <div class="mt-1 rounded bg-muted h-1.5 overflow-hidden">
        <div class="bg-primary h-full" :style="{ width: `${spendPercent}%` }" />
      </div>
    </div>

    <div class="text-xs text-muted-foreground px-4 py-2 border-t flex flex-wrap gap-x-4 gap-y-1">
      <span>创建 {{ formatTime(account.createdTime) }}</span>
      <span>数据更新 {{ formatTime(account.vendorUpdatedAt) }}</span>
      <span>同步 {{ formatTime(account.lastSyncedAt) }}</span>
    </div>
  </FaCard>
</template>
