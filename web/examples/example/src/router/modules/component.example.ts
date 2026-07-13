import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/component_example',
  component: Layout,
  name: 'componentExample',
  meta: {
    title: $t('route.component.root'),
    icon: 'i-bx:bxs-component',
  },
  children: [
    {
      path: 'alert',
      name: 'componentExampleAlert',
      component: () => import('@/views/component_example/alert.vue'),
      meta: {
        title: $t('route.component.alert'),
      },
    },
    {
      path: 'avatar',
      name: 'componentExampleAvatar',
      component: () => import('@/views/component_example/avatar.vue'),
      meta: {
        title: $t('route.component.avatar'),
      },
    },
    {
      path: 'badge',
      name: 'componentExampleBadge',
      component: () => import('@/views/component_example/badge.vue'),
      meta: {
        title: $t('route.component.badge'),
      },
    },
    {
      path: 'button',
      name: 'componentExampleButton',
      component: () => import('@/views/component_example/button.vue'),
      meta: {
        title: $t('route.component.button'),
      },
    },
    {
      path: 'card',
      name: 'componentExampleCard',
      component: () => import('@/views/component_example/card.vue'),
      meta: {
        title: $t('route.component.card'),
      },
    },
    {
      path: 'checkbox',
      name: 'componentExampleCheckbox',
      component: () => import('@/views/component_example/checkbox.vue'),
      meta: {
        title: $t('route.component.checkbox'),
      },
    },
    {
      path: 'collapsible',
      name: 'componentExampleCollapsible',
      component: () => import('@/views/component_example/collapsible.vue'),
      meta: {
        title: $t('route.component.collapsible'),
      },
    },
    {
      path: 'context_menu',
      name: 'componentExampleContextMenu',
      component: () => import('@/views/component_example/context_menu.vue'),
      meta: {
        title: $t('route.component.contextMenu'),
      },
    },
    {
      path: 'descriptions',
      name: 'componentExampleDescriptions',
      component: () => import('@/views/component_example/descriptions.vue'),
      meta: {
        title: $t('route.component.descriptions'),
      },
    },
    {
      path: 'divider',
      name: 'componentExampleDivider',
      component: () => import('@/views/component_example/divider.vue'),
      meta: {
        title: $t('route.component.divider'),
      },
    },
    {
      path: 'drawer',
      name: 'componentExampleDrawer',
      component: () => import('@/views/component_example/drawer.vue'),
      meta: {
        title: $t('route.component.drawer'),
      },
    },
    {
      path: 'dropdown',
      name: 'componentExampleDropdown',
      component: () => import('@/views/component_example/dropdown.vue'),
      meta: {
        title: $t('route.component.dropdown'),
      },
    },
    {
      path: 'file_upload',
      name: 'componentExampleFileUpload',
      component: () => import('@/views/component_example/file_upload.vue'),
      meta: {
        title: $t('route.component.fileUpload'),
      },
    },
    {
      path: 'fixed_bar',
      name: 'componentExampleFixedactionbar',
      component: () => import('@/views/component_example/fixed_bar.vue'),
      meta: {
        title: $t('route.component.fixedBar'),
        copyright: false,
      },
    },
    {
      path: 'form',
      name: 'componentExampleForm',
      component: () => import('@/views/component_example/form.vue'),
      meta: {
        title: $t('route.component.form'),
      },
    },
    {
      path: 'hover_card',
      name: 'componentExampleHoverCard',
      component: () => import('@/views/component_example/hover_card.vue'),
      meta: {
        title: $t('route.component.hoverCard'),
      },
    },
    {
      path: 'icon',
      name: 'componentExampleIcon',
      component: () => import('@/views/component_example/icon.vue'),
      meta: {
        title: $t('route.component.icon'),
      },
    },
    {
      path: 'image_preview',
      name: 'componentExampleImagePreview',
      component: () => import('@/views/component_example/image_preview.vue'),
      meta: {
        title: $t('route.component.imagePreview'),
      },
    },
    {
      path: 'image_upload',
      name: 'componentExampleImageUpload',
      component: () => import('@/views/component_example/image_upload.vue'),
      meta: {
        title: $t('route.component.imageUpload'),
      },
    },
    {
      path: 'input',
      name: 'componentExampleInput',
      component: () => import('@/views/component_example/input.vue'),
      meta: {
        title: $t('route.component.input'),
      },
    },
    {
      path: 'input_otp',
      name: 'componentExampleInputOtp',
      component: () => import('@/views/component_example/input_otp.vue'),
      meta: {
        title: $t('route.component.inputOtp'),
      },
    },
    {
      path: 'kbd',
      name: 'componentExampleKbd',
      component: () => import('@/views/component_example/kbd.vue'),
      meta: {
        title: $t('route.component.kbd'),
      },
    },
    {
      path: 'label',
      name: 'componentExampleLabel',
      component: () => import('@/views/component_example/label.vue'),
      meta: {
        title: $t('route.component.label'),
      },
    },
    {
      path: 'modal',
      name: 'componentExampleModal',
      component: () => import('@/views/component_example/modal.vue'),
      meta: {
        title: $t('route.component.modal'),
      },
    },
    {
      path: 'number_field',
      name: 'componentExampleNumberField',
      component: () => import('@/views/component_example/number_field.vue'),
      meta: {
        title: $t('route.component.numberField'),
      },
    },
    {
      path: 'page_header',
      name: 'componentExamplePageheader',
      component: () => import('@/views/component_example/page_header.vue'),
      meta: {
        title: $t('route.component.pageHeader'),
      },
    },
    {
      path: 'page_main',
      name: 'componentExamplePagemain',
      component: () => import('@/views/component_example/page_main.vue'),
      meta: {
        title: $t('route.component.pageMain'),
      },
    },
    {
      path: 'pagination',
      name: 'componentExamplePagination',
      component: () => import('@/views/component_example/pagination.vue'),
      meta: {
        title: $t('route.component.pagination'),
      },
    },
    {
      path: 'password_strength',
      name: 'componentExamplePasswordStrength',
      component: () => import('@/views/component_example/password_strength.vue'),
      meta: {
        title: $t('route.component.passwordStrength'),
      },
    },
    {
      path: 'popover',
      name: 'componentExamplePopover',
      component: () => import('@/views/component_example/popover.vue'),
      meta: {
        title: $t('route.component.popover'),
      },
    },
    {
      path: 'progress',
      name: 'componentExampleProgress',
      component: () => import('@/views/component_example/progress.vue'),
      meta: {
        title: $t('route.component.progress'),
      },
    },
    {
      path: 'radio_group',
      name: 'componentExampleRadioGroup',
      component: () => import('@/views/component_example/radio_group.vue'),
      meta: {
        title: $t('route.component.radioGroup'),
      },
    },
    {
      path: 'scroll_area',
      name: 'componentExampleScrollArea',
      component: () => import('@/views/component_example/scroll_area.vue'),
      meta: {
        title: $t('route.component.scrollArea'),
      },
    },
    {
      path: 'search_bar',
      name: 'componentExampleSearchBar',
      component: () => import('@/views/component_example/search_bar.vue'),
      meta: {
        title: $t('route.component.searchBar'),
      },
    },
    {
      path: 'select',
      name: 'componentExampleSelect',
      component: () => import('@/views/component_example/select.vue'),
      meta: {
        title: $t('route.component.select'),
      },
    },
    {
      path: 'slider',
      name: 'componentExampleSlider',
      component: () => import('@/views/component_example/slider.vue'),
      meta: {
        title: $t('route.component.slider'),
      },
    },
    {
      path: 'switch',
      name: 'componentExampleSwitch',
      component: () => import('@/views/component_example/switch.vue'),
      meta: {
        title: $t('route.component.switch'),
      },
    },
    {
      path: 'table',
      name: 'componentExampleTable',
      component: () => import('@/views/component_example/table.vue'),
      meta: {
        title: $t('route.component.table'),
      },
    },
    {
      path: 'tabs',
      name: 'componentExampleTabs',
      component: () => import('@/views/component_example/tabs.vue'),
      meta: {
        title: $t('route.component.tabs'),
      },
    },
    {
      path: 'tag',
      name: 'componentExampleTag',
      component: () => import('@/views/component_example/tag.vue'),
      meta: {
        title: $t('route.component.tag'),
      },
    },
    {
      path: 'textarea',
      name: 'componentExampleTextarea',
      component: () => import('@/views/component_example/textarea.vue'),
      meta: {
        title: $t('route.component.textarea'),
      },
    },
    {
      path: 'toast',
      name: 'componentExampleToast',
      component: () => import('@/views/component_example/toast.vue'),
      meta: {
        title: $t('route.component.toast'),
      },
    },
    {
      path: 'tooltip',
      name: 'componentExampleTooltip',
      component: () => import('@/views/component_example/tooltip.vue'),
      meta: {
        title: $t('route.component.tooltip'),
      },
    },
    {
      path: 'trend',
      name: 'componentExampleTrend',
      component: () => import('@/views/component_example/trend.vue'),
      meta: {
        title: $t('route.component.trend'),
      },
    },
  ],
}

export default routes
