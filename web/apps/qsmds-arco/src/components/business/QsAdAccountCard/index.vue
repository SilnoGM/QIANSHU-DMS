<script lang="ts" setup>
import type { AdAccountDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import dayjs from '@/utils/dayjs'
import { setPendingRechargePaste } from '@/views/workbenches/network-ads/advertising-recharges/create-handoff'

/**
 * 猎豹广告账户卡片（横向细长版，一行放两张）。
 *
 * 三条视觉约定：
 * 1. 进度条与余额文字同色，颜色只看「可用余额」：> $50 健康、$30~$50 预警、< $30 危险；
 *    与已花费/限额的消耗比例无关——比例只决定进度条长度。
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

  return days <= 3 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
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
 * 颜色只按「可用余额」分档，与已花费/限额比例无关：
 *   > $50 健康（品牌绿）、$30~$50 预警（琥珀）、< $30 危险（红）。
 * 红线取服务端下发的 `balanceAlertThreshold`，与菜单徽章、通知事件保持同一阈值；
 * 琥珀线的 50 是纯展示口径，接口不提供。
 */
const BALANCE_CAUTION_USD = 50

const balanceTier = computed<'danger' | 'warning' | 'healthy' | 'unknown'>(() => {
  const balance = balanceNumber.value

  if (balance === null) {
    return 'unknown'
  }

  if (balance < props.account.balanceAlertThreshold) {
    return 'danger'
  }

  return balance <= BALANCE_CAUTION_USD ? 'warning' : 'healthy'
})

/**
 * 预警档用 amber 色阶：本应用主题没有定义 `warning` 色板，
 * `bg-warning` / `text-warning` 不会生成任何样式（进度条会整条透明）。
 * amber 是仓库既有写法（status-tag-tone、静态代理卡片），明暗模式都覆盖。
 * 文字与进度条共用同一个色阶，两处颜色必须逐像素一致。
 */
const progressTone = computed(() => {
  switch (balanceTier.value) {
    case 'danger':
      return 'bg-destructive'
    case 'warning':
      return 'bg-amber-600 dark:bg-amber-400'
    case 'healthy':
      return 'bg-primary'
    default:
      return 'bg-muted-foreground'
  }
})

/** 余额文字与进度条同色；无花费上限账户没有可用余额，保持中性灰。 */
const balanceTone = computed(() => {
  switch (balanceTier.value) {
    case 'danger':
      return 'text-destructive'
    case 'warning':
      return 'text-amber-600 dark:text-amber-400'
    case 'healthy':
      return 'text-primary'
    default:
      return 'text-muted-foreground'
  }
})

const isAssigned = computed(() => props.account.assignedUser !== null)
const assignLabel = computed(() => (isAssigned.value ? '改绑' : '绑定'))
/** 与静态代理卡片一致：已绑定用天蓝链接色，未绑定用品牌色。 */
const assignToneClass = computed(() => (
  isAssigned.value ? 'text-sky-600 dark:text-sky-400' : 'text-primary'
))

/**
 * 点击户名一次性复制账户名与编号，投手转手到群里时不用再拼。
 * 首行只放户名（不加前缀），便于直接粘进对话；编号行保留标签。
 */
const accountCopyText = computed(() => [
  props.account.accountName,
  `广告账户编号：${props.account.accountId}`,
].join('\n'))

type CopyState = 'error' | 'idle' | 'success'

const toast = useQsToast()
const copyState = ref<CopyState>('idle')
let copyResetTimer: ReturnType<typeof setTimeout> | undefined

const copyTooltip = computed(() => ({
  error: '复制失败',
  idle: '点击复制账户信息',
  success: '已复制',
})[copyState.value])
const copyLiveMessage = computed(() => ({
  error: '账户信息复制失败',
  idle: '',
  success: '账户信息已复制',
})[copyState.value])

function scheduleCopyReset(): void {
  clearTimeout(copyResetTimer)
  copyResetTimer = setTimeout(() => {
    copyState.value = 'idle'
  }, 1_500)
}

async function copyAccountInfo(): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }

    await navigator.clipboard.writeText(accountCopyText.value)
    copyState.value = 'success'
    toast.success('账户信息已复制')
  }
  catch {
    // 失败只反馈给当前用户，不把待复制内容写进日志。
    copyState.value = 'error'
    toast.error('账户信息复制失败')
  }

  scheduleCopyReset()
}

onBeforeUnmount(() => clearTimeout(copyResetTimer))

const { auth } = useAppAuth()
const router = useRouter()

/** 与广告充值页同码：没有建单权限的人不显示这个入口，避免点了才被拒。 */
const canCreateRecharge = computed(() => auth('advertising-recharges:create'))

/**
 * 先复制再跳转，并把待识别文本交给充值页（模块级一次交接，不走 URL：
 * 布局的 RouterView 按 fullPath 做 key，清 query 会把页面重建掉）。
 * 复制失败不阻断流程——交接里已经带了同样的文本。
 */
async function openRechargeRequest(): Promise<void> {
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('Clipboard API is unavailable')
    }

    await navigator.clipboard.writeText(accountCopyText.value)
    toast.success('账户信息已复制')
  }
  catch {
    toast.error('复制失败，已在充值页自动填入')
  }

  setPendingRechargePaste(accountCopyText.value)
  await router.push('/qs-operations/network-ads/advertising-recharges')
}

function formatTime(value: string): string {
  return dayjs(value).format('MM-DD HH:mm')
}
</script>

<template>
  <FaCard
    content-class="p-0"
    class="py-0 overflow-hidden"
    :class="exhausted ? 'border-destructive/40' : undefined"
  >
    <div class="px-4 pt-3 flex flex-wrap gap-3 items-start justify-between">
      <div class="min-w-0">
        <div class="flex flex-wrap gap-2 items-center">
          <FaTooltip :text="copyTooltip" :delay="300">
            <button
              type="button"
              class="qs-ad-account-card__name"
              :aria-label="`复制账户信息：${account.accountName}`"
              @click="copyAccountInfo"
            >
              {{ account.accountName }}
            </button>
          </FaTooltip>
          <span class="sr-only" aria-live="polite">{{ copyLiveMessage }}</span>
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

      <div v-if="mode === 'operations' && canCreateRecharge" class="flex shrink-0 items-center">
        <FaButton size="sm" variant="secondary" @click="openRechargeRequest">
          <FaIcon name="i-lucide:wallet" class="size-3.5" aria-hidden="true" />
          充值
        </FaButton>
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
        <span class="font-medium tabular-nums">{{ spendPercent }}%</span>
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
/* 户名兼作复制按钮：字号与字重写进来，避免被浏览器默认 button 样式覆盖。 */
.qs-ad-account-card__name {
  padding: 0;
  font-family: inherit;
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.5rem;
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: transparent;
  border: 0;
}

.qs-ad-account-card__name:hover {
  text-decoration: underline;
}

.qs-ad-account-card__name:focus-visible {
  outline: 2px solid oklch(var(--primary) / 40%);
  outline-offset: 2px;
  border-radius: 0.25rem;
}

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
