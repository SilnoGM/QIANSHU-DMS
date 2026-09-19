<script setup lang="ts">
import { useQsToast } from '@/components/base/QsToast/useQsToast'

defineOptions({ name: 'QsPurchaseTransportContainers' })

const { t } = useI18n()
const toast = useQsToast()
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.containers')" :description="t('workbench.containersDescription')">
      <FaButton @click="toast.info(t('workbench.createContainerPending'))">
        <FaIcon name="i-lucide:plus" aria-hidden="true" />
        {{ t('workbench.createContainer') }}
      </FaButton>
    </FaPageHeader>
  </div>
</template>
