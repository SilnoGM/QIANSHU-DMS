import api from '../index'

export default {
  list: (data: {
    name?: string
    from: number
    limit: number
  }) => api.get('role/list', {
    params: data,
    fake: true,
  }),

  detail: (id: number | string) => api.get('role/detail', {
    params: {
      id,
    },
    fake: true,
  }),

  create: (data: any) => api.post('role/create', data, {
    fake: true,
  }),

  edit: (data: any) => api.post('role/edit', data, {
    fake: true,
  }),

  delete: (id: number | string) => api.post('role/delete', {
    id,
  }, {
    fake: true,
  }),

  allList: () => api.get('role/allList', {
    fake: true,
  }),
}
