const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listarTipos: () => ipcRenderer.invoke('tipos:listar'),
  listarBairros: () => ipcRenderer.invoke('bairros:listar'),
  buscarPessoa: (doc) => ipcRenderer.invoke('pessoa:buscar', doc),
  pesquisarPessoas: (termo) => ipcRenderer.invoke('pessoa:pesquisar', termo),
  historicoCompleto: (pessoaId) => ipcRenderer.invoke('pessoa:historicoCompleto', pessoaId),
  registrarAtendimento: (payload) => ipcRenderer.invoke('atendimento:registrar', payload),
  atualizarAtendimento: (id, payload) => ipcRenderer.invoke('atendimento:atualizar', { id, ...payload }),
  excluirAtendimento: (id) => ipcRenderer.invoke('atendimento:excluir', id),
  gerarRelatorio: (filtros) => ipcRenderer.invoke('relatorio:gerar', filtros),
  exportarRelatorio: (filtros) => ipcRenderer.invoke('relatorio:exportar', filtros),
  exportarRelatorioPDF: (filtros) => ipcRenderer.invoke('relatorio:exportarPDF', filtros),
});
