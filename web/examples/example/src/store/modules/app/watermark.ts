import type { WatermarkOptions } from 'watermark-js-plus'
import { Watermark } from 'watermark-js-plus'

export const useAppWatermarkStore = defineStore(
  'appWatermark',
  () => {
    const appSettingsStore = useAppSettingsStore()
    const appAccountStore = useAppAccountStore()

    const customSettings = ref<Partial<WatermarkOptions>>()
    const settings = computed({
      get() {
        return Object.assign(
          {
            contentType: 'multi-line-text',
            content: `Fantastic-admin\nUser: ${appAccountStore.account}`,
            fontColor: appSettingsStore.currentColorScheme === 'light' ? '#000' : '#fff',
            globalAlpha: 0.1,
            width: 200,
            height: 200,
            // layout: 'grid',
            // gridLayoutOptions: {
            //   rows: 2,
            //   cols: 2,
            //   gap: [10, 10],
            //   matrix: [[1, 0], [0, 1]],
            // },
          } as Partial<WatermarkOptions>,
          customSettings.value,
        )
      },
      set(val) {
        update(val)
      },
    })

    const watermark = new Watermark(settings.value)

    watch(settings, async () => {
      if (appSettingsStore.settings.app.watermark && await watermark.check()) {
        watermark.changeOptions(settings.value)
      }
    }, {
      deep: true,
    })

    watch(() => appSettingsStore.settings.app.watermark, (val) => {
      if (val) {
        watermark.create()
      }
      else {
        watermark.destroy()
      }
    }, {
      immediate: true,
    })

    watch(() => appSettingsStore.currentColorScheme, async () => {
      if (appSettingsStore.settings.app.watermark && await watermark.check()) {
        await nextTick()
        watermark.changeOptions(settings.value)
      }
    })

    // 更新水印设置
    function update(config: Partial<WatermarkOptions> = {}) {
      customSettings.value = config
    }

    return {
      update,
    }
  },
)
