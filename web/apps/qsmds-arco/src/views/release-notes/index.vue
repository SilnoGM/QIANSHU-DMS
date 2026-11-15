<script setup lang="ts">
import type { ReleaseNotesVersion } from './logic'
import QsReleaseNotesContent from '@/components/business/QsReleaseNotesContent/index.vue'
import {
  countVersionItems,
  fetchReleaseNotesHistory,
  formatReleaseVersion,
  RELEASE_NOTES_REQUEST_TIMEOUT_MS,
  resolveSelectedVersion,
} from './logic'

defineOptions({ name: 'ReleaseNotes' })

const route = useRoute()
const router = useRouter()

const currentVersion = __SYSTEM_INFO__.pkg.version

const versions = ref<ReleaseNotesVersion[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
let requestController: AbortController | null = null

const requestedVersion = computed(() => (typeof route.query.version === 'string' ? route.query.version : null))
const selectedVersion = computed(() => resolveSelectedVersion(versions.value, requestedVersion.value))
const selectedEntry = computed(() => versions.value.find(entry => entry.version === selectedVersion.value) ?? null)
const latestVersion = computed(() => versions.value[0]?.version ?? null)
const selectedItemCount = computed(() => (selectedEntry.value === null ? 0 : countVersionItems(selectedEntry.value.sections)))
const versionRows = computed(() => versions.value.map(entry => ({
  version: entry.version,
  label: formatReleaseVersion(entry.version),
  releasedAt: entry.releasedAt ?? null,
})))
const versionOptions = computed(() => versionRows.value.map(row => ({
  label: row.releasedAt === null ? row.label : `${row.label} · ${row.releasedAt}`,
  value: row.version,
})))

function selectVersion(value: unknown): void {
  if (typeof value !== 'string' || value === selectedVersion.value) {
    return
  }
  void router.replace({ query: { ...route.query, version: value } })
}

async function loadHistory(): Promise<void> {
  requestController?.abort()
  const controller = new AbortController()
  requestController = controller
  const timeout = window.setTimeout(() => controller.abort(), RELEASE_NOTES_REQUEST_TIMEOUT_MS)
  loading.value = true
  error.value = null
  try {
    const history = await fetchReleaseNotesHistory(controller.signal)
    if (controller.signal.aborted) {
      return
    }
    if (history.length === 0) {
      error.value = '发布记录暂时不可用，请稍后重试。'
      return
    }
    versions.value = history
  }
  catch {
    if (!controller.signal.aborted) {
      error.value = '发布记录加载失败，请检查网络后重试。'
    }
  }
  finally {
    window.clearTimeout(timeout)
    if (requestController === controller) {
      loading.value = false
      requestController = null
    }
  }
}

onMounted(loadHistory)

onBeforeUnmount(() => {
  requestController?.abort()
  requestController = null
})
</script>

<template>
  <div data-testid="release-notes-page" class="release-notes-page flex flex-col min-h-0">
    <FaPageHeader
      class="mb-2 shrink-0"
      main-class="min-w-0 flex-1"
      default-class="self-start"
      title="版本更新日志"
      description="按版本查看千树 DMS 的功能变更与问题修复。"
    >
      <div class="flex flex-wrap gap-2 items-center">
        <span class="text-primary qs-type-tag px-2 py-0.5 rounded-md bg-primary/10">
          当前版本 {{ formatReleaseVersion(currentVersion) }}
        </span>
        <span
          v-if="latestVersion !== null && latestVersion !== currentVersion"
          class="text-primary qs-type-tag px-2 py-0.5 border border-primary/35 rounded-md"
        >
          最新版本 {{ formatReleaseVersion(latestVersion) }}
        </span>
        <span v-if="versions.length > 0" class="qs-type-meta">
          共 {{ versions.length }} 个版本
        </span>
      </div>
    </FaPageHeader>

    <FaPageMain class="mt-0 flex-1 min-h-0" main-class="flex flex-col flex-1 min-h-0 h-auto">
      <div class="flex flex-col gap-4 h-full min-h-0 lg:flex-row">
        <div v-if="versions.length > 0" class="shrink-0 lg:hidden">
          <FaSelect
            :model-value="selectedVersion ?? undefined"
            :options="versionOptions"
            placeholder="选择版本"
            class="w-full"
            @change="selectVersion"
          />
        </div>

        <nav
          v-if="versions.length > 0"
          class="shrink-0 min-h-0 hidden lg:w-[188px] lg:block"
          aria-label="版本列表"
        >
          <div class="border rounded-lg h-full relative overflow-hidden">
            <div class="p-1.5 pb-6 overscroll-contain h-full [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <div class="flex flex-col gap-0.5 relative">
                <span class="bg-border w-px start-[16px] bottom-[34px] top-[16px] absolute z-0" aria-hidden="true" />
                <button
                  v-for="row in versionRows"
                  :key="row.version"
                  type="button"
                  class="group text-start border-0 bg-transparent flex gap-2 w-full transition-colors"
                  :class="row.version === selectedVersion ? 'text-primary' : 'text-foreground'"
                  :aria-current="row.version === selectedVersion ? 'true' : undefined"
                  @click="selectVersion(row.version)"
                >
                  <span class="ms-2 mt-3 flex shrink-0 w-4 justify-center" aria-hidden="true">
                    <span
                      class="border rounded-full size-2 ring-2 ring-card transition-colors relative z-1"
                      :class="row.version === selectedVersion
                        ? 'bg-primary border-primary'
                        : 'bg-card border-muted-foreground/40'"
                    />
                  </span>
                  <span
                    class="px-2 py-1.5 rounded-md flex-1 min-w-0 transition-colors"
                    :class="row.version === selectedVersion ? 'bg-primary/10' : 'group-hover:bg-muted'"
                  >
                    <span class="flex gap-1.5 items-center">
                      <span class="font-qs-data-mono text-sm font-medium">
                        {{ row.label }}
                      </span>
                      <span
                        v-if="row.version === latestVersion"
                        class="text-[11px] text-primary-foreground leading-4 font-medium px-1.5 rounded bg-primary"
                      >
                        最新版本
                      </span>
                    </span>
                    <span
                      v-if="row.releasedAt !== null"
                      class="qs-type-meta mt-0.5 block tabular-nums"
                    >
                      {{ row.releasedAt }}
                    </span>
                  </span>
                </button>
              </div>
            </div>
            <span class="release-notes-fade h-6 pointer-events-none inset-b-0 absolute" aria-hidden="true" />
          </div>
        </nav>

        <div class="flex flex-1 flex-col min-h-0 min-w-0">
          <div v-if="loading" class="flex flex-col gap-3" aria-busy="true">
            <span class="sr-only">正在加载发布记录</span>
            <div class="rounded-lg bg-muted/40 h-16 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
            <div class="rounded-lg bg-muted/40 h-48 animate-pulse motion-reduce:animate-none" aria-hidden="true" />
          </div>

          <FaAlert
            v-else-if="error !== null"
            data-testid="release-notes-error"
            variant="destructive"
            icon="i-lucide:circle-alert"
            title="版本记录加载失败"
          >
            <template #description>
              <div class="flex flex-wrap gap-2 items-center">
                <span>{{ error }}</span>
                <FaButton variant="outline" size="sm" @click="loadHistory">
                  重试
                </FaButton>
              </div>
            </template>
          </FaAlert>

          <FaEmpty
            v-else-if="selectedEntry === null"
            icon="i-lucide:history"
            title="暂无发布记录"
            description="还没有可展示的版本更新内容。"
            class="min-h-64"
          />

          <article v-else data-testid="release-notes-detail" class="border rounded-lg bg-background flex flex-1 flex-col min-h-0 overflow-hidden">
            <header class="px-4 py-3 border-b flex shrink-0 flex-wrap gap-2 items-center">
              <h2 class="font-qs-data-mono text-lg font-semibold m-0">
                {{ formatReleaseVersion(selectedEntry.version) }}
              </h2>
              <span
                v-if="selectedEntry.version === latestVersion"
                class="text-[11px] text-primary-foreground leading-4 font-medium px-1.5 rounded bg-primary"
              >
                最新版本
              </span>
              <span class="text-xs text-muted-foreground ms-auto px-2 py-0.5 rounded-md bg-muted inline-flex gap-1 items-center">
                <span v-if="selectedEntry.releasedAt !== undefined" class="tabular-nums">
                  {{ selectedEntry.releasedAt }} ·
                </span>
                <span>
                  <span class="text-primary font-semibold tabular-nums">{{ selectedItemCount }}</span>
                  项更新
                </span>
              </span>
            </header>
            <div class="p-4 overscroll-contain flex-1 min-h-0 [scrollbar-width:none] overflow-y-auto [&::-webkit-scrollbar]:hidden">
              <QsReleaseNotesContent :sections="selectedEntry.sections" />
            </div>
          </article>
        </div>
      </div>
    </FaPageMain>
  </div>
</template>

<style scoped>
/*
 * 页面固定在视口剩余高度内：顶部固定区与底部插槽的高度都由布局变量给出，
 * 扣掉后 FaPageMain 才能作为内滚容器使用，让左右两栏各自滚动而不是整页滚动。
 */
.release-notes-page {
  height: calc(100dvh - var(--g-slots-layout-top-height, 0px) - var(--g-header-actual-height, 0px) - var(--g-topbar-actual-height, 0px) - var(--g-main-container-padding-top, 0px) - var(--g-slots-layout-bottom-height, 0px) - var(--g-main-container-padding-bottom, 0px));
}

/* 列表底部的柔和渐隐，避免滚动中的半截文字直接撞在圆角边框上。 */
.release-notes-fade {
  background: linear-gradient(to top, oklch(var(--card)), transparent);
}
</style>
