<script setup lang="ts">
import type { ApiClientError } from '@/api/errors'
import type { FundSelfAccountDto } from '@/api/generated/types.gen'
import { getApiClientErrorMessage } from '@/api/errors'
import fundAccountsApi from '@/api/modules/fund-accounts'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsPersonalFundAccountCard from '@/components/business/QsPersonalFundAccountCard/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

/**
 * 运营「个人财务 → 资金账户」页。
 *
 * 页面只读取本人账户；请求带 AbortSignal，并在页面失活或身份切换时中止/重取，
 * 避免把上一个身份的数据留在当前页面。卡片是纯展示组件，状态由这里传入。
 */
defineOptions({ name: 'OperationsPersonalFinanceFundAccounts' })

const { t } = useI18n()
const route = useRoute()
const { auth } = useAppAuth()
const appAccount = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()

const active = ref(false)
/** 首帧保持骨架，避免先闪出“未开户”再被真实数据替换。 */
const loading = ref(true)
const error = ref('')
const account = shallowRef<FundSelfAccountDto | null>(null)

const canRead = computed(() => auth('fund-accounts:read-self'))
const enabled = computed(() => (
  active.value
  && canRead.value
  && route.name === 'qsOperationsPersonalFinanceFundAccounts'
))

let controller: AbortController | null = null

function current(request: AbortController, requestEpoch: number): boolean {
  return controller === request
    && !request.signal.aborted
    && enabled.value
    && appAccount.authEpoch === requestEpoch
}

async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    return
  }

  const request = new AbortController()
  const requestEpoch = appAccount.authEpoch
  controller = request
  loading.value = true
  error.value = ''

  try {
    const response = await fundAccountsApi.accounts.self(request.signal)
    if (current(request, requestEpoch)) {
      account.value = response.data.account
    }
  }
  catch (failure) {
    if (current(request, requestEpoch)) {
      error.value = getApiClientErrorMessage(failure as ApiClientError)
        || t('qsPersonalFundAccount.loadError')
    }
  }
  finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

function applyWithdrawal(): void {
  toast.info(t('qsPersonalFundAccount.withdrawalComingSoon'))
}

function viewWithdrawals(): void {
  toast.info(t('qsPersonalFundAccount.withdrawalRecordsComingSoon'))
}

// active 控制页面是否在台前；authEpoch 变化时重新取数，避免跨身份复用余额。
watch([enabled, () => appAccount.authEpoch], ([isEnabled]) => {
  if (isEnabled) {
    void load()
    return
  }
  controller?.abort()
  controller = null
}, { immediate: true })

onMounted(() => {
  active.value = true
})
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
onBeforeUnmount(() => {
  active.value = false
  controller?.abort()
  controller = null
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      :title="t('qsPersonalFundAccount.pageTitle')"
      :description="t('qsPersonalFundAccount.pageDescription')"
    >
      <FaButton
        v-if="canRead"
        variant="outline"
        :loading="loading"
        @click="load"
      >
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />
        {{ t('qsPersonalFundAccount.refresh') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <QsPersonalFundAccountCard
        :account="account"
        :currencies="currencyCatalog.currencies.value"
        :loading="loading"
        :error="error || null"
        @apply-withdrawal="applyWithdrawal"
        @view-withdrawals="viewWithdrawals"
        @retry="load"
      />
    </FaPageMain>
  </div>
</template>
