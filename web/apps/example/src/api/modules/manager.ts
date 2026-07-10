import api from '../index'

export default {
  list: (data: {
    account?: string
    name?: string
    mobile?: string
    sex?: number | string
    from: number
    limit: number
  }) => api.get('manager/list', {
    params: data,
    fake: true,
  }),

  detail: (id: number | string) => api.get('manager/detail', {
    params: {
      id,
    },
    fake: true,
  }),

  create: (data: any) => api.post('manager/create', data, {
    fake: true,
  }),

  edit: (data: any) => api.post('manager/edit', data, {
    fake: true,
  }),

  delete: (id: number | string) => api.post('manager/delete', {
    id,
  }, {
    fake: true,
  }),

  passwordReset: (id: number | string) => api.post('manager/password/reset', {
    id,
  }, {
    fake: true,
  }),

  changeStatus: (data: {
    id: number
    status: boolean
  }) => api.post('manager/change/status', data, {
    fake: true,
  }),

  check: (data: {
    key: string
    value: string
    id?: number
  }) => api.post('manager/check', data, {
    fake: true,
  }),
}
