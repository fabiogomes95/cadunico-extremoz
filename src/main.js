const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const {
  abrirBanco,
  Repositorio,
  TIPOS_ATENDIMENTO,
  backupDiario,
  validarDocumentos,
} = require('./db');

let db;
let repo;
let janelaPrincipal = null;

// Só uma janela do app por vez: o banco fica em memória e é regravado inteiro
// a cada salvamento, então duas instâncias abertas apagariam os dados uma da outra.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!janelaPrincipal) return;
    if (janelaPrincipal.isMinimized()) janelaPrincipal.restore();
    janelaPrincipal.focus();
  });
}

function rotuloTipo(valor) {
  const t = TIPOS_ATENDIMENTO.find((t) => t.valor === valor);
  return t ? t.rotulo : valor;
}

function formatarDataBR(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function montarHtmlRelatorio({ dataInicio, dataFim, tipoRotulo, registros, porTipo }) {
  const linhasResumo = porTipo
    .map((r) => `<tr><td>${escaparHtml(rotuloTipo(r.tipo))}</td><td>${r.total}</td></tr>`)
    .join('');
  const linhasDetalhe = registros
    .map(
      (r) => `<tr>
        <td>${formatarDataBR(r.data)}</td>
        <td>${escaparHtml(rotuloTipo(r.tipo))}</td>
        <td>${escaparHtml(r.pessoa_nome)}</td>
        <td>${escaparHtml(r.nis || '')}</td>
        <td>${escaparHtml(r.cpf || '')}</td>
        <td>${escaparHtml(r.bairro || '')}</td>
      </tr>`
    )
    .join('');

  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8" /><style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #1f2937; padding: 28px; font-size: 12px; }
    h1 { font-size: 17px; color: #123a66; margin: 0 0 2px; }
    .subtitulo { color: #6b7280; margin: 0 0 18px; font-size: 12px; }
    h2 { font-size: 13px; color: #123a66; margin: 22px 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 5px 8px; border-bottom: 1px solid #dde3ea; }
    th { background: #f4f6f9; font-size: 11px; text-transform: uppercase; color: #6b7280; }
    tfoot td { font-weight: bold; border-top: 2px solid #dde3ea; }
    .rodape { margin-top: 24px; font-size: 10px; color: #9aa3af; }
  </style></head><body>
    <h1>Controle de Atendimentos — Cadastro Único</h1>
    <p class="subtitulo">Extremoz/RN &nbsp;·&nbsp; Período: ${formatarDataBR(dataInicio)} a ${formatarDataBR(dataFim)} &nbsp;·&nbsp; Tipo: ${escaparHtml(tipoRotulo)}</p>

    <h2>Resumo por tipo</h2>
    <table>
      <thead><tr><th>Tipo</th><th>Total</th></tr></thead>
      <tbody>${linhasResumo || '<tr><td colspan="2">Nenhum atendimento no período.</td></tr>'}</tbody>
      <tfoot><tr><td>Total geral</td><td>${registros.length}</td></tr></tfoot>
    </table>

    <h2>Atendimentos do período</h2>
    <table>
      <thead><tr><th>Data</th><th>Tipo</th><th>Nome</th><th>NIS</th><th>CPF</th><th>Bairro</th></tr></thead>
      <tbody>${linhasDetalhe || '<tr><td colspan="6">Nenhum atendimento no período.</td></tr>'}</tbody>
    </table>

    <p class="rodape">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
  </body></html>`;
}

function criarJanela() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.on('closed', () => {
    if (janelaPrincipal === win) janelaPrincipal = null;
  });
  janelaPrincipal = win;
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const dbPath = path.join(app.getPath('userData'), 'cadunico.db');
  try {
    backupDiario(dbPath);
  } catch (erro) {
    console.error('Falha no backup diário:', erro);
  }
  db = await abrirBanco(dbPath);
  repo = new Repositorio(db);

  criarJanela();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  });
});

app.on('window-all-closed', () => {
  if (db && db.sqlDb) db.sqlDb.close();
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: comunicação entre a tela (renderer) e o banco de dados ----

ipcMain.handle('tipos:listar', () => TIPOS_ATENDIMENTO);

ipcMain.handle('bairros:listar', () => repo.listarBairros());

ipcMain.handle('pessoa:buscar', (_e, { nis, cpf }) => {
  const pessoa = repo.buscarPessoaPorDocumento({ nis, cpf });
  if (!pessoa) return { pessoa: null, historico: [] };
  const anoAtual = new Date().getFullYear();
  const historico = repo.historicoDoAno(pessoa.id, anoAtual);
  return { pessoa, historico };
});

ipcMain.handle('pessoa:pesquisar', (_e, termo) => {
  return repo.pesquisarPessoas(termo);
});

ipcMain.handle('pessoa:historicoCompleto', (_e, pessoaId) => {
  const pessoa = repo.buscarPessoaPorId(pessoaId);
  if (!pessoa) return { pessoa: null, atendimentos: [] };
  const atendimentos = repo.historicoCompleto(pessoaId);
  return { pessoa, atendimentos };
});

ipcMain.handle('atendimento:registrar', (_e, payload) => {
  const { nome, nis, cpf, bairro, data, tipo, obs, pessoaId } = payload;

  if (!nome || !nome.trim()) throw new Error('Informe o nome da pessoa.');
  const erroDoc = validarDocumentos({ nis, cpf });
  if (erroDoc) throw new Error(erroDoc);
  if (!data) throw new Error('Informe a data do atendimento.');
  if (!tipo) throw new Error('Selecione o tipo de atendimento.');

  // Proteção contra misturar cadastros: NIS e CPF são conferidos separadamente.
  const donoNis = nis ? repo.buscarPessoaPorDocumento({ nis }) : null;
  const donoCpf = cpf ? repo.buscarPessoaPorDocumento({ cpf }) : null;
  if (donoNis && donoCpf && donoNis.id !== donoCpf.id) {
    throw new Error(
      `O NIS é de ${donoNis.nome} e o CPF é de ${donoCpf.nome}. Confira os documentos.`
    );
  }
  const dono = donoNis || donoCpf;

  let pessoa;
  if (pessoaId) {
    if (dono && dono.id !== pessoaId) {
      throw new Error(
        `Este NIS/CPF já pertence a ${dono.nome}. Clique em "Limpar" e busque a pessoa certa.`
      );
    }
    pessoa = repo.atualizarPessoa(pessoaId, { nome, nis, cpf, bairro });
  } else {
    const existente = dono;
    pessoa = existente
      ? repo.atualizarPessoa(existente.id, { nome, nis, cpf, bairro })
      : repo.criarPessoa({ nome, nis, cpf, bairro });
  }

  const atendimento = repo.registrarAtendimento({
    pessoaId: pessoa.id,
    data,
    tipo,
    bairro,
    obs,
  });

  const anoAtual = new Date().getFullYear();
  const historico = repo.historicoDoAno(pessoa.id, anoAtual);

  return { pessoa, atendimento, historico };
});

ipcMain.handle('atendimento:atualizar', (_e, { id, data, tipo, bairro, obs }) => {
  if (!data) throw new Error('Informe a data do atendimento.');
  if (!tipo) throw new Error('Selecione o tipo de atendimento.');
  return repo.atualizarAtendimento(id, { data, tipo, bairro, obs });
});

ipcMain.handle('atendimento:excluir', (_e, id) => {
  repo.excluirAtendimento(id);
  return { ok: true };
});

ipcMain.handle('banco:backupManual', async () => {
  const hoje = new Date();
  const sufixo = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(
    hoje.getDate()
  ).padStart(2, '0')}`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Salvar cópia de segurança do banco',
    defaultPath: `cadunico-backup-${sufixo}.db`,
    filters: [{ name: 'Banco de dados', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { salvo: false };
  repo.persistir();
  fs.copyFileSync(db.dbPath, filePath);
  return { salvo: true, caminho: filePath };
});

ipcMain.handle('relatorio:gerar', (_e, { dataInicio, dataFim, tipo }) => {
  const registros = repo.listarAtendimentos({ dataInicio, dataFim, tipo: tipo || null });
  const porTipo = repo.totaisPorTipo({ dataInicio, dataFim });
  const porDia = repo.totaisPorDia({ dataInicio, dataFim });
  return {
    registros,
    porTipo: porTipo.map((r) => ({ ...r, rotulo: rotuloTipo(r.tipo) })),
    porDia,
    total: registros.length,
  };
});

ipcMain.handle('relatorio:exportar', async (_e, { dataInicio, dataFim, tipo }) => {
  const registros = repo.listarAtendimentos({ dataInicio, dataFim, tipo: tipo || null });
  const porTipo = repo.totaisPorTipo({ dataInicio, dataFim });

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar relatório',
    defaultPath: `atendimentos_${dataInicio}_a_${dataFim}.xlsx`,
    filters: [
      { name: 'Excel', extensions: ['xlsx'] },
      { name: 'CSV', extensions: ['csv'] },
    ],
  });
  if (canceled || !filePath) return { salvo: false };

  const linhas = registros.map((r) => ({
    Data: formatarDataBR(r.data),
    Tipo: rotuloTipo(r.tipo),
    Nome: r.pessoa_nome,
    NIS: r.nis || '',
    CPF: r.cpf || '',
    Bairro: r.bairro || '',
    Observação: r.obs || '',
  }));

  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    const ws = XLSX.utils.json_to_sheet(linhas);
    const csv = XLSX.utils.sheet_to_csv(ws);
    fs.writeFileSync(filePath, '﻿' + csv, 'utf8');
  } else {
    const wb = XLSX.utils.book_new();
    const wsAtendimentos = XLSX.utils.json_to_sheet(linhas);
    XLSX.utils.book_append_sheet(wb, wsAtendimentos, 'Atendimentos');

    const wsResumo = XLSX.utils.json_to_sheet(
      porTipo.map((r) => ({ Tipo: rotuloTipo(r.tipo), Total: r.total }))
    );
    XLSX.utils.book_append_sheet(wb, wsResumo, 'Resumo por tipo');

    XLSX.writeFile(wb, filePath);
  }

  return { salvo: true, caminho: filePath };
});

ipcMain.handle('relatorio:exportarPDF', async (_e, { dataInicio, dataFim, tipo }) => {
  const registros = repo.listarAtendimentos({ dataInicio, dataFim, tipo: tipo || null });
  const porTipo = repo.totaisPorTipo({ dataInicio, dataFim });

  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar relatório em PDF',
    defaultPath: `atendimentos_${dataInicio}_a_${dataFim}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { salvo: false };

  const html = montarHtmlRelatorio({
    dataInicio,
    dataFim,
    tipoRotulo: tipo ? rotuloTipo(tipo) : 'Todos',
    registros,
    porTipo,
  });

  const janelaPdf = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await janelaPdf.loadURL('data:text/html;charset=UTF-8,' + encodeURIComponent(html));
    const buffer = await janelaPdf.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    fs.writeFileSync(filePath, buffer);
  } finally {
    janelaPdf.close();
  }

  return { salvo: true, caminho: filePath };
});
