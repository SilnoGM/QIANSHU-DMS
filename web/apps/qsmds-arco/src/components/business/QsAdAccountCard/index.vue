<script lang="ts" setup>
import type { AdAccountDto } from '@/api/generated/types.gen'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
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

const spendPercent = computed(() => {
  const cap = Number(props.account.spendCap)
  const spent = Number(props.account.amountSpent)

  if (!Number.isFinite(cap) || cap <= 0) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round((spent / cap) * 100)))
})

/**
 * 单一风险分档，余额文字与进度条共用同一来源，避免两处颜色不一致。
 * 余额低于阈值本身就是停投前兆，因此与「已耗尽 / ≥95%」同级按危险处理。
 */
const riskLevel = computed<'danger' | 'warning' | 'healthy'>(() => {
  if (exhausted.value || props.account.lowBalance || spendPercent.value >= 95) {
    return 'danger'
  }

  return spendPercent.value >= 80 ? 'warning' : 'healthy'
})

const progressTone = computed(() => {
  if (riskLevel.value === 'danger') {
    return 'bg-destructive'
  }

  return riskLevel.value === 'warning' ? 'bg-warning' : 'bg-primary'
})

/** 与进度条同色；无花费上限账户没有口径，保持中性灰。 */
const balanceTone = computed(() => {
  if (props.account.availableBalance === null) {
    return 'text-muted-foreground'
  }

  if (riskLevel.value === 'danger') {
    return 'text-destructive'
  }

  return riskLevel.value === 'warning' ? 'text-warning' : 'text-primary'
})

const isAssigned = computed(() => props.account.assignedUser !== null)
const assignLabel = computed(() => (isAssigned.value ? '改绑' : '绑定'))
/** 与静态代理卡片一致：已绑定用天蓝链接色，未绑定用品牌色。 */
const assignToneClass = computed(() => (
  isAssigned.value ? 'text-sky-600 dark:text-sky-400' : 'text-primary'
))

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

      <div v-if="mode === 'management'" class="flex shrink-0 flex-wrap gap-2 items-center">
        <span v-if="isAssigned" class="text-xs text-muted-foreground">已绑定</span>
        <QsPersonDisplay
          v-if="account.assignedUser"
          :display-name="account.assignedUser.displayName"
          size="sm"
        />

        <button
          type="button"
          class="qs-ad-account-card__link inline-flex gap-1 items-center"
          :class="assignToneClass"
          @click="$emit('assign')"
        >
          <FaIcon name="i-lucide:link" class="size-3.5" aria-hidden="true" />
          {{ assignLabel }}
        </button>

        <button
          v-if="isAssigned"
          type="button"
          class="qs-ad-account-card__link text-destructive inline-flex gap-1 items-center"
          @click="$emit('release')"
        >
          <FaIcon name="i-lucide:unlink" class="size-3.5" aria-hidden="true" />
          解绑
        </button>
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

<style scoped>
/* 与静态代理卡片的操作链接同款：去按钮装饰、悬浮下划线，靠文字色表达语义。 */
.qs-ad-account-card__link {
  padding: 0;
  font: inherit;
  font-weight: var(--qs-type-weight-medium, 500);
  cursor: pointer;
  background: transparent;
  border: 0;
}

.qs-ad-account-card__link:hover:not(:disabled) {
  text-decoration: underline;
}

.qs-ad-account-card__link:disabled {
  color: oklch(var(--muted-foreground));
  cursor: not-allowed;
}
</style>
