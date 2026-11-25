// Lógica da interface. Usa a ponte `window.api` exposta pelo preload.js
// (o renderer nunca acessa o banco de dados diretamente).

const el = (id) => document.getElementById(id);

let tipos = [];

// Estado da aba "Novo Atendimento"
let buscaAtual = null; // { nis, cpf } exatamente como estavam quando a busca foi feita
let pessoaAtual = null; // pessoa encontrada na busca (null = novo cadastro)
let historicoAnoAtual = [];
let pessoaHistoricoId = null; // de quem é o histórico exibido

// Estado da aba "Consultar Pessoa"
let pessoaConsultaId = null;
let historicoCompletoAtual = [];

// ---------- Utilitários ----------

// Data local (não UTC): com toISOString, depois das 21h o Brasil já viraria "amanhã".
function dataISO(d) {
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}
const hojeISO = () => dataISO(new Date());

function formatarDataBR(iso) {
  const [ano, mes, dia] = String(iso).split('-');
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

const soDigitos = (valor) => String(valor || '').replace(/\D/g, '');

function formatarCPF(cpf) {
  const d = soDigitos(cpf);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;
}

const mostrarDoc = (v) => (v ? escaparHtml(v) : '—');

function cpfValido(cpf) {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return dv(cpf.slice(0, 9)) === Number(cpf[9]) && dv(cpf.slice(0, 10)) === Number(cpf[10]);
}

// Tira o prefixo técnico do Electron ("Error invoking remote method ...: Error: ").
function mensagemErro(erro) {
  return String(erro && erro.message ? erro.message : erro).replace(/^.*Error: /, '');
}

function setDica(id, texto, tipo = '') {
  const p = el(id);
  p.textContent = texto;
  p.className = 'dica' + (tipo ? ' ' + tipo : '');
}

// ---------- Janela de aviso/confirmação (no lugar do alert/confirm do Windows) ----------

function abrirModal(texto, { ok = 'OK', cancelar = null, perigo = false } = {}) {
  return new Promise((resolve) => {
    const modal = el('modal');
    if (modal.open) {
      // Já há uma janela aberta: não empilha outra (evita travar a tela).
      console.error('Aviso não exibido (outra janela aberta):', texto);
      resolve(false);
      return;
    }
    el('modal-texto').textContent = texto;
    const btnOk = el('modal-ok');
    const btnCancelar = el('modal-cancelar');
    btnOk.textContent = ok;
    btnOk.className = 'btn ' + (perigo ? 'btn-perigo-cheio' : 'btn-primario');
    btnCancelar.classList.toggle('oculta', !cancelar);
    if (cancelar) btnCancelar.textContent = cancelar;

    const fechar = (valor) => {
      btnOk.onclick = null;
      btnCancelar.onclick = null;
      modal.onclose = null;
      if (modal.open) modal.close();
      resolve(valor);
    };
    btnOk.onclick = () => fechar(true);
    btnCancelar.onclick = () => fechar(false);
    modal.onclose = () => fechar(false); // tecla Esc
    modal.showModal();
    (cancelar ? btnCancelar : btnOk).focus();
  });
}
const avisar = (texto) => abrirModal(texto);
const confirmar = (texto, opcoes) => abrirModal(texto, { cancelar: 'Cancelar', ...opcoes });

// Qualquer erro inesperado aparece na tela em vez de sumir em silêncio.
window.addEventListener('unhandledrejection', (ev) => {
  avisar('Ocorreu um erro inesperado:\n' + mensagemErro(ev.reason) + '\n\nSe repetir, chame o TI.');
});

// ---------- Navegação entre abas ----------
document.querySelectorAll('.aba-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.aba-btn').forEach((b) => b.classList.remove('ativa'));
    document.querySelectorAll('.aba').forEach((a) => a.classList.add('oculta'));
    btn.classList.add('ativa');
    el(`aba-${btn.dataset.aba}`).classList.remove('oculta');
  });
});

// ---------- Atendente (fica salvo neste computador) ----------

function lerAtendenteSalvo() {
  try {
    return localStorage.getItem('atendente') || '';
  } catch {
    return '';
  }
}

el('atendente').addEventListener('change', () => {
  const nome = el('atendente').value.trim();
  el('atendente').value = nome;
  el('atendente').classList.toggle('faltando', !nome);
  try {
    localStorage.setItem('atendente', nome);
  } catch {
    /* sem armazenamento: só não lembra na próxima vez */
  }
});

async function atualizarListas() {
  const [bairros, atendentes] = await Promise.all([
    window.api.listarBairros(),
    window.api.listarAtendentes(),
  ]);
  el('lista-bairros').innerHTML = bairros.map((b) => `<option value="${escaparHtml(b)}"></option>`).join('');
  el('lista-atendentes').innerHTML = atendentes
    .map((a) => `<option value="${escaparHtml(a)}"></option>`)
    .join('');
}

// ---------- Inicialização ----------

async function iniciar() {
  tipos = await window.api.listarTipos();
  tipos.forEach((t) => {
    el('f-tipo').append(new Option(t.rotulo, t.valor));
    el('r-tipo').append(new Option(t.rotulo, t.valor));
  });

  await atualizarListas();

  el('atendente').value = lerAtendenteSalvo();
  el('atendente').classList.toggle('faltando', !el('atendente').value);

  el('f-data').value = hojeISO();
  el('r-inicio').value = `${new Date().getFullYear()}-01-01`;
  el('r-fim').value = hojeISO();
  el('busca-nis').focus();
}
iniciar();

// ---------- Tabela de histórico (reaproveitada nas duas abas) ----------
// Na linha normal só existe "Editar". "Excluir" fica dentro da edição,
// longe do clique do dia a dia, e pede confirmação.

function linhaAtendimentoHTML(a) {
  return `<tr data-id="${a.id}">
    <td>${formatarDataBR(a.data)}</td>
    <td>${escaparHtml(rotuloTipo(a.tipo))}</td>
    <td>${escaparHtml(a.bairro || '')}</td>
    <td>${escaparHtml(a.obs || '')}</td>
    <td>${escaparHtml(a.atendente || '')}</td>
    <td class="acoes">
      <button class="btn btn-mini" data-acao="editar" data-id="${a.id}">Editar</button>
    </td>
  </tr>`;
}

function linhaEdicaoHTML(a) {
  const opcoesTipo = tipos
    .map((t) => `<option value="${t.valor}" ${t.valor === a.tipo ? 'selected' : ''}>${escaparHtml(t.rotulo)}</option>`)
    .join('');
  return `<tr data-id="${a.id}">
    <td><input type="date" class="edit-data" value="${escaparHtml(a.data)}" /></td>
    <td><select class="edit-tipo">${opcoesTipo}</select></td>
    <td><input type="text" class="edit-bairro" list="lista-bairros" value="${escaparHtml(a.bairro || '')}" /></td>
    <td><input type="text" class="edit-obs" value="${escaparHtml(a.obs || '')}" /></td>
    <td>${escaparHtml(a.atendente || '')}</td>
    <td class="acoes">
      <button class="btn btn-mini btn-primario" data-acao="salvar" data-id="${a.id}">Salvar</button>
      <button class="btn btn-mini" data-acao="cancelar" data-id="${a.id}">Cancelar</button>
      <button class="btn btn-mini btn-perigo" data-acao="excluir" data-id="${a.id}">Excluir</button>
    </td>
  </tr>`;
}

function ligarAcoesHistorico(corpoEl, obterLista, recarregar) {
  corpoEl.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-acao]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const acao = btn.dataset.acao;
    const tr = btn.closest('tr');
    const atendimento = obterLista().find((a) => a.id === id);

    if (acao === 'editar') {
      if (atendimento) tr.outerHTML = linhaEdicaoHTML(atendimento);
    } else if (acao === 'cancelar') {
      await recarregar();
    } else if (acao === 'salvar') {
      const payload = {
        data: tr.querySelector('.edit-data').value,
        tipo: tr.querySelector('.edit-tipo').value,
        bairro: tr.querySelector('.edit-bairro').value,
        obs: tr.querySelector('.edit-obs').value,
      };
      try {
        await window.api.atualizarAtendimento(id, payload);
        await atualizarListas();
        await recarregar();
      } catch (erro) {
        await avisar('Não foi possível salvar: ' + mensagemErro(erro));
      }
    } else if (acao === 'excluir') {
      const descricao = atendimento
        ? `${rotuloTipo(atendimento.tipo)} de ${formatarDataBR(atendimento.data)}`
        : 'este atendimento';
      const ok = await confirmar(
        `Excluir o atendimento "${descricao}"?\n\nEssa ação não pode ser desfeita.`,
        { ok: 'Excluir', perigo: true }
      );
      if (!ok) return;
      await window.api.excluirAtendimento(id);
      await recarregar();
    }
  });
}

// ---------- Aba: Novo Atendimento ----------

function renderHistorico(historico, pessoaId = null, nome = '') {
  historicoAnoAtual = historico || [];
  pessoaHistoricoId = pessoaId;
  el('historico-titulo').textContent = nome ? `Histórico deste ano — ${nome}` : 'Histórico deste ano';
  el('historico-corpo').innerHTML = historicoAnoAtual.length
    ? historicoAnoAtual.map(linhaAtendimentoHTML).join('')
    : `<tr><td colspan="6" class="vazio">${
        pessoaId ? 'Nenhum atendimento registrado neste ano.' : 'Busque uma pessoa para ver o histórico.'
      }</td></tr>`;
}

async function recarregarHistoricoAno() {
  if (!pessoaHistoricoId) return;
  const { pessoa, atendimentos } = await window.api.historicoCompleto(pessoaHistoricoId);
  const ano = String(new Date().getFullYear());
  renderHistorico(
    atendimentos.filter((a) => a.data.startsWith(ano)),
    pessoaHistoricoId,
    pessoa ? pessoa.nome : ''
  );
  if (pessoaAtual && pessoa && pessoaAtual.id === pessoa.id) mostrarCartao(pessoa, historicoAnoAtual.length);
}

ligarAcoesHistorico(el('historico-corpo'), () => historicoAnoAtual, recarregarHistoricoAno);

function mostrarCartao(pessoa, qtdAno) {
  const cartao = el('cartao-pessoa');
  cartao.classList.remove('oculta');
  if (pessoa) {
    cartao.className = 'cartao encontrada';
    cartao.innerHTML = `
      <div class="cartao-titulo">Pessoa encontrada</div>
      <div class="cartao-nome">${escaparHtml(pessoa.nome)}</div>
      <div class="cartao-info">NIS: ${mostrarDoc(pessoa.nis)} &nbsp;·&nbsp; CPF: ${mostrarDoc(formatarCPF(pessoa.cpf))}
        &nbsp;·&nbsp; Bairro: ${mostrarDoc(pessoa.bairro)} &nbsp;·&nbsp; ${qtdAno} atendimento(s) este ano</div>`;
  } else {
    cartao.className = 'cartao';
    cartao.innerHTML = `
      <div class="cartao-titulo">Novo cadastro</div>
      <div class="cartao-nome">Pessoa ainda não cadastrada</div>
      <div class="cartao-info">Preencha o nome completo e o bairro abaixo.</div>`;
  }
}

// Volta a aba ao estado inicial (pronta para o próximo da fila).
function resetarAtendimento({ manterDocs = false } = {}) {
  buscaAtual = null;
  pessoaAtual = null;
  if (!manterDocs) {
    el('busca-nis').value = '';
    el('busca-cpf').value = '';
  }
  el('cartao-pessoa').classList.add('oculta');
  el('bloco-registro').classList.add('oculta');
  el('f-nome').value = '';
  el('f-bairro').value = '';
  el('f-data').value = hojeISO();
  el('f-tipo').value = '';
  el('f-obs').value = '';
  setDica('busca-status', 'Digite o NIS ou o CPF e aperte Enter.');
}

function esconderAvisoRegistro() {
  el('registro-status').className = 'aviso oculta';
}

function mostrarAvisoRegistro(texto, tipo) {
  const p = el('registro-status');
  p.textContent = texto;
  p.className = 'aviso ' + tipo;
}

// Se mexerem no NIS/CPF depois de buscar, é obrigatório buscar de novo
// (evita registrar no cadastro de outra pessoa).
['busca-nis', 'busca-cpf'].forEach((id) => {
  el(id).addEventListener('input', () => {
    if (!buscaAtual) return;
    const mudou =
      soDigitos(el('busca-nis').value) !== buscaAtual.nis ||
      soDigitos(el('busca-cpf').value) !== buscaAtual.cpf;
    if (mudou) {
      resetarAtendimento({ manterDocs: true });
      setDica('busca-status', 'Documento alterado. Aperte Enter ou clique em Buscar.');
    }
  });
  el(id).addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') el('btn-buscar').click();
  });
});

el('btn-buscar').addEventListener('click', async () => {
  esconderAvisoRegistro();
  const nis = soDigitos(el('busca-nis').value);
  const cpf = soDigitos(el('busca-cpf').value);

  if (!nis && !cpf) return setDica('busca-status', 'Informe o NIS ou o CPF para buscar.', 'erro');
  if (nis && nis.length !== 11) {
    return setDica('busca-status', `O NIS precisa ter 11 números (foram digitados ${nis.length}).`, 'erro');
  }
  if (cpf && !cpfValido(cpf)) return setDica('busca-status', 'CPF inválido. Confira os números.', 'erro');

  setDica('busca-status', 'Buscando...');
  const { pessoa, historico, conflito } = await window.api.buscarPessoa({ nis, cpf });

  if (conflito) {
    resetarAtendimento({ manterDocs: true });
    return setDica('busca-status', conflito, 'erro');
  }

  pessoaAtual = pessoa;
  // Completa os documentos com o que já está no cadastro (sem apagar o que foi digitado).
  const nisFinal = (pessoa && pessoa.nis) || nis;
  const cpfFinal = (pessoa && pessoa.cpf) || cpf;
  el('busca-nis').value = nisFinal;
  el('busca-cpf').value = cpfFinal;
  buscaAtual = { nis: nisFinal, cpf: cpfFinal };

  el('f-nome').value = pessoa ? pessoa.nome : '';
  el('f-bairro').value = pessoa ? pessoa.bairro || '' : '';
  el('f-data').value = hojeISO();
  el('f-tipo').value = '';
  el('f-obs').value = '';

  mostrarCartao(pessoa, (historico || []).length);
  renderHistorico(historico, pessoa ? pessoa.id : null, pessoa ? pessoa.nome : '');
  el('bloco-registro').classList.remove('oculta');
  setDica('busca-status', '');
  (pessoa ? el('f-tipo') : el('f-nome')).focus();
});

el('btn-limpar').addEventListener('click', () => {
  resetarAtendimento();
  esconderAvisoRegistro();
  renderHistorico([]);
  el('busca-nis').focus();
});

el('btn-registrar').addEventListener('click', async () => {
  esconderAvisoRegistro();
  const atendente = el('atendente').value.trim();
  if (!atendente) {
    el('atendente').classList.add('faltando');
    el('atendente').focus();
    return mostrarAvisoRegistro('Escreva seu nome no campo "Atendente", no topo da tela.', 'erro');
  }
  if (!buscaAtual) return mostrarAvisoRegistro('Busque a pessoa pelo NIS ou CPF primeiro.', 'erro');
  if (!el('f-nome').value.trim()) {
    el('f-nome').focus();
    return mostrarAvisoRegistro('Preencha o nome completo da pessoa.', 'erro');
  }
  if (!el('f-tipo').value) {
    el('f-tipo').focus();
    return mostrarAvisoRegistro('Selecione o tipo de atendimento.', 'erro');
  }

  const payload = {
    pessoaId: pessoaAtual ? pessoaAtual.id : null,
    nome: el('f-nome').value,
    nis: buscaAtual.nis,
    cpf: buscaAtual.cpf,
    bairro: el('f-bairro').value,
    data: el('f-data').value,
    tipo: el('f-tipo').value,
    obs: el('f-obs').value,
    atendente,
  };

  const btn = el('btn-registrar');
  btn.disabled = true; // evita duplo clique
  try {
    let resultado = await window.api.registrarAtendimento(payload);
    if (resultado.duplicado) {
      const ok = await confirmar(
        `Esta pessoa já tem um atendimento de "${rotuloTipo(payload.tipo)}" em ${formatarDataBR(payload.data)}.\n\n` +
          'Registrar outro mesmo assim?',
        { ok: 'Registrar mesmo assim' }
      );
      if (!ok) return mostrarAvisoRegistro('Nada foi registrado (atendimento repetido).', 'erro');
      resultado = await window.api.registrarAtendimento({ ...payload, confirmarDuplicado: true });
    }

    const { pessoa, historico } = resultado;
    resetarAtendimento();
    renderHistorico(historico, pessoa.id, pessoa.nome);
    mostrarAvisoRegistro(
      `Atendimento registrado para ${pessoa.nome}. Pronto para o próximo.`,
      'ok'
    );
    await atualizarListas();
    el('busca-nis').focus();
  } catch (erro) {
    mostrarAvisoRegistro(mensagemErro(erro), 'erro');
  } finally {
    btn.disabled = false;
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
    `NIS: ${pessoa.nis || '—'}  ·  CPF: ${formatarCPF(pessoa.cpf) || '—'}  ·  Bairro: ${pessoa.bairro || '—'}` +
    `  ·  ${atendimentos.length} atendimento(s) no total (todos os anos)`;

  el('c-historico-corpo').innerHTML = atendimentos.length
    ? atendimentos.map(linhaAtendimentoHTML).join('')
    : '<tr><td colspan="6" class="vazio">Nenhum atendimento registrado.</td></tr>';
}

async function recarregarHistoricoCompleto() {
  if (pessoaConsultaId) await abrirHistoricoCompleto(pessoaConsultaId);
}

ligarAcoesHistorico(el('c-historico-corpo'), () => historicoCompletoAtual, recarregarHistoricoCompleto);

el('c-btn-buscar').addEventListener('click', async () => {
  const termo = el('c-termo').value.trim();
  el('c-painel-resultados').classList.add('oculta');
  el('c-painel-pessoa').classList.add('oculta');

  if (!termo) return setDica('c-status', 'Digite um nome, NIS ou CPF para pesquisar.', 'erro');

  setDica('c-status', 'Pesquisando...');
  const resultados = await window.api.pesquisarPessoas(termo);

  if (resultados.length === 0) return setDica('c-status', 'Nenhuma pessoa encontrada.', 'erro');

  if (resultados.length === 1) {
    setDica('c-status', '');
    return abrirHistoricoCompleto(resultados[0].id);
  }

  setDica(
    'c-status',
    `${resultados.length === 50 ? 'Mais de 50' : resultados.length} pessoa(s) encontrada(s). Clique numa linha para ver o histórico.`
  );
  el('c-painel-resultados').classList.remove('oculta');
  const corpo = el('c-resultados-corpo');
  corpo.innerHTML = resultados
    .map(
      (p) => `<tr class="resultado-linha" data-id="${p.id}">
        <td>${escaparHtml(p.nome)}</td>
        <td>${mostrarDoc(p.nis)}</td>
        <td>${mostrarDoc(formatarCPF(p.cpf))}</td>
        <td>${mostrarDoc(p.bairro)}</td>
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
    } else if (btn.dataset.periodo === 'mes') {
      el('r-inicio').value = dataISO(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
    } else if (btn.dataset.periodo === 'ano') {
      el('r-inicio').value = `${hoje.getFullYear()}-01-01`;
    }
    el('r-fim').value = hojeISO();
    el('btn-gerar').click();
  });
});

function filtrosRelatorio() {
  return {
    dataInicio: el('r-inicio').value,
    dataFim: el('r-fim').value,
    tipo: el('r-tipo').value,
  };
}

function periodoValido(filtros) {
  if (!filtros.dataInicio || !filtros.dataFim) {
    setDica('relatorio-status', 'Informe o período (de/até).', 'erro');
    return false;
  }
  if (filtros.dataInicio > filtros.dataFim) {
    setDica('relatorio-status', 'A data "De" está depois da data "Até".', 'erro');
    return false;
  }
  return true;
}

el('btn-gerar').addEventListener('click', async () => {
  const filtros = filtrosRelatorio();
  if (!periodoValido(filtros)) return;

  setDica('relatorio-status', 'Gerando...');
  const { registros, porTipo, total, pessoas } = await window.api.gerarRelatorio(filtros);

  el('resumo-corpo').innerHTML = porTipo.length
    ? porTipo.map((r) => `<tr><td>${escaparHtml(r.rotulo)}</td><td>${r.total}</td></tr>`).join('')
    : '<tr><td colspan="2" class="vazio">Nenhum atendimento no período.</td></tr>';
  el('resumo-total-valor').textContent = total;
  el('resumo-pessoas-valor').textContent = pessoas;

  el('relatorio-corpo').innerHTML = registros.length
    ? registros
        .map(
          (r) => `<tr>
            <td>${formatarDataBR(r.data)}</td>
            <td>${escaparHtml(rotuloTipo(r.tipo))}</td>
            <td>${escaparHtml(r.pessoa_nome)}</td>
            <td>${escaparHtml(r.nis || '')}</td>
            <td>${escaparHtml(formatarCPF(r.cpf))}</td>
            <td>${escaparHtml(r.bairro || '')}</td>
            <td>${escaparHtml(r.atendente || '')}</td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="7" class="vazio">Nenhum atendimento no período.</td></tr>';

  setDica('relatorio-status', `${total} atendimento(s) de ${pessoas} pessoa(s).`, 'ok');
});

async function exportar(funcao, rotulo) {
  const filtros = filtrosRelatorio();
  if (!periodoValido(filtros)) return;
  setDica('relatorio-status', `Gerando ${rotulo}...`);
  try {
    const { salvo, caminho } = await funcao(filtros);
    if (salvo) setDica('relatorio-status', `${rotulo} salvo em: ${caminho}`, 'ok');
    else setDica('relatorio-status', 'Exportação cancelada.');
  } catch (erro) {
    setDica('relatorio-status', `Não foi possível salvar: ${mensagemErro(erro)} (se o arquivo já existe, ele está aberto em outro programa? Feche e tente de novo.)`, 'erro');
  }
}

el('btn-exportar').addEventListener('click', () => exportar(window.api.exportarRelatorio, 'Planilha'));
el('btn-exportar-pdf').addEventListener('click', () => exportar(window.api.exportarRelatorioPDF, 'PDF'));

el('btn-backup').addEventListener('click', async () => {
  try {
    const { salvo, caminho } = await window.api.backupManual();
    if (salvo) setDica('relatorio-status', `Cópia de segurança salva em: ${caminho}`, 'ok');
    else setDica('relatorio-status', 'Backup cancelado.');
  } catch (erro) {
    setDica('relatorio-status', 'Não foi possível salvar o backup: ' + mensagemErro(erro), 'erro');
  }
});
