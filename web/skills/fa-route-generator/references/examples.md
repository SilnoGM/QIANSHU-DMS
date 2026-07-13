# 路由配置示例

本文档提供了各种常见场景的路由配置示例,包括创建新路由和修改现有路由。

## 目录

- [基础示例](#基础示例)
- [多级路由](#多级路由)
- [特殊场景](#特殊场景)
- [路由配置调整](#路由配置调整)
- [完整示例](#完整示例)

## 基础示例

### 单页面路由

最简单的单页面路由配置:

```typescript
import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/dashboard',
  component: Layout,
  name: 'dashboard',
  meta: {
    title: '仪表盘',
    icon: 'i-ep:data-line',
  },
  children: [
    {
      path: '',
      name: 'dashboardIndex',
      component: () => import('@/views/dashboard/index.vue'),
      meta: {
        title: '数据概览',
      },
    },
  ],
}

export default routes
```

### 列表-详情路由

常见的列表和详情页面配置:

```typescript
const routes: RouteRecordRaw = {
  path: '/article',
  component: Layout,
  name: 'article',
  meta: {
    title: '文章管理',
    icon: 'i-ep:document',
  },
  children: [
    {
      path: '',
      name: 'articleList',
      component: () => import('@/views/article/list.vue'),
      meta: {
        title: '文章列表',
        keepAlive: 'articleDetail', // 从详情返回时保持列表状态
      },
    },
    {
      path: 'detail/:id?',
      name: 'articleDetail',
      component: () => import('@/views/article/detail.vue'),
      meta: {
        title: '文章详情',
        menu: false, // 不在导航中显示
        activeMenu: '/article', // 高亮文章管理菜单
        keepAlive: true,
        noKeepAlive: 'articleList', // 从列表进入时不保活
      },
    },
  ],
}
```

## 多级路由

### 二级菜单

```typescript
const routes: RouteRecordRaw = {
  path: '/system',
  component: Layout,
  name: 'system',
  meta: {
    title: '系统管理',
    icon: 'i-ep:setting',
  },
  children: [
    {
      path: 'user',
      name: 'systemUser',
      component: () => import('@/views/system/user/index.vue'),
      meta: {
        title: '用户管理',
        icon: 'i-ep:user',
      },
    },
    {
      path: 'role',
      name: 'systemRole',
      component: () => import('@/views/system/role/index.vue'),
      meta: {
        title: '角色管理',
        icon: 'i-ep:avatar',
      },
    },
    {
      path: 'permission',
      name: 'systemPermission',
      component: () => import('@/views/system/permission/index.vue'),
      meta: {
        title: '权限管理',
        icon: 'i-ep:lock',
      },
    },
  ],
}
```

### 三级菜单

```typescript
const routes: RouteRecordRaw = {
  path: '/content',
  component: Layout,
  name: 'content',
  meta: {
    title: '内容管理',
    icon: 'i-ep:folder',
  },
  children: [
    {
      path: 'article',
      name: 'contentArticle',
      meta: {
        title: '文章管理',
        icon: 'i-ep:document',
      },
      // 注意: 多级路由的中间层级不需要设置 component
      children: [
        {
          path: 'list',
          name: 'contentArticleList',
          component: () => import('@/views/content/article/list.vue'),
          meta: {
            title: '文章列表',
          },
        },
        {
          path: 'category',
          name: 'contentArticleCategory',
          component: () => import('@/views/content/article/category.vue'),
          meta: {
            title: '文章分类',
          },
        },
      ],
    },
    {
      path: 'media',
      name: 'contentMedia',
      meta: {
        title: '媒体管理',
        icon: 'i-ep:picture',
      },
      children: [
        {
          path: 'image',
          name: 'contentMediaImage',
          component: () => import('@/views/content/media/image.vue'),
          meta: {
            title: '图片管理',
          },
        },
        {
          path: 'video',
          name: 'contentMediaVideo',
          component: () => import('@/views/content/media/video.vue'),
          meta: {
            title: '视频管理',
          },
        },
      ],
    },
  ],
}
```

## 特殊场景

### 带权限的路由

```typescript
const routes: RouteRecordRaw = {
  path: '/admin',
  component: Layout,
  name: 'admin',
  meta: {
    title: '管理员',
    icon: 'i-ep:user-filled',
    auth: 'admin', // 需要 admin 权限
  },
  children: [
    {
      path: 'users',
      name: 'adminUsers',
      component: () => import('@/views/admin/users.vue'),
      meta: {
        title: '用户列表',
        auth: ['admin:view', 'admin:edit'], // 需要其中一个权限
        auths: [
          { name: '查看用户', value: 'admin:view' },
          { name: '编辑用户', value: 'admin:edit' },
          { name: '删除用户', value: 'admin:delete' },
        ],
      },
    },
  ],
}
```

### 外部链接

```typescript
const routes: RouteRecordRaw = {
  path: '/external',
  component: Layout,
  name: 'external',
  meta: {
    title: '外部链接',
    icon: 'i-ep:link',
  },
  children: [
    {
      path: 'github',
      name: 'externalGithub',
      component: () => import('@/views/external/link.vue'),
      meta: {
        title: 'GitHub',
        link: 'https://github.com',
      },
    },
    {
      path: 'docs',
      name: 'externalDocs',
      component: () => import('@/views/external/iframe.vue'),
      meta: {
        title: '文档',
        iframe: 'https://fantastic-admin.hurui.me',
      },
    },
  ],
}
```

### 带徽章的路由

```typescript
const routes: RouteRecordRaw = {
  path: '/features',
  component: Layout,
  name: 'features',
  meta: {
    title: '功能特性',
    icon: 'i-ep:star',
    badge: 'NEW', // 显示 NEW 徽章
  },
  children: [
    {
      path: 'pro',
      name: 'featuresPro',
      component: () => import('@/views/features/pro.vue'),
      meta: {
        title: '专业版功能',
        badge: ['PRO', 'destructive'], // 显示红色 PRO 徽章
      },
    },
    {
      path: 'beta',
      name: 'featuresBeta',
      component: () => import('@/views/features/beta.vue'),
      meta: {
        title: 'Beta 功能',
        badge: () => 'BETA', // 动态徽章
      },
    },
  ],
}
```

### 默认展开的路由

```typescript
const routes: RouteRecordRaw = {
  path: '/menu',
  component: Layout,
  name: 'menu',
  meta: {
    title: '菜单示例',
    icon: 'i-ep:menu',
    expand: true, // 默认展开
  },
  children: [
    {
      path: 'always',
      name: 'menuAlways',
      meta: {
        title: '始终展开',
        expand: [true, true], // 默认展开且不允许收起
      },
      children: [
        {
          path: 'item1',
          name: 'menuAlwaysItem1',
          component: () => import('@/views/menu/item1.vue'),
          meta: {
            title: '菜单项 1',
          },
        },
      ],
    },
  ],
}
```

### 带查询参数的路由

```typescript
const routes: RouteRecordRaw = {
  path: '/report',
  component: Layout,
  name: 'report',
  meta: {
    title: '报表',
    icon: 'i-ep:data-analysis',
  },
  children: [
    {
      path: 'sales',
      name: 'reportSales',
      component: () => import('@/views/report/sales.vue'),
      meta: {
        title: '销售报表',
        query: { type: 'monthly' }, // 点击导航时携带参数
      },
    },
  ],
}
```

### 国际化标题

```typescript
import { $t } from '@/locales'

const routes: RouteRecordRaw = {
  path: '/i18n',
  component: Layout,
  name: 'i18n',
  meta: {
    title: $t('route.i18n.root'), // 使用国际化
    icon: 'i-ep:globe',
  },
  children: [
    {
      path: 'demo',
      name: 'i18nDemo',
      component: () => import('@/views/i18n/demo.vue'),
      meta: {
        title: $t('route.i18n.demo'),
      },
    },
  ],
}
```

### 单个一级导航

```typescript
const routes: RouteRecordRaw = {
  path: '/profile',
  component: () => import('@/views/profile/index.vue'),
  name: 'profile',
  meta: {
    title: '个人中心',
    icon: 'i-ep:user',
    singleMenu: true, // 简化为单个一级导航
  },
}
```

## 完整示例

### 标准模块路由

包含列表、新增、编辑、详情的完整模块:

```typescript
import type { RouteRecordRaw } from 'vue-router'

function Layout() {
  return import('@/layouts/index.vue')
}

const routes: RouteRecordRaw = {
  path: '/product',
  component: Layout,
  name: 'product',
  meta: {
    title: '产品管理',
    icon: 'i-ep:goods',
    auth: 'product',
  },
  children: [
    {
      path: '',
      name: 'productList',
      component: () => import('@/views/product/list.vue'),
      meta: {
        title: '产品列表',
        keepAlive: ['productCreate', 'productEdit', 'productDetail'],
      },
    },
    {
      path: 'create',
      name: 'productCreate',
      component: () => import('@/views/product/form.vue'),
      meta: {
        title: '新增产品',
        menu: false,
        activeMenu: '/product',
        auth: 'product:create',
      },
    },
    {
      path: 'edit/:id',
      name: 'productEdit',
      component: () => import('@/views/product/form.vue'),
      meta: {
        title: '编辑产品',
        menu: false,
        activeMenu: '/product',
        auth: 'product:edit',
        keepAlive: true,
      },
    },
    {
      path: 'detail/:id',
      name: 'productDetail',
      component: () => import('@/views/product/detail.vue'),
      meta: {
        title: '产品详情',
        menu: false,
        activeMenu: '/product',
        keepAlive: true,
        noKeepAlive: 'productList',
      },
    },
  ],
}

export default routes
```

## 路由配置调整

### 标签页合并配置

**场景**: 列表-新增-编辑页面,希望新增和编辑页合并到同一个标签页。

**方案 1: 使用 activeMenu 合并**

适用于新增和编辑页面都设置了相同的 `activeMenu` 的情况。

```typescript
{
  path: '',
  name: 'articleList',
  component: () => import('@/views/article/list.vue'),
  meta: {
    title: '文章列表',
  },
},
{
  path: 'create',
  name: 'articleCreate',
  component: () => import('@/views/article/form.vue'),
  meta: {
    title: '新增文章',
    menu: false,
    activeMenu: '/article',
    tabMerge: 'activeMenu', // 根据 activeMenu 合并
  },
},
{
  path: 'edit/:id',
  name: 'articleEdit',
  component: () => import('@/views/article/form.vue'),
  meta: {
    title: '编辑文章',
    menu: false,
    activeMenu: '/article',
    tabMerge: 'activeMenu', // 根据 activeMenu 合并
  },
}
```

**方案 2: 使用 routeName 合并**

适用于多个页面使用相同路由名称的情况(不常用)。

```typescript
meta: {
  tabMerge: 'routeName',
}
```

### 权限配置调整

**场景 1: 添加单个权限**

```typescript
// 修改前
meta: {
  title: '用户管理',
}

// 修改后
meta: {
  title: '用户管理',
  auth: 'user:view', // 需要 user:view 权限
}
```

**场景 2: 添加多个权限(或关系)**

```typescript
meta: {
  title: '用户管理',
  auth: ['user:view', 'user:edit'], // 满足其中一个即可
}
```

**场景 3: 添加权限池**

用于角色管理模块,展示可配置的权限列表。

```typescript
meta: {
  title: '用户管理',
  auth: 'user:view',
  auths: [
    { name: '查看用户', value: 'user:view' },
    { name: '新增用户', value: 'user:create' },
    { name: '编辑用户', value: 'user:edit' },
    { name: '删除用户', value: 'user:delete' },
  ],
}
```

### 页面保活配置

**场景 1: 列表页保活配置**

列表页需要在从详情页返回时保持状态。

```typescript
{
  path: '',
  name: 'orderList',
  component: () => import('@/views/order/list.vue'),
  meta: {
    title: '订单列表',
    keepAlive: ['orderDetail', 'orderEdit'], // 从这些页面返回时保活
  },
}
```

**场景 2: 详情页保活配置**

详情页需要保活,但从列表页进入时不保活(确保显示最新数据)。

```typescript
{
  path: 'detail/:id',
  name: 'orderDetail',
  component: () => import('@/views/order/detail.vue'),
  meta: {
    title: '订单详情',
    menu: false,
    activeMenu: '/order',
    keepAlive: true, // 始终保活
    noKeepAlive: 'orderList', // 从列表进入时不保活
  },
}
```

**场景 3: 取消保活**

某些页面不需要保活,每次进入都重新加载。

```typescript
// 删除或注释掉 keepAlive 相关配置
meta: {
  title: '实时数据',
  // keepAlive: true, // 删除此行
}
```

### 导航显示调整

**场景 1: 隐藏导航项**

某些页面不需要在导航菜单中显示。

```typescript
meta: {
  title: '个人设置',
  menu: false, // 不在导航中显示
  activeMenu: '/user', // 但高亮用户菜单
}
```

**场景 2: 添加徽章**

为菜单项添加徽章提示。

```typescript
// 文字徽章
meta: {
  title: '新功能',
  badge: 'NEW',
}

// 数字徽章
meta: {
  title: '消息中心',
  badge: 5,
}

// 圆点徽章(带颜色)
meta: {
  title: '重要通知',
  badge: [true, 'destructive'], // 红色圆点
}

// 动态徽章
meta: {
  title: '待办事项',
  badge: () => store.todoCount, // 动态获取数量
}
```

**场景 3: 调整菜单排序**

```typescript
meta: {
  title: '首页',
  sort: 100, // 数字越大越靠前
}
```

### 面包屑配置

**场景 1: 隐藏面包屑**

某些页面不需要显示面包屑。

```typescript
meta: {
  title: '登录',
  breadcrumb: false, // 不显示面包屑
}
```

**场景 2: 自定义面包屑高亮**

```typescript
meta: {
  title: '编辑文章',
  activeMenu: '/article/list', // 面包屑高亮到文章列表
}
```

### 页面布局配置

**场景: 设置页面居中布局**

```typescript
meta: {
  title: '表单页面',
  layout: {
    center: true, // 启用居中布局
    centerScope: 'inner', // 作用范围: inner 或 outer
    centerWidth: 1200, // 居中宽度
  },
}
```

### 外部链接配置

**场景 1: 在新窗口打开外部链接**

```typescript
{
  path: 'github',
  name: 'externalGithub',
  component: () => import('@/views/external/link.vue'),
  meta: {
    title: 'GitHub',
    link: 'https://github.com', // 在新窗口打开
  },
}
```

**场景 2: 在 iframe 中打开**

```typescript
{
  path: 'docs',
  name: 'externalDocs',
  component: () => import('@/views/external/iframe.vue'),
  meta: {
    title: '文档',
    iframe: 'https://docs.example.com', // 在 iframe 中打开
  },
}
```

### 国际化配置

**场景: 使用国际化标题**

```typescript
import { $t } from '@/locales'

meta: {
  title: $t('route.user.list'), // 使用国际化 key
  icon: 'i-ep:user',
}
```

## 在 routes.ts 中的使用

```typescript
import ArticleRoute from './modules/article'
import ContentRoute from './modules/content'
// 1. 导入路由模块
import DashboardRoute from './modules/dashboard'
import SystemRoute from './modules/system'

// 2. 添加到 asyncRoutes
const asyncRoutes: Route.recordMainRaw[] = [
  {
    meta: {
      title: '工作台',
      icon: 'i-ep:monitor',
    },
    children: [
      DashboardRoute,
    ],
  },
  {
    meta: {
      title: '内容',
      icon: 'i-ep:document',
    },
    children: [
      ArticleRoute,
      ContentRoute,
    ],
  },
  {
    meta: {
      title: '系统',
      icon: 'i-ep:setting',
    },
    children: [
      SystemRoute,
    ],
  },
]
```
