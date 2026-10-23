<script setup lang="ts">
import type { ShippingMarkRuleSummaryDto } from '@/api/generated/types.gen'
import api from '@/api/modules/shipping-mark-bindings'
import { bindingErrorMessage, canApplyBindingResponse, isBindableRule } from './shipping-mark-binding.logic'

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
const searchDraft = ref('')
const dropdownOpen = ref(false)
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
const selectedLabel = computed(() => {
  const rule = options.value.find(row => row.id === selection.value?.id) ?? selection.value
  return rule ? `${rule.name} · ${rule.ruleCode}` : null
})
function selectRule(value: string) {
  const rule = options.value.find(row => row.id === value)
    ?? (selection.value?.id === value ? selection.value : undefined)
  if (rule) {
    selection.value = rule
  }
  dropdownOpen.value = false
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
function search(value: string | undefined) {
  keyword.value = (value ?? '').trim().slice(0, 128)
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
    <FaPopover v-model:open="dropdownOpen" class="w-[min(32rem,calc(100vw-2rem))] p-3!">
      <FaButton
        type="button"
        variant="outline"
        class="max-w-full min-w-0 w-full justify-between"
        :disabled="props.disabled"
        :aria-label="t('shippingMarkBinding.selectRule')"
        aria-haspopup="listbox"
        :aria-expanded="dropdownOpen"
      >
        <span class="truncate">{{ selectedLabel ?? t('shippingMarkBinding.selectRule') }}</span>
        <FaIcon name="i-lucide:chevrons-up-down" class="text-muted-foreground shrink-0 size-4" aria-hidden="true" />
      </FaButton>
      <template #panel>
        <div class="space-y-2">
          <FaInput
            v-model="searchDraft"
            placeholder="搜索规则名称或编码"
            clearable
            :aria-label="t('shippingMarkBinding.selectRule')"
            @update:model-value="search"
          />
          <div class="max-h-72 overflow-y-auto" role="listbox" :aria-label="t('shippingMarkBinding.selectRule')">
            <button
              v-for="rule in choices"
              :key="rule.value"
              type="button"
              role="option"
              :aria-selected="selection?.id === rule.value"
              :disabled="rule.disabled"
              class="text-sm px-3 py-2 text-left rounded-md w-full hover:bg-accent disabled:opacity-50"
              @click="selectRule(rule.value)"
            >
              {{ rule.label }}
            </button>
            <p v-if="loading" class="text-sm text-muted-foreground m-0 px-3 py-2">
              加载中…
            </p>
            <p v-else-if="!options.length" class="text-sm text-muted-foreground m-0 px-3 py-2">
              {{ t('shippingMarkBinding.noOptions') }}
            </p>
          </div>
          <div class="text-xs text-muted-foreground flex flex-wrap gap-2 items-center justify-between">
            <span>{{ t('shippingMarkBinding.loaded', { count: options.length, total }) }}</span>
            <FaButton v-if="page * 20 < total" variant="link" size="sm" :disabled="loading || disabled" @click="more">
              {{ t('shippingMarkBinding.more') }}
            </FaButton>
          </div>
        </div>
      </template>
    </FaPopover>
    <p v-if="error" class="text-sm text-destructive m-0" role="alert">
      {{ error }} <FaButton variant="link" size="sm" :disabled="loading || disabled" @click="load()">
        {{ t('shippingMarkBinding.retry') }}
      </FaButton>
    </p>
  </div>
</template>
