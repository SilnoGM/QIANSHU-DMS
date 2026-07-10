import Advanced from './_advanced.vue'
import AdvancedRaw from './_advanced.vue?raw'
import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Pause from './_pause.vue'
import PauseRaw from './_pause.vue?raw'
import Reverse from './_reverse.vue'
import ReverseRaw from './_reverse.vue?raw'
import SpeedGap from './_speed-gap.vue'
import SpeedGapRaw from './_speed-gap.vue?raw'
import Vertical from './_vertical.vue'
import VerticalRaw from './_vertical.vue?raw'

export default [
  {
    title: '基础',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '反向',
    component: Reverse,
    componentRaw: ReverseRaw,
  },
  {
    title: '悬停暂停',
    component: Pause,
    componentRaw: PauseRaw,
  },
  {
    title: '速度、间隔',
    component: SpeedGap,
    componentRaw: SpeedGapRaw,
  },
  {
    title: '垂直',
    component: Vertical,
    componentRaw: VerticalRaw,
  },
  {
    title: '高级用法',
    component: Advanced,
    componentRaw: AdvancedRaw,
  },
]
