import type { RouteRecordRaw } from 'vue-router'
import { $t } from '@/locales'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw[] = [
  {
    path: '/pages_example/general',
    component: Layout,
    name: 'pagesExampleGeneral',
    meta: {
      title: $t('route.general.root'),
      icon: 'i-ri:function-line',
      auth: 'pages.general:browse',
      auths: [
        { name: '浏览', value: 'pages.general:browse' },
        { name: '新增', value: 'pages.general:create' },
        { name: '编辑', value: 'pages.general:edit' },
        { name: '删除', value: 'pages.general:delete' },
        { name: '导出', value: 'pages.general:export' },
        { name: '导入', value: 'pages.general:import' },
      ],
    },
    children: [
      {
        path: 'menu',
        name: 'pagesExampleGeneralMenu',
        meta: {
          title: $t('route.general.menu.root'),
          badge: '风格1',
        },
        children: [
          {
            path: '',
            name: 'pagesExampleGeneralMenuList',
            component: () => import('@/views/pages_example/menu/list.vue'),
            meta: {
              title: $t('route.general.menu.list'),
              menu: false,
              keepAlive: ['pagesExampleGeneralMenuCreate', 'pagesExampleGeneralMenuEdit'],
            },
          },
          {
            path: 'detail',
            name: 'pagesExampleGeneralMenuCreate',
            component: () => import('@/views/pages_example/menu/detail.vue'),
            meta: {
              title: $t('route.general.menu.create'),
              menu: false,
              activeMenu: '/pages_example/general/menu',
              keepAlive: true,
              noKeepAlive: 'pagesExampleGeneralMenuList',
              copyright: false,
            },
          },
          {
            path: 'detail/:id',
            name: 'pagesExampleGeneralMenuEdit',
            component: () => import('@/views/pages_example/menu/detail.vue'),
            meta: {
              title: $t('route.general.menu.edit'),
              menu: false,
              activeMenu: '/pages_example/general/menu',
              keepAlive: true,
              noKeepAlive: 'pagesExampleGeneralMenuList',
              copyright: false,
            },
          },
        ],
      },
      {
        path: 'menu2',
        name: 'pagesExampleGeneralMenu2',
        component: () => import('@/views/pages_example/menu2/index.vue'),
        meta: {
          title: $t('route.general.menu.root'),
          badge: '风格2',
        },
      },
      {
        path: 'manager',
        name: 'pagesExampleGeneralManager',
        meta: {
          title: $t('route.general.manager.root'),
        },
        children: [
          {
            path: '',
            name: 'pagesExampleGeneralManagerList',
            component: () => import('@/views/pages_example/manager/list.vue'),
            meta: {
              title: $t('route.general.manager.list'),
              menu: false,
              breadcrumb: false,
              keepAlive: ['pagesExampleGeneralManagerCreate', 'pagesExampleGeneralManagerEdit'],
            },
          },
          {
            path: 'detail',
            name: 'pagesExampleGeneralManagerCreate',
            component: () => import('@/views/pages_example/manager/detail.vue'),
            meta: {
              title: $t('route.general.manager.create'),
              menu: false,
              activeMenu: '/pages_example/general/manager',
              keepAlive: true,
              noKeepAlive: 'pagesExampleGeneralManagerList',
            },
          },
          {
            path: 'detail/:id',
            name: 'pagesExampleGeneralManagerEdit',
            component: () => import('@/views/pages_example/manager/detail.vue'),
            meta: {
              title: $t('route.general.manager.edit'),
              menu: false,
              activeMenu: '/pages_example/general/manager',
              keepAlive: true,
              noKeepAlive: 'pagesExampleGeneralManagerList',
            },
          },
        ],
      },
      {
        path: 'department',
        name: 'pagesExampleGeneralDepartment',
        meta: {
          title: $t('route.general.department.root'),
        },
        children: [
          {
            path: '',
            name: 'pagesExampleGeneralDepartmentList',
            component: () => import('@/views/pages_example/department/list.vue'),
            meta: {
              title: $t('route.general.department.list'),
              menu: false,
              breadcrumb: false,
              keepAlive: ['pagesExampleGeneralDepartmentCreate', 'pagesExampleGeneralDepartmentEdit'],
            },
          },
          {
            path: 'detail',
            name: 'pagesExampleGeneralDepartmentCreate',
            component: () => import('@/views/pages_example/department/detail.vue'),
            meta: {
              title: $t('route.general.department.create'),
              menu: false,
              activeMenu: '/pages_example/general/department',
            },
          },
          {
            path: 'detail/:id',
            name: 'pagesExampleGeneralDepartmentEdit',
            component: () => import('@/views/pages_example/department/detail.vue'),
            meta: {
              title: $t('route.general.department.edit'),
              menu: false,
              activeMenu: '/pages_example/general/department',
            },
          },
          {
            path: ':department_id/job',
            name: 'pagesExampleGeneralJob',
            meta: {
              title: $t('route.general.department.job.root'),
              menu: false,
            },
            children: [
              {
                path: '',
                name: 'pagesExampleGeneralJobList',
                component: () => import('@/views/pages_example/department/job/list.vue'),
                meta: {
                  title: $t('route.general.department.job.list'),
                  menu: false,
                  breadcrumb: false,
                  activeMenu: '/pages_example/general/department',
                  keepAlive: ['pagesExampleGeneralJobCreate', 'pagesExampleGeneralJobEdit'],
                },
              },
              {
                path: 'detail',
                name: 'pagesExampleGeneralJobCreate',
                component: () => import('@/views/pages_example/department/job/detail.vue'),
                meta: {
                  title: $t('route.general.department.job.create'),
                  menu: false,
                  activeMenu: '/pages_example/general/department',
                },
              },
              {
                path: 'detail/:id',
                name: 'pagesExampleGeneralJobEdit',
                component: () => import('@/views/pages_example/department/job/detail.vue'),
                meta: {
                  title: $t('route.general.department.job.edit'),
                  menu: false,
                  activeMenu: '/pages_example/general/department',
                },
              },
            ],
          },
        ],
      },
      {
        path: 'role',
        name: 'pagesExampleGeneralRole',
        meta: {
          title: $t('route.general.role.root'),
        },
        children: [
          {
            path: '',
            name: 'pagesExampleGeneralRoleList',
            component: () => import('@/views/pages_example/role/list.vue'),
            meta: {
              title: $t('route.general.role.list'),
              menu: false,
              breadcrumb: false,
              keepAlive: ['pagesExampleGeneralRoleCreate', 'pagesExampleGeneralRoleEdit'],
            },
          },
          {
            path: 'detail',
            name: 'pagesExampleGeneralRoleCreate',
            component: () => import('@/views/pages_example/role/detail.vue'),
            meta: {
              title: $t('route.general.role.create'),
              menu: false,
              activeMenu: '/pages_example/general/role',
              keepAlive: true,
              noKeepAlive: 'pagesExampleGeneralRoleList',
            },
          },
          {
            path: 'detail/:id',
            name: 'pagesExampleGeneralRoleEdit',
            component: () => import('@/views/pages_example/role/detail.vue'),
            meta: {
              title: $t('route.general.role.edit'),
              menu: false,
              activeMenu: '/pages_example/general/role',
              keepAlive: true,
              noKeepAlive: 'pagesExampleGeneralRoleList',
            },
          },
        ],
      },
      {
        path: 'dictionary',
        name: 'pagesExampleGeneralDictionary',
        component: () => import('@/views/pages_example/dictionary/index.vue'),
        meta: {
          title: $t('route.general.dictionary'),
        },
      },
      {
        path: 'table',
        name: 'pagesExampleGeneralTable',
        component: () => import('@/views/pages_example/table/index.vue'),
        meta: {
          title: $t('route.general.table'),
        },
      },
    ],
  },
  {
    path: '/pages_example/file-manager',
    component: () => import('@/views/pages_example/file-manager/index.vue'),
    name: 'pagesExampleFileManager',
    meta: {
      title: $t('route.fileManager'),
      icon: 'i-ri:folder-3-line',
      singleMenu: true,
    },
  },
  {
    path: '/pages_example/kanban',
    component: () => import('@/views/pages_example/kanban/index.vue'),
    name: 'pagesExampleKanban',
    meta: {
      title: $t('route.kanban'),
      icon: 'i-mdi:trello',
      singleMenu: true,
    },
  },
]

export default routes
