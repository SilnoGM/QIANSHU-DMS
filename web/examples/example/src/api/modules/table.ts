import api from '../index'

export default {
  list: (data: {
    name?: string
    from: number
    limit: number
  }) => api.get('table/list', {
    params: data,
    fake: true,
  }),

  detail: (id: number | string) => api.get('table/detail', {
    params: {
      id,
    },
    fake: true,
  }),

  create: (data: any) => api.post('table/create', data, {
    fake: true,
  }),

  edit: (data: any) => api.post('table/edit', data, {
    fake: true,
  }),

  delete: (id: number | string) => api.post('table/delete', {
    id,
  }, {
    fake: true,
  }),

  preview: (data: {
    id: number
    code: string
    from: number
    limit: number
  }) => api.get('table/preview', {
    params: data,
    fake: true,
  }),
}
