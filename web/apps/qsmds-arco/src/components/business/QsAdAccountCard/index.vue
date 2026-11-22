<script lang="ts" setup>
import type { AdAccountDto } from '@/api/generated/types.gen'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import dayjs from '@/utils/dayjs'

/**
 * 猎豹广告账户卡片（横向细长版，一行放两张）。
 *
 * 三条视觉约定：
 * 1. 进度条颜色跟随风险：< 80% 品牌色、80~95% 警示、≥ 95% 或已耗尽为危险色；
 *    绿色表示健康，不能出现在「额度耗尽」的账户上。
 * 2. 余额低于阈值显示「余额预警」，已耗尽则升级为「已耗尽」，两者都用危险语义色 + 图标。
 * 3. 卡片边框在已耗尽时转为浅红，便于在一屏里快速揪出停投风险的账户。
 *
 * 金额只读展示，判断位只做符号比较，真正的金额计算在服务端。
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

const balanceNumber = computed(() => {
  const value = props.account.availableBalance
  return value === null ? null : Number(value)
})

const exhausted = computed(() => {
  if (balanceNumber.value !== null && balanceNumber.value <= 0) {
    return true
  }

  return props.account.sustainableDays === 0
})

const alertTag = computed(() => {
  if (exhausted.value) {
    return { label: '已耗尽', icon: 'i-lucide:circle-slash' }
  }

  if (props.account.lowBalance) {
    return { label: '余额预警', icon: 'i-lucide:triangle-alert' }
  }

  return null
})

const daysText = computed(() => {
  const days = props.account.sustainableDays
  return days === null ? '—' : `${days} 天`
})

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

const balanceText = computed(() => `$${props.account.availableBalance ?? '—'}`)

const balanceTone = computed(() => (props.account.lowBalance || exhausted.value ? 'text-destructive' : 'text-foreground'))

const spendPercent = computed(() => {
  const cap = Number(props.account.spendCap)
  const spent = Number(props.account.amountSpent)

  if (!Number.isFinite(cap) || cap <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((spent / cap) * 100)))
})

/** 与进度条同源的告警分档：耗尽优先，其次按消耗比例。 */
const progressTone = computed(() => {
  if (exhausted.value || spendPercent.value >= 95) {
    return 'bg-destructive'
  }

  return spendPercent.value >= 80 ? 'bg-warning' : 'bg-primary'
})

const assigneeName = computed(() => props.account.assignedUser?.displayName ?? '未绑定')

function formatTime(value: string): string {
  return dayjs(value).format('MM-DD HH:mm')
}
</script>

<template>
  <FaCard
    content-class="p-0"
    class="overflow-hidden"
    :class="exhausted ? 'border-destructive/40' : undefined"
  >
    <div class="px-4 pt-3 flex flex-wrap gap-3 items-start justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap gap-2 items-center">
          <span class="font-medium">{{ account.accountName }}</span>
          <FaTag
            v-if="alertTag"
            variant="outline"
            class="text-destructive border-destructive/30 bg-destructive/10 gap-1"
          >
            <FaIcon :name="alertTag.icon" class="size-3" aria-hidden="true" />
            {{ alertTag.label }}
          </FaTag>
          <FaTag
            v-if="account.freeze === 1"
            variant="outline"
            class="text-muted-foreground border-border bg-muted gap-1"
          >
            <FaIcon name="i-lucide:snowflake" class="size-3" aria-hidden="true" />
            冻结
          </FaTag>
          <FaTag v-if="account.vendorMissing" variant="outline" class="text-muted-foreground">
            未同步
          </FaTag>
        </div>
        <div class="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-1 items-center">
          <span class="font-mono">
            <QsCopyableText label="账户 ID" :text="account.accountId" />
          </span>
          <span aria-hidden="true">·</span>
          <span class="truncate">{{ account.companyCn ?? '—' }}</span>
        </div>
      </div>

      <div class="flex shrink-0 gap-2 items-center">
        <span v-if="mode === 'management'" class="text-xs text-muted-foreground">
          绑定：{{ assigneeName }}
        </span>
        <template v-if="mode === 'management'">
          <FaButton size="sm" variant="secondary" @click="$emit('assign')">
            {{ account.assignedUser ? '改绑' : '绑定' }}
          </FaButton>
          <FaButton v-if="account.assignedUser" size="sm" variant="ghost" @click="$emit('release')">
            解绑
          </FaButton>
        </template>
      </div>
    </div>

    <div class="px-4 pt-3">
      <div class="px-3 py-2.5 rounded-lg bg-muted/40 gap-2 grid grid-cols-4">
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground truncate">
            可用余额
          </div>
          <div class="text-xl font-semibold mt-0.5 tabular-nums" :class="balanceTone">
            {{ balanceText }}
          </div>
        </div>
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground truncate">
            预计可用
          </div>
          <div class="text-base font-semibold mt-0.5 tabular-nums" :class="daysTone">
            {{ daysText }}
          </div>
        </div>
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground truncate">
            7 天日均
          </div>
          <div class="text-base font-semibold mt-0.5 tabular-nums">
            ${{ account.sevenDayAverage }}
          </div>
        </div>
        <div class="min-w-0">
          <div class="text-xs text-muted-foreground truncate">
            DSL 日限额
          </div>
          <div class="text-base font-semibold mt-0.5 tabular-nums">
            {{ account.dailySpendLimit === null ? '—' : `$${account.dailySpendLimit}` }}
          </div>
        </div>
      </div>
    </div>

    <div class="px-4 pb-2 pt-2.5">
      <div class="text-xs text-muted-foreground flex gap-2 items-baseline justify-between">
        <span class="tabular-nums">已花费 ${{ account.amountSpent }} / 限额 ${{ account.spendCap }}</span>
        <span class="font-medium tabular-nums" :class="exhausted ? 'text-destructive' : undefined">{{ spendPercent }}%</span>
      </div>
      <div class="mt-1 rounded bg-muted h-1.5 overflow-hidden">
        <div class="h-full transition-colors" :class="progressTone" :style="{ width: `${spendPercent}%` }" />
      </div>
    </div>

    <div class="text-xs text-muted-foreground px-4 pb-3 flex flex-wrap gap-x-3 gap-y-1 items-baseline justify-between">
      <span class="tabular-nums">创建 {{ formatTime(account.createdTime) }}</span>
      <span class="tabular-nums">
        数据更新 {{ formatTime(account.vendorUpdatedAt) }} · 同步 {{ formatTime(account.lastSyncedAt) }}
      </span>
    </div>
  </FaCard>
</template>
