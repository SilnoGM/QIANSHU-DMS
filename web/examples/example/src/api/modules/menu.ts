import api from '../index'

export default {
  list: () => api.get('menu/list', {
    fake: true,
  }),

  detail: (id: number | string) => api.get('menu/detail', {
    params: {
      id,
    },
    fake: true,
  }),

  create: (data: any) => api.post('menu/create', data, {
    fake: true,
  }),

  edit: (data: any) => api.post('menu/edit', data, {
    fake: true,
  }),

  delete: (id: number | string) => api.post('menu/delete', {
    id,
  }, {
    fake: true,
  }),
}
