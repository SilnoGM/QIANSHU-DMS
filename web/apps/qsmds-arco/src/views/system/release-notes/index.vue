<script setup lang="ts">
import type { ReleaseNotesRelease } from '@/types/development-map'
import releaseNotes from 'virtual:qianshu/release-notes'
import { describeDevelopmentDataSource } from '../shared/development-data-source'
import ReleaseNotesCard from './release-notes-card.vue'
import { graphRouteFor, releaseCardSubtitle } from './release-notes.logic'

defineOptions({
  name: 'SystemReleaseNotes',
})

const router = useRouter()

const notice = computed(() => describeDevelopmentDataSource(releaseNotes.source))
const latestTag = computed(() => releaseNotes.releases[0]?.tag ?? null)

/**
 * FaTimeline 经组件解析器注册后泛型参数不会随 `:data` 特化，插槽参数只能拿到
 * `{ datetime }` 约束。这里集中还原成发版数据的完整类型，避免把断言散落到模板里。
 */
function releaseCardProps(item: { datetime: string | number | Date }) {
  const release = item as ReleaseNotesRelease
  return {
    title: release.tag,
    subtitle: releaseCardSubtitle(release),
    badge: release.tag === latestTag.value ? '最新' : null,
    groups: release.groups,
    graphTag: release.tag,
  }
}

function openGraph(tag: string | null) {
  router.push(graphRouteFor(tag))
}
</script>

<template>
  <FaPageHeader title="版本更新" description="按发版时间倒序的更新历史；数据在构建时从 Git Tag 生成，运行时不访问 Git">
    <template #extra>
      <FaButton variant="outline" @click="openGraph(latestTag)">
        查看开发图谱
      </FaButton>
    </template>
  </FaPageHeader>
  <FaPageMain>
    <FaAlert
      v-if="notice"
      :variant="notice.variant"
      :icon="notice.icon"
      :title="notice.title"
      :description="notice.description"
      class="mb-4"
    />

    <div v-if="releaseNotes.unreleased" class="mb-6">
      <div class="p-3 border border-border rounded-lg border-dashed">
        <ReleaseNotesCard
          title="未发版"
          :subtitle="`本地开发构建的 ${releaseNotes.unreleased.commitCount} 条提交 | 下一次发版会连同这些内容一起计入`"
          badge="本地"
          :groups="releaseNotes.unreleased.groups"
          :graph-tag="null"
          @open-graph="openGraph"
        />
      </div>
    </div>

    <FaEmpty
      v-if="releaseNotes.releases.length === 0"
      description="没有可展示的发版记录"
    />
    <div v-else class="h-[calc(100vh-20rem)] min-h-80">
      <FaTimeline :data="releaseNotes.releases">
        <template #default="{ item }">
          <ReleaseNotesCard v-bind="releaseCardProps(item)" @open-graph="openGraph" />
        </template>
      </FaTimeline>
    </div>
  </FaPageMain>
</template>
