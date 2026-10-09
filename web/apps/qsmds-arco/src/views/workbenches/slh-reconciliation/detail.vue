<script setup lang="ts">
import type { SlhReconciliationBatchDetailDto } from '@/api/generated/types.gen'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsReconciliationLineSwitcher from '@/components/business/QsReconciliationLineSwitcher/index.vue'
import { containerFailure } from '../containers/use-container-resource'
import {
  buildSlhReconciliationLineFields,
  buildSlhReconciliationLineItems,
  buildSlhReconciliationMemberListText,
  resolveSlhReconciliationSelectedMember,
  SLH_RECONCILIATION_LINE_TONES,
} from './detail.logic'
import { resolveSlhReconciliationBatchLabelKey, resolveSlhReconciliationBatchTone } from './status.logic'

/**
 * 批次详情页：用切换器浏览创建时冻结的明细行，选中行的字段数据跟在下方（对照工作台后续再做）。
 * 头部辅助文字给出批次状态、批次编号与账单基础信息（账单编号、对账单名称）；
 * 底部承接「结束批次」接口的「完成批次对账」动作。
 */
defineOptions({ name: 'QsFinanceBillReconciliationSlhReconciliationDetail' })
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const toast = useQsToast()
const batchId = computed(() => String(route.params.id ?? ''))
const batch = shallowRef<SlhReconciliationBatchDetailDto | null>(null)
const loading = ref(false)
const loadError = ref('')
const completeOpen = ref(false)
const completing = ref(false)
const copyingMembers = ref(false)
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
const selectedLineFields = computed(() => (
  selectedMember.value === null ? [] : buildSlhReconciliationLineFields(selectedMember.value, translate)
))

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

/** 复制整份成员清单：内容与页面上逐字一致，失败只提示当前用户，不打印清单内容。 */
async function copyMembers(): Promise<void> {
  if (copyingMembers.value || members.value.length === 0) {
    return
  }
  copyingMembers.value = true
  try {
    await navigator.clipboard.writeText(buildSlhReconciliationMemberListText(members.value))
    toast.success(t('slhReconciliation.detail.membersCopied'))
  }
  catch {
    toast.error(t('slhReconciliation.detail.membersCopyFailed'))
  }
  finally {
    copyingMembers.value = false
  }
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
    <!-- 主体用切换器浏览冻结成员：读取失败时给出错误与重试，其余批次内容留到详情页重做时再补。 -->
    <FaPageMain class="min-w-0">
      <template v-if="loadError">
        <FaAlert variant="destructive" role="alert" :title="loadError" />
        <FaButton class="mt-3" variant="outline" @click="load">
          {{ t('slhBill.retry') }}
        </FaButton>
      </template>
      <section v-else-if="batch" class="p-4 border border-border rounded-lg flex flex-col gap-3">
        <header class="flex flex-wrap gap-2 items-center justify-between">
          <h2 class="qs-type-compact-title m-0">
            {{ t('slhReconciliation.detail.membersTitle', { count: members.length }) }}
          </h2>
          <FaButton variant="outline" size="sm" :disabled="members.length === 0 || copyingMembers" @click="copyMembers">
            <FaIcon name="i-lucide:copy" aria-hidden="true" />{{ t('slhReconciliation.detail.membersCopy') }}
          </FaButton>
        </header>
        <p v-if="members.length === 0" class="qs-type-description text-muted-foreground m-0">
          {{ t('slhReconciliation.detail.membersEmpty') }}
        </p>
        <template v-else>
          <QsReconciliationLineSwitcher
            v-model="selectedLineId"
            :items="lineSwitcherItems"
            :status-tones="SLH_RECONCILIATION_LINE_TONES"
            :aria-label="t('slhReconciliation.detail.lineSwitcherLabel')"
          />
          <!-- 选中行的字段数据：先给纯字段清单，完整的对照工作台后续再做。 -->
          <section class="flex flex-col gap-2" aria-labelledby="slh-reconciliation-line-data-title">
            <h3 id="slh-reconciliation-line-data-title" class="qs-type-compact-title m-0">
              {{ t('slhReconciliation.detail.lineDataTitle') }}
            </h3>
            <p v-if="selectedMember === null" class="qs-type-description text-muted-foreground m-0">
              {{ t('slhReconciliation.detail.lineDataEmpty') }}
            </p>
            <dl v-else class="m-0 gap-x-8 gap-y-1 grid md:grid-cols-2">
              <div v-for="field in selectedLineFields" :key="field.id" class="flex gap-2 min-w-0 items-baseline">
                <dt class="qs-type-compact-label shrink-0">
                  {{ field.label }}
                </dt>
                <dd class="qs-type-data m-0 break-all">
                  {{ field.value }}
                </dd>
              </div>
            </dl>
          </section>
        </template>
      </section>
    </FaPageMain>
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
