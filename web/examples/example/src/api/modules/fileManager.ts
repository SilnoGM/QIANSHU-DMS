import api from '../index'

export default {
  folderTree: () => api.get('file-manager/folder-tree', {
    fake: true,
  }),

  fileList: (data: {
    folderId?: string
    keyword?: string
  }) => api.get('file-manager/file-list', {
    params: data,
    fake: true,
  }),

  delete: (id: string) => api.post('file-manager/delete', {
    id,
  }, {
    fake: true,
  }),

  rename: (data: {
    id: string
    name: string
  }) => api.post('file-manager/rename', data, {
    fake: true,
  }),
}
