<script setup lang="ts">
import type { GitGraphCommit, GitGraphVersion } from '@/types/development-map'
import { useVirtualList } from '@vueuse/core'
import GitGraphRow from './git-graph-row.vue'
import {
  filterGraphCommits,
  gitGraphRowHeight,
  gitGraphViewportClass,
  isGraphFilterActive,
  laneColor,
  typeFilterOptions,
  versionFilterOptions,
} from './git-graph.logic'

defineOptions({
  name: 'GitGraphPanel',
})

const props = defineProps<{
  commits: GitGraphCommit[]
  versions: GitGraphVersion[]
  maxLane: number
}>()

const allVersionsValue = 'ALL'
const allTypesValue = 'ALL'

const route = useRoute()
// 版本更新页通过 ?version=vX.Y.Z 跳进来时预置版本筛选，仍由用户自行切换。
const requestedVersion = typeof route.query.version === 'string' ? route.query.version : null
const versionValue = ref<string>(
  requestedVersion && props.versions.some(version => version.tag === requestedVersion)
    ? requestedVersion
    : allVersionsValue,
)
const typeValue = ref<string>(allTypesValue)
const keyword = ref('')

const filters = computed(() => ({
  version: versionValue.value === allVersionsValue ? null : versionValue.value,
  type: typeValue.value === allTypesValue ? null : typeValue.value,
  keyword: keyword.value,
}))

const visibleCommits = computed(() => filterGraphCommits(props.commits, props.versions, filters.value))
const railMode = computed(() => isGraphFilterActive(filters.value))
const versionOptions = computed(() => [
  { label: `全部版本（${props.commits.length} 条）`, value: allVersionsValue },
  ...versionFilterOptions(props.versions),
])
const typeOptions = computed(() => [
  { label: '全部类型', value: allTypesValue },
  ...typeFilterOptions(props.commits),
])
const topLanesByIndex = computed(() => props.commits.map((_, index) => (
  index === 0 ? [] : props.commits[index - 1]?.lanes ?? []
)))

const { list, containerProps, wrapperProps } = useVirtualList(visibleCommits, {
  itemHeight: gitGraphRowHeight,
  overscan: 12,
})

const summary = computed(() => railMode.value
  ? `筛选后 ${visibleCommits.value.length} 条提交；筛选视图只列提交，不绘制跨行连线`
  : `共 ${props.commits.length} 条提交 · ${props.versions.length} 个发版`)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap gap-3 items-center">
      <FaSelect v-model="versionValue" :options="versionOptions" class="w-60" />
      <FaSelect v-model="typeValue" :options="typeOptions" class="w-44" />
      <FaInput v-model="keyword" placeholder="搜索提交信息或短哈希" class="w-64" />
    </div>

    <FaEmpty v-if="visibleCommits.length === 0" description="没有符合筛选条件的提交" />
    <template v-else>
      <div
        v-bind="containerProps"
        class="p-2 border border-border rounded-lg bg-card overflow-auto" :class="[gitGraphViewportClass]"
      >
        <div v-bind="wrapperProps">
          <GitGraphRow
            v-for="item in list"
            :key="item.data.sha"
            :commit="item.data"
            :top-lanes="railMode ? [] : topLanesByIndex[item.index] ?? []"
            :max-lane="maxLane"
            :rail-mode="railMode"
          />
        </div>
      </div>
      <div class="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 items-center">
        <span>{{ summary }}</span>
        <span v-if="!railMode" class="flex flex-wrap gap-x-4 gap-y-1 items-center">
          <span class="flex gap-1.5 items-center">
            <span class="rounded-full size-2 inline-block" :style="{ backgroundColor: laneColor(0) }" />
            主干
          </span>
          <span v-for="index in Math.max(maxLane, 1)" :key="index" class="flex gap-1.5 items-center">
            <span class="rounded-full size-2 inline-block" :style="{ backgroundColor: laneColor(index) }" />
            分支 {{ index }}
          </span>
        </span>
      </div>
    </template>
  </div>
</template>
