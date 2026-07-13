import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Border from './_border.vue'
import BorderRaw from './_border.vue?raw'
import Color from './_color.vue'
import ColorRaw from './_color.vue?raw'
import Speed from './_speed.vue'
import SpeedRaw from './_speed.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '速度',
    component: Speed,
    componentRaw: SpeedRaw,
  },
  {
    title: '颜色',
    component: Color,
    componentRaw: ColorRaw,
  },
  {
    title: '边框',
    component: Border,
    componentRaw: BorderRaw,
  },
]
