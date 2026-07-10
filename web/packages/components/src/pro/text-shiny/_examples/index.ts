import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Color from './_color.vue'
import ColorRaw from './_color.vue?raw'
import SpeedDelay from './_speed-delay.vue'
import SpeedDelayRaw from './_speed-delay.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '颜色',
    component: Color,
    componentRaw: ColorRaw,
  },
  {
    title: '速度与延迟',
    component: SpeedDelay,
    componentRaw: SpeedDelayRaw,
  },
]
