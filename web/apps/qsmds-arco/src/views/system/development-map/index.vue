<script setup lang="ts">
import developmentMap from 'virtual:qianshu/development-map'
import { describeDevelopmentDataSource } from '../shared/development-data-source'
import GitGraphPanel from './git-graph.vue'

defineOptions({
  name: 'SystemDevelopmentMap',
})

const notice = computed(() => describeDevelopmentDataSource(developmentMap.source))
const commitCount = computed(() => developmentMap.graph.commits.length)
const dataAnchor = computed(() => developmentMap.source.tag ?? developmentMap.source.shortCommit)
</script>

<template>
  <FaPageHeader title="开发图谱" description="截止本次构建的 Git 提交线路图；数据在构建时生成，运行时不访问 Git" />
  <FaPageMain>
    <FaAlert
      v-if="notice"
      :variant="notice.variant"
      :icon="notice.icon"
      :title="notice.title"
      :description="notice.description"
      class="mb-4"
    />

    <div class="flex flex-col gap-3">
      <div class="flex flex-wrap gap-x-3 gap-y-1 items-baseline">
        <h2 class="text-base font-bold">
          Git 提交线路图
        </h2>
        <span v-if="dataAnchor" class="text-sm text-muted-foreground">
          数据截至 {{ dataAnchor }}
        </span>
      </div>
      <GitGraphPanel
        v-if="commitCount > 0"
        :commits="developmentMap.graph.commits"
        :versions="developmentMap.graph.versions"
        :max-lane="developmentMap.graph.maxLane"
      />
      <FaEmpty v-else description="构建环境未提供 Git 历史，无法绘制线路图" />
    </div>
  </FaPageMain>
</template>
