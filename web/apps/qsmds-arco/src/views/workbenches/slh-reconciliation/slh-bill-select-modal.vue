<script setup lang="ts">
import type { SlhBillListItemDto } from '@/api/generated/types.gen'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { containerFailure } from '../containers/use-container-resource'
import { resolveSlhBillNetDisplay } from '../slh-bills/display.logic'
import SlhBillOverflowText from '../slh-bills/slh-bill-overflow-text.vue'
import SlhBillReconciliationStatusTag from '../slh-bills/slh-bill-reconciliation-status-tag.vue'
import {
  buildSlhBillSelectQuery,
  resolveSlhBillSelectEmptyKind,
  SLH_BILL_SELECT_PAGE_SIZE,
  toggleSlhBillSelection,
} from './bill-select.logic'

/**
 * 「选择对账账单」：为新建对账批次单选一张账单。
 * 候选集合由服务端的候选账单接口决定（生效中 + 仍有未对账行 + 没有进行中批次），
 * 页面只负责取数、分页与单选；确认后只把选中项交回调用方，不在这里跳转。
 */
defineOptions({ name: 'SlhBillSelectModal' })
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  'confirm': [bill: SlhBillListItemDto]
}>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const keyword = ref('')
const page = ref(1)
const pageSize = SLH_BILL_SELECT_PAGE_SIZE
const items = shallowRef<SlhBillListItemDto[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
/** 暂存的选中项；跨翻页与搜索保留，确认时直接拿到账单对象。 */
const selected = shallowRef<SlhBillListItemDto | null>(null)
let controller: AbortController | null = null

const emptyKind = computed(() => resolveSlhBillSelectEmptyKind({ keyword: keyword.value, total: total.value }))

async function load(): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  try {
    const response = await slhReconciliationBatchesApi.candidates(
      buildSlhBillSelectQuery({ page: page.value, pageSize, keyword: keyword.value }),
      current.signal,
    )
    if (current.signal.aborted) {
      return
    }
    items.value = response.data.items
    total.value = response.data.total
  }
  catch (failure) {
    if (!current.signal.aborted) {
      items.value = []
      total.value = 0
      error.value = containerFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}

/** 搜索一律回到第 1 页：否则第 3 页搜出来是空的会像"没有结果"。 */
function search(): void {
  page.value = 1
  void load()
}

function changePage(next: number): void {
  if (next === page.value) {
    return
  }
  page.value = next
  void load()
}

function selectBill(bill: SlhBillListItemDto): void {
  selected.value = toggleSlhBillSelection(selected.value, bill)
}

function confirm(): void {
  if (selected.value === null) {
    return
  }
  emit('confirm', selected.value)
  open.value = false
}

/** 每次打开都从干净的第一页开始取数；选中项保留，便于关掉再核对。 */
watch(open, (value) => {
  if (!value) {
    controller?.abort()
    return
  }
  keyword.value = ''
  page.value = 1
  void load()
})
onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <QsGenericModal v-model="open" :title="t('slhReconciliation.billSelect.title')" size="lg">
    <div class="flex flex-col gap-3 min-w-0">
      <div class="flex gap-2 items-center">
        <FaInput
          v-model="keyword"
          class="flex-1"
          clearable
          :placeholder="t('slhReconciliation.billSelect.searchPlaceholder')"
          @clear="search"
          @keyup.enter="search"
        />
        <FaButton type="button" variant="outline" @click="search">
          {{ t('slhReconciliation.billSelect.search') }}
        </FaButton>
      </div>

      <!-- 取数期间给骨架卡片：弹窗与搜索框保持可见，不整窗闪。 -->
      <div v-if="loading" role="status" :aria-label="t('slhReconciliation.billSelect.loading')" class="flex flex-col gap-2">
        <div v-for="index in 3" :key="index" aria-hidden="true" class="rounded-lg bg-muted/40 h-20 animate-pulse" />
      </div>
      <div v-else-if="error" class="py-8 flex flex-col gap-3 items-center">
        <FaEmpty icon="i-lucide:clipboard-check" :title="t('slhReconciliation.billSelect.loadFailed')" :description="error" />
        <FaButton variant="outline" @click="load">
          {{ t('slhBill.retry') }}
        </FaButton>
      </div>
      <FaEmpty
        v-else-if="emptyKind !== null"
        :icon="emptyKind === 'keyword' ? 'i-lucide:file-search' : 'i-lucide:clipboard-check'"
        :title="emptyKind === 'keyword'
          ? t('slhReconciliation.billSelect.emptyKeyword', { keyword: keyword.trim() })
          : t('slhReconciliation.billSelect.empty')"
        :description="emptyKind === 'keyword'
          ? t('slhReconciliation.billSelect.emptyKeywordHint')
          : t('slhReconciliation.billSelect.emptyHint')"
        class="py-10"
      />
      <template v-else>
        <div role="radiogroup" :aria-label="t('slhReconciliation.billSelect.title')" class="flex flex-col gap-1.5">
          <!-- 整卡就是一个单选项：点选中的卡片＝取消，点另一张＝切换。两行结构：一级行放标识与净额，三级行收拢元数据。 -->
          <button
            v-for="bill in items"
            :key="bill.id"
            type="button"
            role="radio"
            :aria-checked="selected?.id === bill.id"
            class="px-3 py-1.5 text-left border rounded-lg flex flex-col gap-1 w-full transition-colors"
            :class="selected?.id === bill.id ? 'border-primary border-l-2 bg-primary/5' : 'border-border hover:bg-muted/40'"
            @click="selectBill(bill)"
          >
            <span class="flex flex-wrap gap-2 min-w-0 w-full items-center">
              <span class="qs-type-data-emphasis font-semibold shrink-0">{{ bill.slhBillNo }}</span>
              <SlhBillReconciliationStatusTag :status="bill.reconciliationStatus" class="shrink-0" />
              <!-- 名称自己撑满剩余宽度并在其中截断，净额才能贴住卡片右端、跨卡对齐。 -->
              <span class="min-w-0 flex-1"><SlhBillOverflowText :text="bill.billName" content-class="qs-type-compact-title" /></span>
              <AmountDisplay
                :value="resolveSlhBillNetDisplay(bill).amount"
                :currency="resolveSlhBillNetDisplay(bill).currency"
                :currencies="currencyCatalog.currencies.value"
                class="qs-type-data-emphasis shrink-0"
              />
              <FaIcon v-if="selected?.id === bill.id" name="i-lucide:check" class="text-primary shrink-0" aria-hidden="true" />
            </span>
            <!-- 三级信息压成一行：期间 · 行数 · 柜号数 · 应付；创建时间不参与选择判断，不进卡片。 -->
            <span class="qs-type-meta text-muted-foreground flex flex-wrap gap-x-2 w-full items-center tabular-nums">
              <span>{{ bill.periodStart }} ~ {{ bill.periodEnd }} · {{ t('slhReconciliation.billSelect.lineCount', { count: bill.lineCount }) }} · {{ t('slhReconciliation.billSelect.containerCount', { count: bill.containerBatchCount }) }}</span>
              <span class="flex gap-1 items-center">
                {{ t('slhReconciliation.billSelect.payableLabel') }}
                <AmountDisplay
                  :value="bill.payableTotalAmountCny"
                  currency="CNY"
                  :currencies="currencyCatalog.currencies.value"
                />
              </span>
            </span>
          </button>
        </div>
        <FaPagination
          v-if="total > 0"
          :page="page"
          :size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          :text-templates="{ total: value => t('slhReconciliation.billSelect.totalBills', { count: value }) }"
          @update:page="changePage($event)"
        />
      </template>
    </div>

    <template #footer>
      <div class="flex flex-col gap-2 w-full sm:flex-row sm:items-center">
        <span class="qs-type-description text-muted-foreground truncate">
          {{ selected === null
            ? t('slhReconciliation.billSelect.selectHint')
            : t('slhReconciliation.billSelect.selectedHint', { billNo: selected.slhBillNo }) }}
        </span>
        <div class="flex-1" />
        <FaButton type="button" variant="outline" class="w-full sm:w-auto" @click="open = false">
          {{ t('slhBill.cancel') }}
        </FaButton>
        <FaButton type="button" class="w-full sm:w-auto" :disabled="selected === null" @click="confirm">
          {{ t('slhReconciliation.billSelect.confirm') }}
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
