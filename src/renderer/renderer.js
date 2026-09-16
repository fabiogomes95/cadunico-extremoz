// Lógica da interface. Usa a ponte `window.api` exposta pelo preload.js
// (o renderer nunca acessa o banco de dados diretamente).

const el = (id) => document.getElementById(id);

let pessoaAtualId = null; // id da pessoa localizada/registrada, para não duplicar cadastro
let pessoaConsultaId = null; // pessoa aberta na aba "Consultar Pessoa"
let tipos = [];
let historicoAnoAtual = []; // cache do histórico mostrado na aba "Novo Atendimento"
let historicoCompletoAtual = []; // cache do histórico mostrado na aba "Consultar Pessoa"

function hojeISO() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatarDataBR(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

function rotuloTipo(valor) {
  const t = tipos.find((t) => t.valor === valor);
  return t ? t.rotulo : valor;
}

function escaparHtml(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function formatarDoc(valor) {
  return valor ? escaparHtml(valor) : '—';
}

// ---------- Navegação entre abas ----------
document.querySelectorAll('.aba-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.aba-btn').forEach((b) => b.classList.remove('ativa'));
    document.querySelectorAll('.aba').forEach((a) => a.classList.add('oculta'));
    btn.classList.add('ativa');
    el(`aba-${btn.dataset.aba}`).classList.remove('oculta');
  });
});

// ---------- Inicialização ----------
async function atualizarListaBairros() {
  const bairros = await window.api.listarBairros();
  const datalist = el('lista-bairros');
  datalist.innerHTML = bairros.map((b) => `<option value="${escaparHtml(b)}"></option>`).join('');
}

async function iniciar() {
  tipos = await window.api.listarTipos();
  const selTipo = el('f-tipo');
  const selFiltro = el('r-tipo');
  tipos.forEach((t) => {
    selTipo.append(new Option(t.rotulo, t.valor));
    selFiltro.append(new Option(t.rotulo, t.valor));
  });

  await atualizarListaBairros();

  el('f-data').value = hojeISO();

  const primeiroDiaAno = `${new Date().getFullYear()}-01-01`;
  el('r-inicio').value = primeiroDiaAno;
  el('r-fim').value = hojeISO();
}
iniciar();

// ---------- Tabela de histórico editável (reaproveitada nas duas abas) ----------

function linhaAtendimentoHTML(a) {
  return `<tr data-id="${a.id}">
    <td>${formatarDataBR(a.data)}</td>
    <td>${escaparHtml(rotuloTipo(a.tipo))}</td>
    <td>${escaparHtml(a.bairro || '')}</td>
    <td>${escaparHtml(a.obs || '')}</td>
    <td class="acoes">
      <button class="btn btn-mini" data-acao="editar" data-id="${a.id}">Editar</button>
      <button class="btn btn-mini btn-perigo" data-acao="excluir" data-id="${a.id}">Excluir</button>
    </td>
  </tr>`;
}

function linhaEdicaoHTML(a) {
  const opcoesTipo = tipos
    .map((t) => `<option value="${t.valor}" ${t.valor === a.tipo ? 'selected' : ''}>${t.rotulo}</option>`)
    .join('');
  return `<tr data-id="${a.id}">
    <td><input type="date" class="edit-data" value="${a.data}" /></td>
    <td><select class="edit-tipo">${opcoesTipo}</select></td>
    <td><input type="text" class="edit-bairro" list="lista-bairros" value="${escaparHtml(a.bairro || '')}" /></td>
    <td><input type="text" class="edit-obs" value="${escaparHtml(a.obs || '')}" /></td>
    <td class="acoes">
      <button class="btn btn-mini btn-primario" data-acao="salvar" data-id="${a.id}">Salvar</button>
      <button class="btn btn-mini" data-acao="cancelar" data-id="${a.id}">Cancelar</button>
    </td>
  </tr>`;
}

// Liga os cliques de Editar/Excluir/Salvar/Cancelar de uma tabela de histórico.
// `obterLista` retorna o array atualmente exibido (para achar o atendimento ao
// editar); `recarregar` busca os dados de novo e redesenha a tabela.
function ligarAcoesHistorico(corpoEl, obterLista, recarregar) {
  corpoEl.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-acao]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const acao = btn.dataset.acao;
    const tr = btn.closest('tr');

    if (acao === 'editar') {
      const atendimento = obterLista().find((a) => a.id === id);
      if (!atendimento) return;
      tr.outerHTML = linhaEdicaoHTML(atendimento);
    } else if (acao === 'cancelar') {
      recarregar();
    } else if (acao === 'salvar') {
      const payload = {
        data: tr.querySelector('.edit-data').value,
        tipo: tr.querySelector('.edit-tipo').value,
        bairro: tr.querySelector('.edit-bairro').value,
        obs: tr.querySelector('.edit-obs').value,
      };
      try {
        await window.api.atualizarAtendimento(id, payload);
        await atualizarListaBairros();
        await recarregar();
      } catch (erro) {
        alert('Não foi possível salvar: ' + erro.message);
      }
    } else if (acao === 'excluir') {
      if (!confirm('Excluir este atendimento? Essa ação não pode ser desfeita.')) return;
      await window.api.excluirAtendimento(id);
      await recarregar();
    }
  });
}

// ---------- Aba: Novo Atendimento ----------

function preencherFormPessoa(pessoa) {
  pessoaAtualId = pessoa ? pessoa.id : null;
  el('f-nome').value = pessoa ? pessoa.nome : '';
  el('f-bairro').value = pessoa ? pessoa.bairro || '' : '';
  el('f-nis').value = pessoa ? pessoa.nis || '' : '';
  el('f-cpf').value = pessoa ? pessoa.cpf || '' : '';
}

function renderHistorico(historico) {
  historicoAnoAtual = historico || [];
  const corpo = el('historico-corpo');
  corpo.innerHTML = historicoAnoAtual.length
    ? historicoAnoAtual.map(linhaAtendimentoHTML).join('')
    : '<tr><td colspan="5" class="vazio">Nenhum atendimento registrado neste ano.</td></tr>';
}

async function recarregarHistoricoAno() {
  if (!pessoaAtualId) return;
  const pessoa = await window.api.buscarPessoa({ nis: el('f-nis').value, cpf: el('f-cpf').value });
  renderHistorico(pessoa.historico);
}

ligarAcoesHistorico(el('historico-corpo'), () => historicoAnoAtual, recarregarHistoricoAno);

el('btn-buscar').addEventListener('click', async () => {
  const nis = el('busca-nis').value.trim();
  const cpf = el('busca-cpf').value.trim();
  const status = el('busca-status');

  if (!nis && !cpf) {
    status.textContent = 'Informe o NIS ou o CPF para buscar.';
    status.className = 'dica erro';
    return;
  }

  status.textContent = 'Buscando...';
  status.className = 'dica';

  const { pessoa, historico } = await window.api.buscarPessoa({ nis, cpf });

  if (!pessoa) {
    status.textContent = 'Nenhum cadastro encontrado. Preencha os dados abaixo para um novo atendimento.';
    status.className = 'dica';
    preencherFormPessoa(null);
    el('f-nis').value = nis;
    el('f-cpf').value = cpf;
    renderHistorico([]);
    return;
  }

  status.textContent = `Cadastro encontrado: ${pessoa.nome}.`;
  status.className = 'dica ok';
  preencherFormPessoa(pessoa);
  renderHistorico(historico);
});

el('btn-limpar').addEventListener('click', () => {
  pessoaAtualId = null;
  el('busca-nis').value = '';
  el('busca-cpf').value = '';
  preencherFormPessoa(null);
  el('f-data').value = hojeISO();
  el('f-tipo').selectedIndex = 0;
  el('f-obs').value = '';
  el('busca-status').textContent = '';
  el('registro-status').textContent = '';
  renderHistorico([]);
});

el('btn-registrar').addEventListener('click', async () => {
  const status = el('registro-status');
  const payload = {
    pessoaId: pessoaAtualId,
    nome: el('f-nome').value,
    nis: el('f-nis').value,
    cpf: el('f-cpf').value,
    bairro: el('f-bairro').value,
    data: el('f-data').value,
    tipo: el('f-tipo').value,
    obs: el('f-obs').value,
  };

  try {
    status.textContent = 'Registrando...';
    status.className = 'dica';
    const { pessoa, historico } = await window.api.registrarAtendimento(payload);
    pessoaAtualId = pessoa.id;
    status.textContent = `Atendimento registrado para ${pessoa.nome}.`;
    status.className = 'dica ok';
    renderHistorico(historico);
    await atualizarListaBairros();
    el('f-obs').value = '';
  } catch (erro) {
    status.textContent = erro.message.replace('Error: ', '').replace('Error invoking remote method \'atendimento:registrar\': Error: ', '');
    status.className = 'dica erro';
  }
});

// ---------- Aba: Consultar Pessoa ----------

async function abrirHistoricoCompleto(pessoaId) {
  const { pessoa, atendimentos } = await window.api.historicoCompleto(pessoaId);
  if (!pessoa) return;

  pessoaConsultaId = pessoa.id;
  historicoCompletoAtual = atendimentos;

  el('c-painel-resultados').classList.add('oculta');
  el('c-painel-pessoa').classList.remove('oculta');

  el('c-pessoa-nome').textContent = pessoa.nome;
  el('c-pessoa-info').textContent =
    `NIS: ${pessoa.nis || '—'}  ·  CPF: ${pessoa.cpf || '—'}  ·  Bairro: ${pessoa.bairro || '—'}` +
    `  ·  ${atendimentos.length} atendimento(s) no total (todos os anos)`;

  const corpo = el('c-historico-corpo');
  corpo.innerHTML = atendimentos.length
    ? atendimentos.map(linhaAtendimentoHTML).join('')
    : '<tr><td colspan="5" class="vazio">Nenhum atendimento registrado.</td></tr>';
}

async function recarregarHistoricoCompleto() {
  if (!pessoaConsultaId) return;
  await abrirHistoricoCompleto(pessoaConsultaId);
}

ligarAcoesHistorico(el('c-historico-corpo'), () => historicoCompletoAtual, recarregarHistoricoCompleto);

el('c-btn-buscar').addEventListener('click', async () => {
  const termo = el('c-termo').value.trim();
  const status = el('c-status');
  el('c-painel-resultados').classList.add('oculta');
  el('c-painel-pessoa').classList.add('oculta');

  if (!termo) {
    status.textContent = 'Digite um nome, NIS ou CPF para pesquisar.';
    status.className = 'dica erro';
    return;
  }

  status.textContent = 'Pesquisando...';
  status.className = 'dica';

  const resultados = await window.api.pesquisarPessoas(termo);

  if (resultados.length === 0) {
    status.textContent = 'Nenhuma pessoa encontrada.';
    status.className = 'dica erro';
    return;
  }

  if (resultados.length === 1) {
    status.textContent = '';
    await abrirHistoricoCompleto(resultados[0].id);
    return;
  }

  status.textContent = `${resultados.length} pessoa(s) encontrada(s). Clique numa linha para ver o histórico.`;
  status.className = 'dica';
  el('c-painel-resultados').classList.remove('oculta');
  const corpo = el('c-resultados-corpo');
  corpo.innerHTML = resultados
    .map(
      (p) => `<tr class="resultado-linha" data-id="${p.id}">
        <td>${escaparHtml(p.nome)}</td>
        <td>${formatarDoc(p.nis)}</td>
        <td>${formatarDoc(p.cpf)}</td>
        <td>${formatarDoc(p.bairro)}</td>
        <td>Ver histórico →</td>
      </tr>`
    )
    .join('');

  corpo.querySelectorAll('.resultado-linha').forEach((linha) => {
    linha.addEventListener('click', () => abrirHistoricoCompleto(Number(linha.dataset.id)));
  });
});

el('c-termo').addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') el('c-btn-buscar').click();
});

// ---------- Aba: Relatórios ----------

document.querySelectorAll('.btn-chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    const hoje = new Date();
    if (btn.dataset.periodo === 'hoje') {
      el('r-inicio').value = hojeISO();
      el('r-fim').value = hojeISO();
    } else if (btn.dataset.periodo === 'mes') {
      const inicio = new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
      el('r-inicio').value = inicio;
      el('r-fim').value = hojeISO();
    } else if (btn.dataset.periodo === 'ano') {
      el('r-inicio').value = `${hoje.getFullYear()}-01-01`;
      el('r-fim').value = hojeISO();
    }
  });
});

function filtrosRelatorio() {
  return {
    dataInicio: el('r-inicio').value,
    dataFim: el('r-fim').value,
    tipo: el('r-tipo').value,
  };
}

el('btn-gerar').addEventListener('click', async () => {
  const status = el('relatorio-status');
  const filtros = filtrosRelatorio();

  if (!filtros.dataInicio || !filtros.dataFim) {
    status.textContent = 'Informe o período (de/até).';
    status.className = 'dica erro';
    return;
  }

  status.textContent = 'Gerando...';
  status.className = 'dica';

  const { registros, porTipo, total } = await window.api.gerarRelatorio(filtros);

  const resumoCorpo = el('resumo-corpo');
  resumoCorpo.innerHTML = porTipo.length
    ? porTipo.map((r) => `<tr><td>${escaparHtml(r.rotulo)}</td><td>${r.total}</td></tr>`).join('')
    : '<tr><td colspan="2" class="vazio">Nenhum atendimento no período.</td></tr>';
  el('resumo-total-valor').textContent = total;

  const relCorpo = el('relatorio-corpo');
  relCorpo.innerHTML = registros.length
    ? registros
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
        .join('')
    : '<tr><td colspan="6" class="vazio">Nenhum atendimento no período.</td></tr>';

  status.textContent = `${total} atendimento(s) encontrado(s).`;
  status.className = 'dica ok';
});

el('btn-exportar').addEventListener('click', async () => {
  const status = el('relatorio-status');
  const filtros = filtrosRelatorio();

  if (!filtros.dataInicio || !filtros.dataFim) {
    status.textContent = 'Informe o período (de/até) antes de exportar.';
    status.className = 'dica erro';
    return;
  }

  const { salvo, caminho } = await window.api.exportarRelatorio(filtros);
  if (salvo) {
    status.textContent = `Relatório exportado: ${caminho}`;
    status.className = 'dica ok';
  } else {
    status.textContent = 'Exportação cancelada.';
    status.className = 'dica';
  }
});

el('btn-exportar-pdf').addEventListener('click', async () => {
  const status = el('relatorio-status');
  const filtros = filtrosRelatorio();

  if (!filtros.dataInicio || !filtros.dataFim) {
    status.textContent = 'Informe o período (de/até) antes de exportar.';
    status.className = 'dica erro';
    return;
  }

  status.textContent = 'Gerando PDF...';
  status.className = 'dica';

  const { salvo, caminho } = await window.api.exportarRelatorioPDF(filtros);
  if (salvo) {
    status.textContent = `PDF exportado: ${caminho}`;
    status.className = 'dica ok';
  } else {
    status.textContent = 'Exportação cancelada.';
    status.className = 'dica';
  }
});
