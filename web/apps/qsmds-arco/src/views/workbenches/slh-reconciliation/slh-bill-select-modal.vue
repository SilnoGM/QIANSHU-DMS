<script setup lang="ts">
import type { SlhBillSelectGroup } from './bill-select.logic'
import type { SlhReconciliationBatchDetailDto, SlhReconciliationBillOptionDto } from '@/api/generated/types.gen'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { containerFailure } from '../containers/use-container-resource'
import { resolveSlhBillNetDisplay } from '../slh-bills/display.logic'
import SlhBillOverflowText from '../slh-bills/slh-bill-overflow-text.vue'
import SlhBillReconciliationStatusTag from '../slh-bills/slh-bill-reconciliation-status-tag.vue'
import {
  buildSlhBillBlockReasonText,
  buildSlhBillSelectQuery,
  resolveSlhBillSelectEmptyKind,
  SLH_BILL_SELECT_GROUPS,
  SLH_BILL_SELECT_PAGE_SIZE,
  toggleSlhBillSelection,
} from './bill-select.logic'

/**
 * 「选择对账账单」：为新建对账批次单选一张账单。
 *
 * 服务端把生效中的账单分成两组：**可选**（当前有可核对的行、且没有进行中批次）与
 * **不可选**（附原因）；确认后由本组件创建批次（服务端重跑匹配并比对行集合），
 * 成功才把批次交回调用方（由调用方跳转详情页）。
 */
defineOptions({ name: 'SlhBillSelectModal' })
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  'created': [batch: SlhReconciliationBatchDetailDto]
}>()

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()

const open = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const group = ref<SlhBillSelectGroup>('SELECTABLE')
const keyword = ref('')
const page = ref(1)
const pageSize = SLH_BILL_SELECT_PAGE_SIZE
const items = shallowRef<SlhReconciliationBillOptionDto[]>([])
const counts = ref<{ selectable: number, blocked: number }>({ selectable: 0, blocked: 0 })
const total = ref(0)
const loading = ref(false)
const error = ref('')
/** 暂存的选中项；跨翻页与搜索保留，确认时直接拿到账单对象。 */
const selected = shallowRef<SlhReconciliationBillOptionDto | null>(null)
const submitting = ref(false)
const submitError = ref('')
/**
 * 幂等键：改选账单后重置；同一意图的失败重试复用同一个键，
 * 网络超时重试不会多建一条批次（服务端按键返回同一批次）。
 */
let idempotencyKey: string | null = null
let controller: AbortController | null = null

const groupItems = computed(() => SLH_BILL_SELECT_GROUPS.map(value => ({
  value,
  label: t(value === 'SELECTABLE' ? 'slhReconciliation.billSelect.groupSelectable' : 'slhReconciliation.billSelect.groupBlocked'),
  count: counts.value[value === 'SELECTABLE' ? 'selectable' : 'blocked'],
})))
const emptyKind = computed(() => resolveSlhBillSelectEmptyKind({ group: group.value, keyword: keyword.value, total: total.value }))
const emptyTitle = computed(() => {
  if (emptyKind.value === 'keyword') {
    return t('slhReconciliation.billSelect.emptyKeyword', { keyword: keyword.value.trim() })
  }
  return emptyKind.value === 'blocked' ? t('slhReconciliation.billSelect.emptyBlocked') : t('slhReconciliation.billSelect.empty')
})
const emptyDescription = computed(() => {
  if (emptyKind.value === 'keyword') {
    return t('slhReconciliation.billSelect.emptyKeywordHint')
  }
  return emptyKind.value === 'blocked' ? t('slhReconciliation.billSelect.emptyBlockedHint') : t('slhReconciliation.billSelect.emptyHint')
})

/** 不可选卡片的说明：拼接规则在 bill-select.logic 里（含原因摘要与「等 N 类」），这里只接翻译。 */
function blockReasonText(bill: SlhReconciliationBillOptionDto): string {
  return buildSlhBillBlockReasonText(bill, (key, params) => params === undefined ? t(key) : t(key, params))
}

async function load(): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  try {
    const response = await slhReconciliationBatchesApi.selectableBills(
      buildSlhBillSelectQuery({ group: group.value, page: page.value, pageSize, keyword: keyword.value }),
      current.signal,
    )
    if (current.signal.aborted) {
      return
    }
    items.value = response.data.items
    counts.value = { selectable: response.data.counts.selectable, blocked: response.data.counts.blocked }
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

/** 切分组同样回到第 1 页；关键词与已选中的账单都保留。 */
function selectGroup(next: string): void {
  const value = next as SlhBillSelectGroup
  if (value === group.value) {
    return
  }
  group.value = value
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

function selectBill(bill: SlhReconciliationBillOptionDto): void {
  // 改选就把幂等键作废：这是另一张账单，不能复用上一个意图的键。
  idempotencyKey = null
  selected.value = toggleSlhBillSelection(selected.value, bill)
}

/** 确认＝创建批次：成功才交回调用方，失败留在弹窗里说明原因并刷新两组数据。 */
async function confirm(): Promise<void> {
  if (selected.value === null || !selected.value.selectable || submitting.value) {
    return
  }
  idempotencyKey ??= crypto.randomUUID()
  submitting.value = true
  submitError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.create(
      { billId: selected.value.id, reconcilableLineIds: selected.value.reconcilableLineIds },
      idempotencyKey,
      new AbortController().signal,
    )
    idempotencyKey = null
    emit('created', response.data)
    open.value = false
  }
  catch (failure) {
    // 占用冲突、范围变化或取号失败都要让用户重新看一眼，因此把两组数据一起刷新。
    submitError.value = containerFailure(failure).message
    selected.value = null
    await load()
  }
  finally {
    submitting.value = false
  }
}

/** 每次打开都从干净的第一页、可选分组开始取数；选中项保留，便于关掉再核对。 */
watch(open, (value) => {
  if (!value) {
    controller?.abort()
    return
  }
  group.value = 'SELECTABLE'
  keyword.value = ''
  page.value = 1
  void load()
})
onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <QsGenericModal v-model="open" :title="t('slhReconciliation.billSelect.title')" size="lg" :submitting="submitting">
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

      <QsStatusSwitchToolbar :model-value="group" :items="groupItems" :aria-label="t('slhReconciliation.billSelect.title')" @update:model-value="selectGroup" />

      <!-- 创建失败留在弹窗里说明原因（占用冲突、范围变化、取号不可用等），不跳转也不关窗。 -->
      <FaAlert v-if="submitError" variant="destructive" role="alert" :title="submitError" />

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
        :title="emptyTitle"
        :description="emptyDescription"
        class="py-10"
      />
      <template v-else>
        <div
          :role="group === 'SELECTABLE' ? 'radiogroup' : undefined"
          :aria-label="group === 'SELECTABLE' ? t('slhReconciliation.billSelect.title') : undefined"
          :inert="submitting || undefined"
          class="flex flex-col gap-1.5"
        >
          <!-- 可选＝单选项；不可选＝同款卡片但不可点，最后一行给出原因。 -->
          <component
            :is="bill.selectable ? 'button' : 'div'"
            v-for="bill in items"
            :key="bill.id"
            :type="bill.selectable ? 'button' : undefined"
            :role="bill.selectable ? 'radio' : undefined"
            :aria-checked="bill.selectable ? selected?.id === bill.id : undefined"
            :aria-disabled="bill.selectable ? undefined : 'true'"
            class="px-3 py-1.5 text-left border rounded-lg flex flex-col gap-1 w-full transition-colors"
            :class="bill.selectable
              ? (selected?.id === bill.id ? 'border-primary border-l-2 bg-primary/5' : 'border-border hover:bg-muted/40')
              : 'border-border bg-muted/20'"
            @click="selectBill(bill)"
          >
            <span class="flex flex-wrap gap-2 min-w-0 w-full items-center">
              <span class="qs-type-data-emphasis font-semibold shrink-0">{{ bill.slhBillNo }}</span>
              <SlhBillReconciliationStatusTag :status="bill.reconciliationStatus" class="shrink-0" />
              <span class="flex-1 min-w-0"><SlhBillOverflowText :text="bill.billName" content-class="qs-type-compact-title" /></span>
              <span v-if="bill.selectable" class="qs-type-body-medium text-primary shrink-0 tabular-nums">
                {{ t('slhReconciliation.billSelect.reconcilable', { count: bill.reconcilableLineCount }) }}
              </span>
              <AmountDisplay
                :value="resolveSlhBillNetDisplay(bill).amount"
                :currency="resolveSlhBillNetDisplay(bill).currency"
                :currencies="currencyCatalog.currencies.value"
                class="qs-type-data-emphasis shrink-0"
              />
              <FaIcon v-if="bill.selectable && selected?.id === bill.id" name="i-lucide:check" class="text-primary shrink-0" aria-hidden="true" />
            </span>
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
            <span v-if="!bill.selectable" class="qs-type-meta text-destructive w-full">
              {{ blockReasonText(bill) }}
            </span>
          </component>
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
        <FaButton type="button" variant="outline" class="w-full sm:w-auto" :disabled="submitting" @click="open = false">
          {{ t('slhBill.cancel') }}
        </FaButton>
        <FaButton type="button" class="w-full sm:w-auto" :loading="submitting" :disabled="selected === null || submitting" @click="confirm">
          {{ t('slhReconciliation.billSelect.confirm') }}
        </FaButton>
      </div>
    </template>
  </QsGenericModal>
</template>
