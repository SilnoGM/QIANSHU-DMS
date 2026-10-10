<script setup lang="ts">
import type { SlhReconciliationFieldGroup } from './detail.logic'
import type { SlhReconciliationBatchDetailDto } from '@/api/generated/types.gen'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsReconciliationLineSwitcher from '@/components/business/QsReconciliationLineSwitcher/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { resolveStatusTagToneClass } from '@/utils/status-tag-tone'
import { containerFailure } from '../containers/use-container-resource'
import {
  buildSlhReconciliationBillLineFieldGroups,
  buildSlhReconciliationFocusValues,
  buildSlhReconciliationLineItems,
  buildSlhReconciliationLoadingItemFieldGroups,
  buildSlhReconciliationOrderFieldGroups,
  resolveSlhReconciliationSelectedMember,
  SLH_RECONCILIATION_LINE_TONES,
} from './detail.logic'
import { resolveSlhReconciliationBatchLabelKey, resolveSlhReconciliationBatchTone } from './status.logic'

/**
 * 批次详情页：切换器自带面板，用来浏览创建时冻结的明细行；切换器下方是「核对焦点」——
 * 三个跨域金额（销售尾款 / 装柜代收货款 / 账单代收货款）并列展示供人工比对，只展示不判定；
 * 再往下三块面板横向排布，分别展示选中行的销售/采购信息、装柜明细行信息与账单明细行信息。
 * 头部辅助文字给出批次状态、批次编号与账单基础信息；底部承接「完成批次对账」动作。
 */
defineOptions({ name: 'QsFinanceBillReconciliationSlhReconciliationDetail' })
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const batchId = computed(() => String(route.params.id ?? ''))
const batch = shallowRef<SlhReconciliationBatchDetailDto | null>(null)
const loading = ref(false)
const loadError = ref('')
const completeOpen = ref(false)
const completing = ref(false)
const actionError = ref('')
/** 选中行由页面持有：切换器只发 update:modelValue，行数据与后续核对动作都跟着它走。 */
const selectedLineId = ref<string | null>(null)
let controller: AbortController | null = null

/** 纯函数只要求最小翻译签名；带参数时显式展开，与弹窗里的既有写法一致。 */
function translate(key: string, params?: Record<string, unknown>) {
  return params === undefined ? t(key) : t(key, params)
}

/** 只有读到了进行中的批次才能完成：状态由服务端数据派生，刷新页面后同样正确。 */
const canComplete = computed(() => batch.value?.status === 'IN_PROGRESS')
const members = computed(() => batch.value?.members ?? [])
const lineSwitcherItems = computed(() => buildSlhReconciliationLineItems(members.value, translate))
const selectedMember = computed(() => resolveSlhReconciliationSelectedMember(members.value, selectedLineId.value))
/** 核对焦点与三块面板的字段清单都跟着选中行走；均为纯函数结果，不额外请求数据。 */
const focusValues = computed(() => (
  selectedMember.value === null ? [] : buildSlhReconciliationFocusValues(selectedMember.value, translate)
))
const orderFieldGroups = computed(() => (
  selectedMember.value === null ? [] : buildSlhReconciliationOrderFieldGroups(selectedMember.value, translate)
))
const loadingItemFieldGroups = computed(() => (
  selectedMember.value === null ? [] : buildSlhReconciliationLoadingItemFieldGroups(selectedMember.value, translate)
))
const billLineFieldGroups = computed(() => (
  selectedMember.value === null ? [] : buildSlhReconciliationBillLineFieldGroups(selectedMember.value, translate)
))
/** 面板列：标题可选（没有标题时分组标题自己就是这一块的一级标题）。 */
interface SlhReconciliationFieldColumn {
  readonly id: string
  readonly titleKey?: string
  /** 相邻分组之间画一条分割线：销售与采购同处一个面板时用它分区。 */
  readonly groupDividers?: boolean
  readonly groups: readonly SlhReconciliationFieldGroup[]
}
/** 三块面板共用同一段模板：标题 + 分组后的字段清单。 */
const fieldColumns = computed<readonly SlhReconciliationFieldColumn[]>(() => [
  // 销售与采购共用一个面板：两个分组各自成块，用分割线隔开，不再有合成标题。
  { id: 'orders', groups: orderFieldGroups.value, groupDividers: true },
  { id: 'loadingItem', titleKey: 'slhReconciliation.detail.loadingItemTitle', groups: loadingItemFieldGroups.value },
  { id: 'billLine', titleKey: 'slhReconciliation.detail.billLineTitle', groups: billLineFieldGroups.value },
])
/** 分组的上下间距：首个分组在面板标题下留白；有分割线的分组由分割线自己撑开间距。 */
function sectionClass(column: SlhReconciliationFieldColumn, index: number): string {
  if (index === 0) {
    return column.titleKey === undefined ? '' : 'mt-3'
  }
  return column.groupDividers === true ? '' : 'mt-3'
}

/**
 * 成员变化后收敛选中值：仍在清单里就保持，否则退回第一条，批次为空时清空。
 * 切换器不擅自改模型值，选中项的校正属于页面职责。
 */
watch(members, (list) => {
  if (selectedLineId.value !== null && list.some(member => member.lineId === selectedLineId.value)) {
    return
  }
  selectedLineId.value = list.at(0)?.lineId ?? null
}, { immediate: true })

async function load(): Promise<void> {
  controller?.abort()
  const current = new AbortController()
  controller = current
  loading.value = true
  loadError.value = ''
  try {
    const response = await slhReconciliationBatchesApi.get(batchId.value, current.signal)
    if (current.signal.aborted) {
      return
    }
    batch.value = response.data
  }
  catch (failure) {
    if (!current.signal.aborted) {
      batch.value = null
      loadError.value = containerFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}

function backToList(): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhBillReconciliation' })
}

async function complete(): Promise<void> {
  if (!canComplete.value || completing.value) {
    return
  }
  completing.value = true
  actionError.value = ''
  try {
    await slhReconciliationBatchesApi.complete(batchId.value, new AbortController().signal)
    completeOpen.value = false
    toast.success(t('slhReconciliation.detail.completedToast'))
    // 重新读回：头部状态标签与底部按钮的禁用都跟着服务端数据走。
    await load()
  }
  catch (failure) {
    actionError.value = containerFailure(failure).message
    completeOpen.value = false
  }
  finally {
    completing.value = false
  }
}

watch(batchId, () => {
  void load()
}, { immediate: true })
onBeforeUnmount(() => {
  controller?.abort()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.slhBillReconciliationDetail')">
      <template #description>
        <span v-if="batch" class="qs-type-description text-muted-foreground flex flex-wrap gap-2 items-center">
          <FaTag variant="outline" class="qs-type-status-tag" :class="resolveSlhReconciliationBatchTone(batch.status)">
            {{ t(resolveSlhReconciliationBatchLabelKey(batch.status)) }}
          </FaTag>
          <span class="font-mono">{{ batch.batchNo }}</span>
          <span aria-hidden="true">·</span>
          <span class="font-mono">{{ batch.bill.slhBillNo }}</span>
          <span class="text-foreground">{{ batch.bill.billName }}</span>
        </span>
      </template>
      <FaButton variant="outline" class="w-full sm:w-auto" @click="backToList">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('slhReconciliation.backToList') }}
      </FaButton>
    </FaPageHeader>
    <!-- 读取失败给错误与重试；其余批次内容留到详情页重做时再补。 -->
    <FaPageMain v-if="loadError" class="min-w-0">
      <FaAlert variant="destructive" role="alert" :title="loadError" />
      <FaButton class="mt-3" variant="outline" @click="load">
        {{ t('slhBill.retry') }}
      </FaButton>
    </FaPageMain>
    <template v-else-if="batch">
      <template v-if="members.length > 0">
        <!-- 切换器独立成一块面板：只用一个普通容器承接页面外边距，不塞进 FaPageMain 里。 -->
        <div class="m-4 min-w-0">
          <QsReconciliationLineSwitcher
            v-model="selectedLineId"
            :items="lineSwitcherItems"
            :status-tones="SLH_RECONCILIATION_LINE_TONES"
            :aria-label="t('slhReconciliation.detail.lineSwitcherLabel')"
          />
        </div>
        <!--
          核对焦点：三个跨域金额并列展示，只供人工目测比对（不判定、不给差异、不换算币种）。
          按产品要求不显示标题与说明文字；容器只保留一个不可见的无障碍名称。
        -->
        <div
          v-if="selectedMember"
          class="m-4 min-w-0"
          role="group"
          :aria-label="t('slhReconciliation.detail.focusTitle')"
        >
          <div class="gap-4 grid sm:grid-cols-3">
            <div
              v-for="focus in focusValues"
              :key="focus.id"
              data-slot="slh-reconciliation-focus-item"
              class="qs-focus-card p-4 border border-border rounded-xl bg-card min-w-0"
              :class="`qs-focus-card--${focus.accent}`"
            >
              <!-- 装饰图案：与来源同域的大号图标，只做视觉标记，不进无障碍树。 -->
              <FaIcon
                :name="focus.motif"
                aria-hidden="true"
                class="qs-focus-card__motif"
              />
              <!-- 内容自成一格并抬到图案之上，否则绝对定位的图案会盖住金额文字。 -->
              <div class="flex flex-col gap-1 min-w-0 relative z-1">
                <p class="qs-type-compact-label text-muted-foreground m-0">
                  {{ focus.sourceLabel }}
                </p>
                <AmountDisplay
                  v-if="!focus.isEmpty"
                  :value="focus.value"
                  :currency="focus.currency"
                  :currencies="currencyCatalog.currencies.value"
                  class="!text-2xl !font-semibold"
                />
                <!-- 空值＝本行不涉及：只留占位符与说明，与 0.00 区分开。 -->
                <template v-else>
                  <p class="text-base text-muted-foreground m-0">
                    {{ t('slhBill.valueMissing') }}
                  </p>
                  <p class="qs-type-meta text-muted-foreground m-0">
                    {{ t('slhReconciliation.detail.focusEmptyNote') }}
                  </p>
                </template>
              </div>
            </div>
          </div>
        </div>
        <!-- 选中行的三方资料横向排布：宽屏三列、中屏两列、窄屏堆叠。 -->
        <div
          v-if="selectedMember"
          class="m-4 gap-4 grid items-start lg:grid-cols-2 xl:grid-cols-3"
        >
          <FaPageMain v-for="column in fieldColumns" :key="column.id" class="m-0 min-w-0">
            <h2 v-if="column.titleKey" class="qs-type-compact-title m-0">
              {{ t(column.titleKey) }}
            </h2>
            <template v-for="(group, groupIndex) in column.groups" :key="group.id">
              <!-- 销售与采购两块的唯一分隔：装饰性分割线不进无障碍树。 -->
              <div
                v-if="column.groupDividers === true && groupIndex > 0"
                class="my-3 border-t border-border"
                aria-hidden="true"
              />
              <div class="flex flex-col gap-1" :class="sectionClass(column, groupIndex)">
                <!-- 没有面板标题时分组标题升为 h2：一块面板两级标题，层级不断档。 -->
                <component
                  :is="column.titleKey === undefined ? 'h2' : 'h3'"
                  class="m-0"
                  :class="column.titleKey === undefined ? 'qs-type-compact-title' : 'qs-type-compact-label'"
                >
                  {{ group.label }}
                </component>
                <dl class="m-0 flex flex-col gap-1">
                  <div v-for="field in group.fields" :key="field.id" class="flex gap-2 min-w-0 items-baseline">
                    <dt class="qs-type-meta shrink-0">
                      {{ field.label }}
                    </dt>
                    <dd class="m-0 break-all">
                      <!-- 金额行统一走 AmountDisplay（符号、千分位、币种精度）；缺失时回落占位符文本。 -->
                      <AmountDisplay
                        v-if="field.amount"
                        :value="field.amount.value"
                        :currency="field.amount.currency"
                        :currencies="currencyCatalog.currencies.value"
                        class="!text-left !justify-start"
                      />
                      <!-- 人员行：姓名交给 QsPersonDisplay（头像位 + 单行截断 + 悬停完整名）。 -->
                      <QsPersonDisplay
                        v-else-if="field.person"
                        :display-name="field.person"
                        size="sm"
                        class="max-w-full"
                      />
                      <!-- 状态行：一行展示该订单的三个彩色状态标签（维度名进无障碍朗读）。 -->
                      <span
                        v-else-if="field.tags && field.tags.length > 0"
                        class="flex flex-wrap gap-1.5"
                      >
                        <FaTag
                          v-for="statusTag in field.tags"
                          :key="statusTag.dimension"
                          variant="outline"
                          class="qs-type-status-tag"
                          :class="resolveStatusTagToneClass(statusTag.tone)"
                          :aria-label="`${statusTag.dimension}：${statusTag.label}`"
                        >
                          {{ statusTag.label }}
                        </FaTag>
                      </span>
                      <span v-else class="qs-type-data">
                        {{ field.value }}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>
            </template>
          </FaPageMain>
        </div>
      </template>
      <!-- 没有冻结行时只给一句批次级说明，不让切换器空转。 -->
      <FaPageMain v-else class="min-w-0">
        <p class="qs-type-description text-muted-foreground m-0">
          {{ t('slhReconciliation.detail.membersEmpty') }}
        </p>
      </FaPageMain>
    </template>
    <FaFixedBar position="bottom" class="border-t border-border">
      <div class="flex flex-col gap-3 w-full md:flex-row md:items-center md:justify-end">
        <FaAlert v-if="actionError" variant="destructive" role="alert" :title="actionError" class="md:mr-auto" />
        <FaButton :loading="completing" :disabled="!canComplete || completing" @click="completeOpen = true">
          {{ t('slhReconciliation.detail.completeButton') }}
        </FaButton>
      </div>
    </FaFixedBar>

    <QsGenericModal
      v-model="completeOpen"
      :title="t('slhReconciliation.detail.completeTitle')"
      size="sm"
      :submitting="completing"
    >
      <p class="qs-type-description text-muted-foreground m-0">
        {{ t('slhReconciliation.detail.completeHint') }}
      </p>
      <template #footer>
        <div class="flex flex-col gap-2 w-full sm:flex-row sm:justify-end">
          <FaButton type="button" variant="outline" class="w-full sm:w-auto" :disabled="completing" @click="completeOpen = false">
            {{ t('slhBill.cancel') }}
          </FaButton>
          <FaButton type="button" class="w-full sm:w-auto" :loading="completing" @click="complete">
            {{ t('slhReconciliation.detail.completeConfirm') }}
          </FaButton>
        </div>
      </template>
    </QsGenericModal>
  </div>
</template>

<style scoped>
/*
 * 三张核对焦点卡各自的身份色：纯装饰，不承载任何判定语义（不用语义色的深浅，
 * 只把同色系中调色按固定比例混进当前主题的卡片底色做斜向过渡）。
 * 混色基于 --card，浅色下自动得到淡色高光、深色下得到同色系暗调，无需为明暗各写一套规则。
 */
.qs-focus-card {
  position: relative;
  overflow: hidden;
  background-repeat: no-repeat;
}

/* 装饰图案压在内容下层、不接鼠标事件；颜色同样从主题卡片底色里混出来，明暗主题共用一套。 */
.qs-focus-card__motif {
  position: absolute;
  right: -0.75rem;
  bottom: -1rem;
  z-index: 0;
  width: 6.5rem;
  height: 6.5rem;
  pointer-events: none;
  transform: rotate(-8deg);
}

.qs-focus-card--emerald .qs-focus-card__motif {
  color: color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 14%, oklch(var(--card)));
}

.qs-focus-card--amber .qs-focus-card__motif {
  color: color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 14%, oklch(var(--card)));
}

.qs-focus-card--blue .qs-focus-card__motif {
  color: color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 14%, oklch(var(--card)));
}

.qs-focus-card--emerald {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(69.6% 0.17 162.48deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}

.qs-focus-card--amber {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(76.9% 0.188 70.08deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}

.qs-focus-card--blue {
  background-image:
    radial-gradient(120% 90% at 100% 0%, color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 14%, transparent), transparent 62%),
    linear-gradient(135deg, color-mix(in oklab, oklch(62.3% 0.214 259.815deg) 20%, oklch(var(--card))) 0%, oklch(var(--card)) 70%);
}
</style>
