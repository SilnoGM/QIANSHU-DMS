<script setup lang="ts">
defineOptions({ name: 'QsFinanceShunlianhangOceanBills' })

const { t } = useI18n()
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.shunlianhangOceanBills')" :description="t('workbench.shunlianhangOceanBillsDescription')" />
    <FaPageMain>
      <FaEmpty icon="qs-ocean-containers" :title="t('workbench.pending')" class="py-12" />
    </FaPageMain>
  </div>
</template>
