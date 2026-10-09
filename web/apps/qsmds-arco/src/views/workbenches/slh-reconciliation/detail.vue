<script setup lang="ts">
import slhReconciliationBatchesApi from '@/api/modules/slh-reconciliation-batches'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { containerFailure } from '../containers/use-container-resource'

/**
 * 批次详情页：重构中，主体保持空白（不加任何占位内容与业务字段）。
 * 当前只承载两件事：返回批次列表的入口，以及承接「结束批次」接口的「完成批次对账」动作。
 */
defineOptions({ name: 'QsFinanceBillReconciliationSlhReconciliationDetail' })
const { t } = useI18n()
const router = useRouter()
const route = useRoute()
const toast = useQsToast()
const batchId = computed(() => String(route.params.id ?? ''))
const completeOpen = ref(false)
const completing = ref(false)
/** 本页只在本次会话里记住「刚完成」：详情读取接口尚未解冻，无法回读批次状态。 */
const completed = ref(false)
const actionError = ref('')

function backToList(): void {
  void router.push({ name: 'qsFinanceBillReconciliationSlhBillReconciliation' })
}

async function complete(): Promise<void> {
  if (completing.value || completed.value) {
    return
  }
  completing.value = true
  actionError.value = ''
  try {
    await slhReconciliationBatchesApi.complete(batchId.value, new AbortController().signal)
    completed.value = true
    completeOpen.value = false
    toast.success(t('slhReconciliation.detail.completedToast'))
  }
  catch (failure) {
    actionError.value = containerFailure(failure).message
    completeOpen.value = false
  }
  finally {
    completing.value = false
  }
}
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.slhBillReconciliationDetail')">
      <FaButton variant="outline" class="w-full sm:w-auto" @click="backToList">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />{{ t('slhReconciliation.backToList') }}
      </FaButton>
    </FaPageHeader>
    <!-- 主体保持空白：详情页重构中，不展示任何批次内容。 -->
    <FaPageMain class="min-w-0" />
    <FaFixedBar position="bottom" class="border-t border-border">
      <div class="flex flex-col gap-3 w-full md:flex-row md:items-center md:justify-end">
        <FaAlert v-if="actionError" variant="destructive" role="alert" :title="actionError" class="md:mr-auto" />
        <FaButton :loading="completing" :disabled="completed || completing" @click="completeOpen = true">
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
