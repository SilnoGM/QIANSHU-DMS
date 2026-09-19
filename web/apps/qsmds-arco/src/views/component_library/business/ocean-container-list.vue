<script setup lang="ts">
import OceanContainerListShowcase from './components/OceanContainerListShowcase.vue'

defineOptions({ name: 'ComponentLibraryQsOceanContainerList' })
</script>

<template>
  <div>
    <FaPageHeader description="面向运营与销售的柜次卡片：查看整柜概览，展开本人销售订单关联的装柜明细。">
      <template #title>
        <div class="flex gap-3 items-center">
          <span class="text-primary border border-primary/20 rounded-lg bg-primary/8 flex-center size-9">
            <FaIcon name="qs-ocean-containers" class="size-5" />
          </span>
          <span>海运柜次卡片</span>
        </div>
      </template>
      <FaTag variant="secondary">
        内部开发工作台
      </FaTag>
    </FaPageHeader>
    <FaPageMain>
      <OceanContainerListShowcase />
    </FaPageMain>
  </div>
</template>
