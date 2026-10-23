<script setup lang="ts">
import type { ShippingMarkRuleSummaryDto } from '@/api/generated/types.gen'
import { Select as ArcoSelect } from '@arco-design/web-vue'
import api from '@/api/modules/shipping-mark-bindings'
import { bindingErrorMessage, canApplyBindingResponse, isBindableRule } from './shipping-mark-binding.logic'
import '@arco-design/web-vue/es/select/style/css.js'

const props = defineProps<{
  disabled?: boolean
}>()
const selection = defineModel<ShippingMarkRuleSummaryDto | null>({ required: true })
const { t } = useI18n()
const account = useAppAccountStore()
const { auth } = useAppAuth()
const options = ref<ShippingMarkRuleSummaryDto[]>([])
const loading = ref(false)
const error = ref('')
const page = ref(0)
const total = ref(0)
const keyword = ref('')
let generation = 0
let controller: AbortController | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let disposed = false
const choices = computed(() => {
  const rows = [...options.value]
  if (selection.value && !rows.some(row => row.id === selection.value?.id)) {
    rows.unshift(selection.value)
  }
  return rows.map(rule => ({ value: rule.id, label: `${rule.name} · ${rule.ruleCode}`, disabled: !isBindableRule(rule) }))
})
function select(value: unknown) {
  if (typeof value === 'string') {
    selection.value = options.value.find(rule => rule.id === value) ?? selection.value
  }
}
async function load(append = false) {
  controller?.abort()
  const request = controller = new AbortController()
  const version = ++generation
  const epoch = account.authEpoch
  const nextPage = append ? page.value + 1 : 1
  const current = () => !disposed && canApplyBindingResponse({ aborted: request.signal.aborted, authorized: auth('purchase-shipping-marks:read'), epoch, currentEpoch: account.authEpoch, version, currentVersion: generation })
  loading.value = true
  error.value = ''
  try {
    const response = await api.options({ page: nextPage, pageSize: 20, ...(keyword.value ? { keyword: keyword.value } : {}) }, request.signal)
    if (!current()) {
      return
    }
    const incoming = response.data.items.filter(isBindableRule)
    options.value = append ? [...new Map([...options.value, ...incoming].map(rule => [rule.id, rule])).values()] : incoming
    total.value = response.data.total
    page.value = nextPage
  }
  catch (failure) {
    if (current()) {
      error.value = bindingErrorMessage(failure, t('shippingMarkBinding.loadFailed'))
    }
  }
  finally {
    if (current()) {
      loading.value = false
    }
  }
}
function search(value: string) {
  keyword.value = value.trim().slice(0, 128)
  clearTimeout(timer)
  controller?.abort()
  generation += 1
  options.value = []
  page.value = 0
  total.value = 0
  timer = setTimeout(() => void load(), 250)
}
function more() {
  if (!loading.value && page.value * 20 < total.value) {
    void load(true)
  }
}
onMounted(() => void load())
onBeforeUnmount(() => {
  disposed = true
  generation += 1
  controller?.abort()
  clearTimeout(timer)
})
</script>

<template>
  <div class="min-w-0 space-y-2" data-testid="shipping-mark-rule-picker">
    <ArcoSelect
      :model-value="selection?.id"
      :options="choices"
      :disabled="props.disabled"
      :loading="loading"
      :filter-option="false"
      allow-search
      class="max-w-full min-w-0 w-full"
      :placeholder="t('shippingMarkBinding.selectRule')"
      :aria-label="t('shippingMarkBinding.selectRule')"
      @change="select"
      @search="search"
      @dropdown-reach-bottom="more"
    />
    <p v-if="error" class="text-sm text-destructive m-0" role="alert">
      {{ error }} <FaButton variant="link" size="sm" :disabled="loading || disabled" @click="load()">
        {{ t('shippingMarkBinding.retry') }}
      </FaButton>
    </p>
    <p v-else-if="!loading && !options.length" class="text-sm text-muted-foreground m-0">
      {{ t('shippingMarkBinding.noOptions') }}
    </p>
    <div v-else class="text-xs text-muted-foreground flex flex-wrap gap-2 items-center">
      <span>{{ t('shippingMarkBinding.loaded', { count: options.length, total }) }}</span>
      <FaButton v-if="page * 20 < total" variant="link" size="sm" :disabled="loading || disabled" @click="more">
        {{ t('shippingMarkBinding.more') }}
      </FaButton>
    </div>
  </div>
</template>
