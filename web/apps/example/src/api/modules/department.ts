import api from '../index'

export default {
  list: (data: {
    title?: string
    from: number
    limit: number
  }) => api.get('department/list', {
    params: data,
    fake: true,
  }),

  detail: (id: number | string) => api.get('department/detail', {
    params: {
      id,
    },
    fake: true,
  }),

  create: (data: any) => api.post('department/create', data, {
    fake: true,
  }),

  edit: (data: any) => api.post('department/edit', data, {
    fake: true,
  }),

  delete: (id: number | string) => api.post('department/delete', {
    id,
  }, {
    fake: true,
  }),
}
