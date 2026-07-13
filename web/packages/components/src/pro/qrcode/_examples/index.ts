import Basic from './_basic.vue'
import BasicRaw from './_basic.vue?raw'
import Color from './_color.vue'
import ColorRaw from './_color.vue?raw'
import ErrorCorrection from './_error-correction.vue'
import ErrorCorrectionRaw from './_error-correction.vue?raw'
import Interactive from './_interactive.vue'
import InteractiveRaw from './_interactive.vue?raw'
import Size from './_size.vue'
import SizeRaw from './_size.vue?raw'
import Status from './_status.vue'
import StatusRaw from './_status.vue?raw'

export default [
  {
    title: '基础用法',
    component: Basic,
    componentRaw: BasicRaw,
  },
  {
    title: '交互式操作',
    component: Interactive,
    componentRaw: InteractiveRaw,
  },
  {
    title: '纠错等级',
    component: ErrorCorrection,
    componentRaw: ErrorCorrectionRaw,
  },
  {
    title: '尺寸设置',
    component: Size,
    componentRaw: SizeRaw,
  },
  {
    title: '颜色定制',
    component: Color,
    componentRaw: ColorRaw,
  },
  {
    title: '状态展示',
    component: Status,
    componentRaw: StatusRaw,
  },
]
