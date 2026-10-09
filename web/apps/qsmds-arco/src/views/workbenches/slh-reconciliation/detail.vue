<script setup lang="ts">
import type { SlhReconciliationBatchDetailDto } from '@/api/generated/types.gen'
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { containerFailure } from '../containers/use-container-resource'
import { resolveSlhReconciliationBatchLabelKey, resolveSlhReconciliationBatchTone } from './status.logic'

/**
 * 批次详情页：主体保持空白（重构中，不展示任何批次内容）。
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
const actionError = ref('')
let controller: AbortController | null = null

/** 只有读到了进行中的批次才能完成：状态由服务端数据派生，刷新页面后同样正确。 */
const canComplete = computed(() => batch.value?.status === 'IN_PROGRESS')

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
    <!-- 主体保持空白：只在读取失败时给出错误与重试，不展示任何批次内容。 -->
    <FaPageMain class="min-w-0">
      <template v-if="loadError">
        <FaAlert variant="destructive" role="alert" :title="loadError" />
        <FaButton class="mt-3" variant="outline" @click="load">
          {{ t('slhBill.retry') }}
        </FaButton>
      </template>
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
