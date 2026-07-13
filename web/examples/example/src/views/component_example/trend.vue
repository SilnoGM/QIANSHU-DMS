<script setup lang="ts">
import { trend as trendExamples } from '@fantastic-admin/components/examples'

const { t } = useI18n()
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.component.trend')">
      <template #description>
        <div class="space-y-2">
          <p>FaTrend</p>
          <p>标记上升和下降趋势。通常用绿色代表“好”，红色代表“不好”，股票涨跌场景除外</p>
        </div>
      </template>
    </FaPageHeader>
    <FaCodePreview
      v-for="example in trendExamples"
      :key="example.title"
      :code="example.componentRaw"
      :title="example.title"
    >
      <component :is="example.component" />
    </FaCodePreview>
  </div>
</template>
