import api from '../index'

export default {
  list: (data: {
    department_id: number | string
    title?: string
    from: number
    limit: number
  }) => api.get('job/list', {
    params: data,
    fake: true,
  }),

  detail: (data: {
    department_id: number | string
    id: number | string
  }) => api.get('job/detail', {
    params: data,
    fake: true,
  }),

  create: (data: any) => api.post('job/create', data, {
    fake: true,
  }),

  edit: (data: any) => api.post('job/edit', data, {
    fake: true,
  }),

  delete: (id: number | string) => api.post('job/delete', {
    id,
  }, {
    fake: true,
  }),
}
