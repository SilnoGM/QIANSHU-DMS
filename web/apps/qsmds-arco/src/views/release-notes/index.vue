<script setup lang="ts">
import type { ReleaseNotesVersion } from './logic'
import QsReleaseNotesContent from '@/components/business/QsReleaseNotesContent/index.vue'
import {
  collectVersionRoles,
  countVersionItems,
  fetchReleaseNotesHistory,
  formatReleaseVersion,
  RELEASE_NOTES_REQUEST_TIMEOUT_MS,
  resolveSelectedVersion,
  summarizeVersionSections,
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
  summary: summarizeVersionSections(entry.sections),
  roles: collectVersionRoles(entry.sections),
})))
const versionOptions = computed(() => versionRows.value.map(row => ({
  label: row.label,
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
  <div data-testid="release-notes-page" class="flex flex-col min-h-0">
    <FaPageHeader
      class="mb-2"
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

    <FaPageMain class="mt-0">
      <div class="flex flex-col gap-4 lg:flex-row">
        <div v-if="versions.length > 0" class="lg:hidden">
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
          class="shrink-0 hidden lg:w-[212px] lg:block"
          aria-label="版本列表"
        >
          <div class="p-1.5 border rounded-lg flex flex-col gap-0.5 max-h-[70vh] overflow-y-auto">
            <button
              v-for="row in versionRows"
              :key="row.version"
              type="button"
              class="px-2 py-1.5 text-start border-0 rounded-md bg-transparent transition-colors hover-bg-muted"
              :class="row.version === selectedVersion
                ? 'bg-primary/10 text-primary'
                : 'text-foreground'"
              :aria-current="row.version === selectedVersion ? 'true' : undefined"
              @click="selectVersion(row.version)"
            >
              <span class="flex gap-1.5 items-center">
                <span class="font-qs-data-mono text-sm font-medium">
                  {{ row.label }}
                </span>
                <span
                  v-if="row.version === currentVersion"
                  class="text-primary qs-type-tag px-1 rounded bg-primary/10"
                >
                  当前
                </span>
              </span>
              <span class="qs-type-meta mt-0.5 block truncate">
                {{ row.summary }}
              </span>
              <span v-if="row.roles.length > 0" class="qs-type-meta mt-0.5 block truncate">
                {{ row.roles.join('、') }}
              </span>
            </button>
          </div>
        </nav>

        <div class="flex-1 min-w-0">
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

          <article v-else data-testid="release-notes-detail" class="border rounded-lg bg-background">
            <header class="px-4 py-3 border-b flex flex-wrap gap-2 items-center">
              <h2 class="font-qs-data-mono text-lg font-semibold m-0">
                {{ formatReleaseVersion(selectedEntry.version) }}
              </h2>
              <FaTag v-if="selectedEntry.version === currentVersion" variant="secondary" class="qs-type-tag">
                当前版本
              </FaTag>
              <FaTag
                v-else-if="selectedEntry.version === latestVersion"
                variant="outline"
                class="qs-type-tag"
              >
                最新版本
              </FaTag>
              <span class="qs-type-meta ms-auto">{{ selectedItemCount }} 项更新</span>
            </header>
            <div class="p-4">
              <QsReleaseNotesContent :sections="selectedEntry.sections" />
            </div>
          </article>
        </div>
      </div>
    </FaPageMain>
  </div>
</template>
