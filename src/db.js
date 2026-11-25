// Camada de acesso ao banco de dados (SQLite via sql.js — WebAssembly, sem
// compilação nativa). Guarda pessoas atendidas e o histórico de atendimentos
// de cada uma. O banco vive em memória durante a execução e é salvo em
// arquivo (.db) a cada gravação.

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const TIPOS_ATENDIMENTO = [
  { valor: 'inclusao', rotulo: 'Inclusão' },
  { valor: 'atualizacao', rotulo: 'Atualização' },
  { valor: 'transferencia', rotulo: 'Transferência' },
  { valor: 'consulta', rotulo: 'Consulta' },
  { valor: 'folha_resumo', rotulo: 'Folha resumo' },
  { valor: 'declaracao', rotulo: 'Declaração' },
];

// Extremoz/RN é um município de distrito único — não tem bairros oficiais
// definidos por lei. Esta é só uma lista de partida com localidades/povoados
// conhecidos (fonte: Wikipédia + bases de CEP), para sugerir no formulário.
// A lista real de bairros cresce sozinha com o uso (ver listarBairros).
const BAIRROS_SUGERIDOS = [
  'Centro',
  'Área Litorânea',
  'Central Parque I',
  'Conjunto das Dunas (Pitangui)',
  'Povoado de Araçá',
  'Pitangui',
  'Genipabu',
  'Santa Rita',
  'Barra do Rio',
  'Graçandu',
  'Vila de Fátima',
  'Conjunto Estrela do Mar',
];

async function abrirBanco(dbPath) {
  const SQL = await initSqlJs({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm'),
  });

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const bytes = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : null;
  const sqlDb = bytes ? new SQL.Database(bytes) : new SQL.Database();

  sqlDb.run(`
    CREATE TABLE IF NOT EXISTS pessoas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      nis TEXT,
      cpf TEXT,
      bairro TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pessoas_nis ON pessoas(nis);
    CREATE INDEX IF NOT EXISTS idx_pessoas_cpf ON pessoas(cpf);

    CREATE TABLE IF NOT EXISTS atendimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pessoa_id INTEGER NOT NULL REFERENCES pessoas(id),
      data TEXT NOT NULL,
      tipo TEXT NOT NULL,
      bairro TEXT,
      obs TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_atendimentos_data ON atendimentos(data);
    CREATE INDEX IF NOT EXISTS idx_atendimentos_pessoa ON atendimentos(pessoa_id);
  `);

  // Migração: coluna "atendente" (quem registrou). Bancos antigos não têm.
  const colunas = consultarTodas(sqlDb, 'PRAGMA table_info(atendimentos)').map((c) => c.name);
  if (!colunas.includes('atendente')) {
    sqlDb.run('ALTER TABLE atendimentos ADD COLUMN atendente TEXT');
  }

  return { sqlDb, dbPath };
}

// Grava primeiro num arquivo temporário e só depois troca pelo original.
// Assim, se faltar energia no meio da gravação, o .db antigo continua inteiro.
function salvar({ sqlDb, dbPath }) {
  const dados = Buffer.from(sqlDb.export());
  const tmp = dbPath + '.tmp';
  fs.writeFileSync(tmp, dados);
  try {
    fs.renameSync(tmp, dbPath);
  } catch (erro) {
    // No Windows o rename pode falhar se o antivírus estiver lendo o arquivo.
    fs.copyFileSync(tmp, dbPath);
    fs.rmSync(tmp, { force: true });
  }
}

function dataLocalISO(d = new Date()) {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Cópia automática do banco, uma por dia, guardando as últimas `manter`.
// Fica em <pasta do banco>/backups/cadunico-AAAA-MM-DD.db
function backupDiario(dbPath, manter = 30) {
  if (!fs.existsSync(dbPath)) return null;
  const pasta = path.join(path.dirname(dbPath), 'backups');
  fs.mkdirSync(pasta, { recursive: true });
  const destino = path.join(pasta, `cadunico-${dataLocalISO()}.db`);
  if (!fs.existsSync(destino)) fs.copyFileSync(dbPath, destino);

  const antigos = fs
    .readdirSync(pasta)
    .filter((f) => /^cadunico-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
    .reverse()
    .slice(manter);
  antigos.forEach((f) => fs.rmSync(path.join(pasta, f), { force: true }));
  return destino;
}

function normalizarDoc(valor) {
  if (!valor) return null;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos.length ? digitos : null;
}

// Remove acentos e caixa, para a busca por nome achar "Jose" em "José".
function semAcento(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function limparTexto(valor) {
  const t = String(valor || '').replace(/\s+/g, ' ').trim();
  return t || null;
}

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

// Retorna a mensagem de erro, ou null se NIS/CPF estiverem ok.
// NIS: confere só os 11 dígitos (para não travar a recepção num número válido).
function validarDocumentos({ nis, cpf }) {
  const n = normalizarDoc(nis);
  const c = normalizarDoc(cpf);
  if (!n && !c) return 'Informe ao menos o NIS ou o CPF.';
  if (n && n.length !== 11) return `NIS deve ter 11 dígitos (foram digitados ${n.length}).`;
  if (c && !cpfValido(c)) return 'CPF inválido. Confira os números digitados.';
  return null;
}

// Executa um SELECT e retorna todas as linhas como objetos {coluna: valor}.
function consultarTodas(sqlDb, sql, params = []) {
  const stmt = sqlDb.prepare(sql);
  stmt.bind(params);
  const linhas = [];
  while (stmt.step()) linhas.push(stmt.getAsObject());
  stmt.free();
  return linhas;
}

function consultarUma(sqlDb, sql, params = []) {
  const linhas = consultarTodas(sqlDb, sql, params);
  return linhas[0] || null;
}

class Repositorio {
  constructor(banco) {
    this.banco = banco; // { sqlDb, dbPath }
  }

  get sqlDb() {
    return this.banco.sqlDb;
  }

  persistir() {
    salvar(this.banco);
  }

  buscarPessoaPorDocumento({ nis, cpf }) {
    const nisDigitos = normalizarDoc(nis);
    const cpfDigitos = normalizarDoc(cpf);
    if (!nisDigitos && !cpfDigitos) return null;

    return consultarUma(
      this.sqlDb,
      `SELECT * FROM pessoas
       WHERE (:nis IS NOT NULL AND nis = :nis) OR (:cpf IS NOT NULL AND cpf = :cpf)
       ORDER BY id DESC LIMIT 1`,
      { ':nis': nisDigitos, ':cpf': cpfDigitos }
    );
  }

  buscarPessoaPorId(id) {
    return consultarUma(this.sqlDb, 'SELECT * FROM pessoas WHERE id = ?', [id]);
  }

  // Pesquisa livre por nome, NIS ou CPF — usada na aba "Consultar Pessoa".
  // Retorna uma lista (pode ter mais de uma pessoa quando a busca é por nome).
  pesquisarPessoas(termo) {
    const bruto = (termo || '').trim();
    if (!bruto) return [];
    const digitos = normalizarDoc(bruto);
    // Só números (com ou sem pontuação): busca exata por NIS/CPF.
    if (digitos && /^[\d.\-\s/]+$/.test(bruto)) {
      return consultarTodas(
        this.sqlDb,
        'SELECT * FROM pessoas WHERE nis = :doc OR cpf = :doc ORDER BY nome ASC LIMIT 50',
        { ':doc': digitos }
      );
    }
    // Nome: ignora acentos e maiúsculas; cada palavra digitada precisa aparecer.
    const palavras = semAcento(bruto).split(/\s+/).filter(Boolean);
    return consultarTodas(this.sqlDb, 'SELECT * FROM pessoas')
      .filter((p) => {
        const nome = semAcento(p.nome);
        return palavras.every((w) => nome.includes(w));
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
      .slice(0, 50);
  }

  // Quem é dono de cada documento (separadamente), para detectar mistura.
  donosDosDocumentos({ nis, cpf }) {
    const n = normalizarDoc(nis);
    const c = normalizarDoc(cpf);
    return {
      donoNis: n ? consultarUma(this.sqlDb, 'SELECT * FROM pessoas WHERE nis = ? ORDER BY id DESC', [n]) : null,
      donoCpf: c ? consultarUma(this.sqlDb, 'SELECT * FROM pessoas WHERE cpf = ? ORDER BY id DESC', [c]) : null,
    };
  }

  // Todo o histórico de atendimentos de uma pessoa, sem filtrar por ano.
  historicoCompleto(pessoaId) {
    return consultarTodas(
      this.sqlDb,
      `SELECT * FROM atendimentos WHERE pessoa_id = ? ORDER BY data DESC, id DESC`,
      [pessoaId]
    );
  }

  criarPessoa({ nome, nis, cpf, bairro }) {
    this.sqlDb.run('INSERT INTO pessoas (nome, nis, cpf, bairro) VALUES (?, ?, ?, ?)', [
      limparTexto(nome),
      normalizarDoc(nis),
      normalizarDoc(cpf),
      bairro ? bairro.trim() : null,
    ]);
    const id = consultarUma(this.sqlDb, 'SELECT last_insert_rowid() AS id').id;
    this.persistir();
    return this.buscarPessoaPorId(id);
  }

  atualizarPessoa(id, { nome, nis, cpf, bairro }) {
    this.sqlDb.run('UPDATE pessoas SET nome = ?, nis = ?, cpf = ?, bairro = ? WHERE id = ?', [
      limparTexto(nome),
      normalizarDoc(nis),
      normalizarDoc(cpf),
      bairro ? bairro.trim() : null,
      id,
    ]);
    this.persistir();
    return this.buscarPessoaPorId(id);
  }

  // Histórico de atendimentos de uma pessoa dentro de um ano (padrão: ano corrente).
  historicoDoAno(pessoaId, ano) {
    return consultarTodas(
      this.sqlDb,
      `SELECT * FROM atendimentos
       WHERE pessoa_id = ? AND strftime('%Y', data) = ?
       ORDER BY data DESC, id DESC`,
      [pessoaId, String(ano)]
    );
  }

  registrarAtendimento({ pessoaId, data, tipo, bairro, obs, atendente }) {
    this.sqlDb.run(
      'INSERT INTO atendimentos (pessoa_id, data, tipo, bairro, obs, atendente) VALUES (?, ?, ?, ?, ?, ?)',
      [pessoaId, data, tipo, limparTexto(bairro), limparTexto(obs), limparTexto(atendente)]
    );
    const id = consultarUma(this.sqlDb, 'SELECT last_insert_rowid() AS id').id;
    this.persistir();
    return consultarUma(this.sqlDb, 'SELECT * FROM atendimentos WHERE id = ?', [id]);
  }

  // Já existe atendimento igual (mesma pessoa, data e tipo)? Evita duplicidade.
  existeAtendimentoIgual({ pessoaId, data, tipo }) {
    return !!consultarUma(
      this.sqlDb,
      'SELECT id FROM atendimentos WHERE pessoa_id = ? AND data = ? AND tipo = ? LIMIT 1',
      [pessoaId, data, tipo]
    );
  }

  listarAtendentes() {
    return consultarTodas(
      this.sqlDb,
      `SELECT DISTINCT atendente FROM atendimentos
       WHERE atendente IS NOT NULL AND atendente <> '' ORDER BY atendente`
    ).map((l) => l.atendente);
  }

  buscarAtendimentoPorId(id) {
    return consultarUma(this.sqlDb, 'SELECT * FROM atendimentos WHERE id = ?', [id]);
  }

  // Corrige um atendimento já registrado (erro de digitação, tipo errado, etc.).
  atualizarAtendimento(id, { data, tipo, bairro, obs }) {
    this.sqlDb.run('UPDATE atendimentos SET data = ?, tipo = ?, bairro = ?, obs = ? WHERE id = ?', [
      data,
      tipo,
      bairro ? bairro.trim() : null,
      obs ? obs.trim() : null,
      id,
    ]);
    this.persistir();
    return this.buscarAtendimentoPorId(id);
  }

  // Remove um atendimento (duplicado ou registrado por engano).
  excluirAtendimento(id) {
    this.sqlDb.run('DELETE FROM atendimentos WHERE id = ?', [id]);
    this.persistir();
  }

  // Bairros/localidades para sugerir no formulário: começa com a lista
  // conhecida (BAIRROS_SUGERIDOS) e cresce com o que a recepção for
  // digitando de fato — sem travar numa lista fixa que pode não cobrir
  // tudo (Extremoz não tem divisão oficial de bairros).
  listarBairros() {
    const linhas = consultarTodas(
      this.sqlDb,
      `SELECT bairro FROM (
         SELECT bairro FROM pessoas WHERE bairro IS NOT NULL AND bairro <> ''
         UNION
         SELECT bairro FROM atendimentos WHERE bairro IS NOT NULL AND bairro <> ''
       )`
    );
    const usados = linhas.map((l) => l.bairro);
    const combinados = [...new Set([...BAIRROS_SUGERIDOS, ...usados])];
    return combinados.sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  // Lista atendimentos num período, com dados da pessoa, para relatórios.
  listarAtendimentos({ dataInicio, dataFim, tipo }) {
    const condicoes = ['a.data BETWEEN ? AND ?'];
    const params = [dataInicio, dataFim];
    if (tipo) {
      condicoes.push('a.tipo = ?');
      params.push(tipo);
    }
    return consultarTodas(
      this.sqlDb,
      `SELECT a.id, a.data, a.tipo, a.bairro, a.obs, a.atendente, a.pessoa_id,
              p.nome AS pessoa_nome, p.nis, p.cpf
       FROM atendimentos a
       JOIN pessoas p ON p.id = a.pessoa_id
       WHERE ${condicoes.join(' AND ')}
       ORDER BY a.data ASC, a.id ASC`,
      params
    );
  }

  // Respeita o mesmo filtro de tipo da listagem, para o resumo bater com o total.
  totaisPorTipo({ dataInicio, dataFim, tipo = null }) {
    return consultarTodas(
      this.sqlDb,
      `SELECT tipo, COUNT(*) AS total
       FROM atendimentos
       WHERE data BETWEEN ? AND ? AND (? IS NULL OR tipo = ?)
       GROUP BY tipo
       ORDER BY total DESC, tipo ASC`,
      [dataInicio, dataFim, tipo, tipo]
    );
  }

  totaisPorDia({ dataInicio, dataFim }) {
    return consultarTodas(
      this.sqlDb,
      `SELECT data, COUNT(*) AS total
       FROM atendimentos
       WHERE data BETWEEN ? AND ?
       GROUP BY data
       ORDER BY data ASC`,
      [dataInicio, dataFim]
    );
  }
}

module.exports = {
  semAcento,
  abrirBanco,
  Repositorio,
  TIPOS_ATENDIMENTO,
  BAIRROS_SUGERIDOS,
  backupDiario,
  validarDocumentos,
  cpfValido,
  normalizarDoc,
  salvar,
};
