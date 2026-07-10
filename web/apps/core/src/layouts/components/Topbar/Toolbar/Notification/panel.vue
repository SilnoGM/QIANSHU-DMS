<script setup lang="ts">
defineOptions({
  name: 'ToolbarNotificationPanel',
})

const { t } = useI18n()

const appNotificationStore = useAppNotificationStore()

const activeName = ref(appNotificationStore.types[0].name)

function handleClick(item: any) {
  appNotificationStore.setRead(activeName.value, item.id)
  useFaToast().info(t('app.layouts.topbar.toolbar.notification.todo'))
}

function handleViewAll() {
  useFaToast().info(t('app.layouts.topbar.toolbar.notification.todo'))
}
</script>

<template>
  <div class="flex flex-col h-80 w-xs">
    <div class="flex flex-1 overflow-hidden">
      <div class="border-e">
        <FaScrollArea v-if="appNotificationStore.types.length > 1" :scrollbar="false" mask class="size-full">
          <div class="p-2 flex-col-center-start gap-2">
            <div v-for="(item, index) in appNotificationStore.types" :key="index" class="group/item text-secondary-foreground p-2 rounded-lg flex-center cursor-pointer transition-all" :class="{ 'bg-secondary': activeName === item.name }" @click="activeName = item.name">
              <FaBadge :value="item.unRead > 9 ? true : item.unRead" variant="destructive" badge-class="scale-80">
                <FaIcon :name="item.icon" class="op-50 size-5 transition-all group-hover/item:op-100" :class="{ 'op-100!': activeName === item.name }" />
              </FaBadge>
            </div>
          </div>
        </FaScrollArea>
      </div>
      <div class="p-2 flex-center flex-1">
        <FaScrollArea v-if="appNotificationStore.list[activeName].length > 0" :scrollbar="false" mask class="overscroll-contain size-full">
          <div v-for="(item, index) in appNotificationStore.list[activeName]" :key="index" class="p-3 rounded-lg cursor-pointer transition-background-color hover-bg-muted" @click="handleClick(item)">
            <div class="flex-col-start gap-1" :class="{ 'op-50': item.read }">
              <div class="text-sm line-clamp-2">
                {{ item.title }}
              </div>
              <div class="text-xs text-secondary-foreground/50">
                {{ item.datetime }}
              </div>
            </div>
          </div>
        </FaScrollArea>
        <div v-else class="flex-center flex-1">
          <div class="text-secondary-foreground/50">
            {{ t('app.layouts.topbar.toolbar.notification.empty') }}
          </div>
        </div>
      </div>
    </div>
    <div class="p-1 border-t flex-center-between flex-shrink-0">
      <FaButton variant="ghost" size="sm" class="text-xs text-secondary-foreground/50 hover:bg-transparent" @click="appNotificationStore.setAllRead(activeName)">
        {{ t('app.layouts.topbar.toolbar.notification.markAsRead') }}
      </FaButton>
      <FaButton variant="ghost" size="sm" class="text-xs text-secondary-foreground/50 hover:bg-transparent" @click="handleViewAll">
        {{ t('app.layouts.topbar.toolbar.notification.viewAll') }}
      </FaButton>
    </div>
  </div>
</template>
