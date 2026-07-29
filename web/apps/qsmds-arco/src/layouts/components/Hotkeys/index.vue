<script setup lang="ts">
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { hotkeyBindings } from '@/hotkeys'
import eventBus from '@/utils/eventBus'

defineOptions({
  name: 'HotkeysIntro',
})

const { t } = useI18n()
const appSettingsStore = useAppSettingsStore()
const hotkeyContext = {
  settings: appSettingsStore.settings,
}

const isShow = ref(false)

const helpGroupMeta = {
  global: { titleKey: 'app.layouts.hotkeys.global.root', order: 10 },
  nav: { titleKey: 'app.layouts.hotkeys.nav.root', order: 20 },
  tabbar: { titleKey: 'app.layouts.hotkeys.tabbar.root', order: 30 },
  page: { titleKey: 'app.layouts.hotkeys.page.root', order: 40 },
} as const

const helpGroups = computed(() => {
  const groups = new Map<string, {
    id: string
    titleKey: string
    order: number
    items: {
      id: string
      titleKey: string
      order: number
      displayKeys: string[]
    }[]
  }>()

  hotkeyBindings.forEach((binding) => {
    const help = binding.help
    if (!help) {
      return
    }
    if (help.visible && !help.visible(hotkeyContext)) {
      return
    }

    const meta = helpGroupMeta[help.group as keyof typeof helpGroupMeta]
    const group = groups.get(help.group) ?? {
      id: help.group,
      titleKey: help.groupTitleKey ?? meta?.titleKey ?? help.group,
      order: meta?.order ?? 100,
      items: [],
    }

    group.items.push({
      id: binding.id,
      titleKey: help.titleKey,
      order: help.order ?? 0,
      displayKeys: appSettingsStore.os === 'mac' && help.displayKeys.mac
        ? help.displayKeys.mac
        : help.displayKeys.default,
    })
    groups.set(help.group, group)
  })

  return Array.from(groups.values())
    .map(group => ({
      ...group,
      items: [...group.items].sort((a, b) => a.order - b.order),
    }))
    .sort((a, b) => a.order - b.order)
})

onMounted(() => {
  eventBus.on('global-hotkeys-intro-toggle', () => {
    isShow.value = !isShow.value
  })
})

onUnmounted(() => {
  eventBus.off('global-hotkeys-intro-toggle')
})
</script>

<template>
  <QsGenericModal
    v-model="isShow"
    :title="t('app.layouts.hotkeys.title')"
    size="md"
  >
    <div>
      <div class="gap-4 grid sm-grid-cols-2">
        <div v-for="group in helpGroups" :key="group.id">
          <h2 class="text-lg font-bold m-0">
            {{ t(group.titleKey) }}
          </h2>
          <ul class="text-sm ps-2 pt-2 list-none">
            <li v-for="item in group.items" :key="item.id" class="py-1 flex-baseline gap-2">
              <FaKbdGroup>
                <FaKbd v-for="key in item.displayKeys" :key="key">
                  {{ key }}
                </FaKbd>
              </FaKbdGroup>
              {{ t(item.titleKey) }}
            </li>
          </ul>
        </div>
      </div>
    </div>
  </QsGenericModal>
</template>
