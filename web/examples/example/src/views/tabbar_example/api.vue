<i18n lang="yaml">
zh-cn:
  description: 类似于浏览器的标签栏，并且支持右键操作
  demo1:
    title: 打开新标签页
    intro: 如果目标地址已在标签栏存在，则直接切换并访问。如果目标地址在标签栏不存在，则会在当前标签页后面插入新的标签页。
    button: 打开主页
  demo2:
    title: 关闭当前标签页并跳转
    button: 关闭当前标签页，并跳转到主页
  demo3:
    title: 关闭指定标签页
    intro1: 如果当前只有一个标签时，则无法关闭。
    intro2: 如果关闭的是当前标签页，则会在关闭后跳转至紧邻的标签页。
    intro3: 如果关闭的目标页面不存在，则无法关闭。
    button1: 关闭当前页面
    button2: 关闭主页
  demo4:
    title: 关闭非当前标签页
    intro: 除了提供关闭非当前标签页的 API 外，还提供了校验 API 。
    button1: 关闭两侧标签页
    button2: 关闭左侧标签页
    button3: 关闭右侧标签页
zh-tw:
  description: 類似於瀏覽器的標籤欄，並且支持右鍵操作
  demo1:
    title: 開啟新標籤頁
    intro: 如果目標地址已在標籤欄存在，則直接切換並訪問。如果目標地址在標籤欄不存在，則會在當前標籤頁後面插入新的標籤頁。
    button: 開啟主頁
  demo2:
    title: 關閉當前標籤頁並跳轉
    button: 關閉當前標籤頁，並跳轉到主頁
  demo3:
    title: 關閉指定標籤頁
    intro1: 如果當前只有一個標籤時，則無法關閉。
    intro2: 如果關閉的是當前標籤頁，則會在關閉後跳轉至緊鄰的標籤頁。
    intro3: 如果關閉的目標頁面不存在，則無法關閉。
    button1: 關閉當前頁面
    button2: 關閉主頁
  demo4:
    title: 關閉非當前標籤頁
    intro: 除了提供關閉非當前標籤頁的 API 外，還提供了校驗 API 。
    button1: 關閉兩側標籤頁
    button2: 關閉左側標籤頁
    button3: 關閉右側標籤頁
en:
  description: Similar to the browser tabbar, and supports right-click operations
  demo1:
    title: Open New Tab
    intro: If the target address already exists in the tabbar, it will switch and access directly. If the target address does not exist in the tabbar, a new tab will be inserted behind the current tab.
    button: Open Home Page
  demo2:
    title: Close Current Tab and Redirect
    button: Close Current Tab and Redirect to Home
  demo3:
    title: Close Specified Tab
    intro1: If there is only one tab currently, it cannot be closed.
    intro2: If the current tab is closed, it will jump to the adjacent tab after closing.
    intro3: If the target page to be closed does not exist, it cannot be closed.
    button1: Close Current Page
    button2: Close Home Page
  demo4:
    title: Close Non-Current Tab
    intro: In addition to providing the API for closing non-current tabs, it also provides a validation API.
    button1: Close Both Sides
    button2: Close Left Side
    button3: Close Right Side
</i18n>

<script setup lang="ts">
const { t } = useI18n()

const appSettingsStore = useAppSettingsStore()
const router = useRouter()
const tabbar = useAppTabbar()

function open() {
  router.push(appSettingsStore.settings.app.home.fullPath)
}
function close() {
  router.close(appSettingsStore.settings.app.home.fullPath)
}
function closeById() {
  tabbar.closeById()
}
function closeById2() {
  tabbar.closeById(appSettingsStore.settings.app.home.fullPath)
}
function closeOtherSide() {
  tabbar.closeOtherSide()
}
function closeLeftSide() {
  tabbar.closeLeftSide()
}
function closeRightSide() {
  tabbar.closeRightSide()
}
</script>

<template>
  <div>
    <FaPageHeader :title="t('route.tabbar.root')" :description="t('description')" />
    <FaPageMain :title="t('demo1.title')" main-class="space-y-2">
      <p>{{ t('demo1.intro') }}</p>
      <FaButton @click="open">
        {{ t('demo1.button') }}
      </FaButton>
    </FaPageMain>
    <FaPageMain :title="t('demo2.title')" main-class="space-y-2">
      <FaButton @click="close">
        {{ t('demo2.button') }}
      </FaButton>
    </FaPageMain>
    <FaPageMain :title="t('demo3.title')" main-class="space-y-2">
      <p>{{ t('demo3.intro1') }}</p>
      <p>{{ t('demo3.intro2') }}</p>
      <p>{{ t('demo3.intro3') }}</p>
      <div class="space-x-2">
        <FaButton @click="closeById">
          {{ t('demo3.button1') }}
        </FaButton>
        <FaButton @click="closeById2">
          {{ t('demo3.button2') }}
        </FaButton>
      </div>
    </FaPageMain>
    <FaPageMain :title="t('demo4.title')" main-class="space-y-2">
      <p>{{ t('demo4.intro') }}</p>
      <div class="space-x-2">
        <FaButton :disabled="!tabbar.checkCloseOtherSide()" @click="closeOtherSide">
          {{ t('demo4.button1') }}
        </FaButton>
        <FaButton :disabled="!tabbar.checkCloseLeftSide()" @click="closeLeftSide">
          {{ t('demo4.button2') }}
        </FaButton>
        <FaButton :disabled="!tabbar.checkCloseRightSide()" @click="closeRightSide">
          {{ t('demo4.button3') }}
        </FaButton>
      </div>
    </FaPageMain>
  </div>
</template>
