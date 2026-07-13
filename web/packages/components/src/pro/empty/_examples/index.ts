import Background from './_background.vue'
import BackgroundRaw from './_background.vue?raw'
import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Border from './_border.vue'
import BorderRaw from './_border.vue?raw'
import Slot from './_slot.vue'
import SlotRaw from './_slot.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '边框',
    component: Border,
    componentRaw: BorderRaw,
  },
  {
    title: '背景',
    component: Background,
    componentRaw: BackgroundRaw,
  },
  {
    title: '插槽',
    component: Slot,
    componentRaw: SlotRaw,
  },
]
