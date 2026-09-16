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

  return { sqlDb, dbPath };
}

function salvar({ sqlDb, dbPath }) {
  const dados = sqlDb.export();
  fs.writeFileSync(dbPath, Buffer.from(dados));
}

function normalizarDoc(valor) {
  if (!valor) return null;
  const digitos = String(valor).replace(/\D/g, '');
  return digitos.length ? digitos : null;
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
    return consultarTodas(
      this.sqlDb,
      `SELECT * FROM pessoas
       WHERE nome LIKE :nome
          OR (:doc IS NOT NULL AND nis = :doc)
          OR (:doc IS NOT NULL AND cpf = :doc)
       ORDER BY nome ASC
       LIMIT 50`,
      { ':nome': `%${bruto}%`, ':doc': digitos }
    );
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
      nome.trim(),
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
      nome.trim(),
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

  registrarAtendimento({ pessoaId, data, tipo, bairro, obs }) {
    this.sqlDb.run('INSERT INTO atendimentos (pessoa_id, data, tipo, bairro, obs) VALUES (?, ?, ?, ?, ?)', [
      pessoaId,
      data,
      tipo,
      bairro ? bairro.trim() : null,
      obs ? obs.trim() : null,
    ]);
    const id = consultarUma(this.sqlDb, 'SELECT last_insert_rowid() AS id').id;
    this.persistir();
    return consultarUma(this.sqlDb, 'SELECT * FROM atendimentos WHERE id = ?', [id]);
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
      `SELECT a.id, a.data, a.tipo, a.bairro, a.obs,
              p.nome AS pessoa_nome, p.nis, p.cpf
       FROM atendimentos a
       JOIN pessoas p ON p.id = a.pessoa_id
       WHERE ${condicoes.join(' AND ')}
       ORDER BY a.data ASC, a.id ASC`,
      params
    );
  }

  totaisPorTipo({ dataInicio, dataFim }) {
    return consultarTodas(
      this.sqlDb,
      `SELECT tipo, COUNT(*) AS total
       FROM atendimentos
       WHERE data BETWEEN ? AND ?
       GROUP BY tipo`,
      [dataInicio, dataFim]
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

module.exports = { abrirBanco, Repositorio, TIPOS_ATENDIMENTO, BAIRROS_SUGERIDOS };
