<script setup lang="ts">
import type { GitGraphCommit } from '@/types/development-map'
import { commitTypeLabel } from '@/types/commit-types'
import {
  commitDotColor,
  commitToneClass,
  drawGraphRow,
  gitGraphNodeRadius,
  gitGraphRowHeight,
  laneColor,
} from './git-graph.logic'

defineOptions({
  name: 'GitGraphRow',
})

const props = defineProps<{
  commit: GitGraphCommit
  /** 行上边沿需要绘制的泳道；完整图谱下等于上一行的 lanes。 */
  topLanes: number[]
  maxLane: number
  /** 筛选视图：不绘制跨行连线，用类型圆点表示。 */
  railMode: boolean
}>()

const drawing = computed(() => drawGraphRow(props.commit, props.topLanes, props.maxLane))
const railColor = computed(() => commitDotColor(props.commit.type))
const centerY = gitGraphRowHeight / 2
</script>

<template>
  <div class="text-sm flex gap-3 items-center" :style="{ height: `${gitGraphRowHeight}px` }">
    <svg
      v-if="!railMode"
      :width="drawing.width"
      :height="gitGraphRowHeight"
      class="shrink-0"
      aria-hidden="true"
    >
      <path
        v-for="segment in drawing.segments"
        :key="segment.key"
        :d="segment.path"
        :stroke="segment.color"
        stroke-width="1.6"
        fill="none"
      />
      <circle :cx="drawing.nodeX" :cy="drawing.nodeY" :r="gitGraphNodeRadius" :fill="drawing.nodeColor" />
    </svg>
    <svg v-else width="16" :height="gitGraphRowHeight" class="shrink-0" aria-hidden="true">
      <path :d="`M 8 0 V ${gitGraphRowHeight}`" :stroke="laneColor(0)" stroke-width="1.2" stroke-opacity="0.35" fill="none" />
      <circle cx="8" :cy="centerY" :r="gitGraphNodeRadius" :fill="railColor" />
    </svg>

    <span class="text-xs text-muted-foreground font-sans shrink-0 w-18 hidden md:inline-block">{{ commit.sha }}</span>
    <span class="text-xs shrink-0 w-16" :class="commitToneClass(commit.type)">{{ commitTypeLabel(commit.type) }}</span>
    <span class="flex-1 truncate" :title="commit.subject">{{ commit.subject }}</span>
    <FaTag v-for="ref in commit.refs" :key="ref" variant="secondary" class="shrink-0">
      {{ ref }}
    </FaTag>
    <span class="text-xs text-muted-foreground text-right shrink-0 w-20 hidden lg:inline-block">{{ commit.date }}</span>
  </div>
</template>
