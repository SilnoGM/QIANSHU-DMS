<script setup lang="ts">
defineOptions({ name: 'QsFinanceShunlianhangOceanBillDetail' })

const { t } = useI18n()
const router = useRouter()
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.shunlianhangOceanBillDetail')" :description="t('workbench.shunlianhangOceanBillDetailDescription')">
      <FaButton variant="outline" class="min-h-11 sm:min-h-9" @click="router.push({ name: 'qsFinanceShunlianhangOceanBills' })">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />
        {{ t('workbench.backToShunlianhangOceanBills') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain>
      <FaEmpty icon="qs-ocean-containers" :title="t('workbench.pending')" class="py-12" />
    </FaPageMain>
  </div>
</template>
