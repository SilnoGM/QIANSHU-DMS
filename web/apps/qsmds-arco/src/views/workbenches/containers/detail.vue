<script setup lang="ts">
defineOptions({ name: 'QsPurchaseTransportContainerDetail' })

const { t } = useI18n()
const router = useRouter()
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.containerDetail')" :description="t('workbench.containerDetailDescription')">
      <FaButton variant="outline" class="min-h-11 sm:min-h-9" @click="router.push({ name: 'qsPurchaseTransportContainers' })">
        <FaIcon name="i-lucide:arrow-left" aria-hidden="true" />
        {{ t('workbench.backToContainers') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain>
      <FaEmpty icon="qs-container-management" :title="t('workbench.pending')" class="py-12" />
    </FaPageMain>
  </div>
</template>
