// Script de apoio: popula o banco com pessoas e atendimentos FICTÍCIOS,
// só para testar a interface. Roda fora do Electron (Node puro).
//
// Uso:  node scripts/seed-teste.js --sim-dados-ficticios
//
// Aponta para o MESMO arquivo de banco que o app usa
// (%APPDATA%/cadunico-atendimentos/cadunico.db). Feche o app antes de rodar
// este script, senão o app pode sobrescrever os dados ao salvar de novo.

const path = require('path');
const os = require('os');
const { abrirBanco, Repositorio, TIPOS_ATENDIMENTO } = require('../src/db');

if (!process.argv.includes('--sim-dados-ficticios')) {
  console.error(
    'ATENÇÃO: este script grava dados FICTÍCIOS no banco real do app.\n' +
      'Nunca rode no computador da recepção. Para rodar mesmo assim:\n' +
      '  node scripts/seed-teste.js --sim-dados-ficticios'
  );
  process.exit(1);
}

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'cadunico-atendimentos', 'cadunico.db');

// Localidades reais de Extremoz/RN (não há bairros oficiais no município,
// que é de distrito único — ver BAIRROS_SUGERIDOS em src/db.js).
const BAIRROS = [
  'Centro', 'Área Litorânea', 'Central Parque I', 'Povoado de Araçá',
  'Pitangui', 'Genipabu', 'Santa Rita', 'Barra do Rio', 'Vila de Fátima',
];

const PESSOAS = [
  { nome: 'Maria José da Silva', nis: '12345678901', cpf: '', bairro: 'Centro' },
  { nome: 'João Pedro Oliveira', nis: '23456789012', cpf: '', bairro: 'Central Parque I' },
  { nome: 'Francisca das Chagas Souza', nis: '34567890123', cpf: '', bairro: 'Genipabu' },
  { nome: 'Antônio Carlos Ferreira', nis: '', cpf: '11122233344', bairro: 'Área Litorânea' },
  { nome: 'Rita de Cássia Lima', nis: '45678901234', cpf: '', bairro: 'Pitangui' },
  { nome: 'José Ribamar Costa', nis: '56789012345', cpf: '', bairro: 'Vila de Fátima' },
  { nome: 'Ana Paula Nascimento', nis: '', cpf: '22233344455', bairro: 'Povoado de Araçá' },
  { nome: 'Severino Barbosa dos Santos', nis: '67890123456', cpf: '', bairro: 'Santa Rita' },
  { nome: 'Luciana Maria dos Anjos', nis: '78901234567', cpf: '', bairro: 'Barra do Rio' },
  { nome: 'Raimundo Nonato Pereira', nis: '89012345678', cpf: '', bairro: 'Centro' },
  { nome: 'Cícera Alves Bezerra', nis: '90123456789', cpf: '', bairro: 'Central Parque I' },
  { nome: 'Francisco das Chagas Medeiros', nis: '', cpf: '33344455566', bairro: 'Genipabu' },
];

const TIPOS = TIPOS_ATENDIMENTO.map((t) => t.valor);

function dataAleatoria(ano, mesMin = 1, mesMax = 12) {
  const mes = mesMin + Math.floor(Math.random() * (mesMax - mesMin + 1));
  const dia = 1 + Math.floor(Math.random() * 27);
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function sorteia(lista) {
  return lista[Math.floor(Math.random() * lista.length)];
}

async function main() {
  const banco = await abrirBanco(dbPath);
  const repo = new Repositorio(banco);

  console.log('Banco:', dbPath);
  let totalPessoas = 0;
  let totalAtendimentos = 0;

  for (const dados of PESSOAS) {
    const pessoa = repo.criarPessoa(dados);
    totalPessoas++;

    // 1 a 4 atendimentos em 2026 (ano corrente, aparece no histórico "deste ano")
    const qtd2026 = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < qtd2026; i++) {
      repo.registrarAtendimento({
        pessoaId: pessoa.id,
        data: dataAleatoria(2026, 1, 9), // até setembro/2026 (hoje)
        tipo: sorteia(TIPOS),
        bairro: dados.bairro,
        obs: '',
      });
      totalAtendimentos++;
    }

    // 0 a 2 atendimentos em 2025 (ano anterior, para testar que o histórico
    // "deste ano" não mistura anos)
    const qtd2025 = Math.floor(Math.random() * 3);
    for (let i = 0; i < qtd2025; i++) {
      repo.registrarAtendimento({
        pessoaId: pessoa.id,
        data: dataAleatoria(2025),
        tipo: sorteia(TIPOS),
        bairro: dados.bairro,
        obs: '',
      });
      totalAtendimentos++;
    }
  }

  console.log(`Pronto! ${totalPessoas} pessoas e ${totalAtendimentos} atendimentos fictícios inseridos.`);
  console.log('Exemplos para testar a busca:');
  console.log('  NIS 12345678901  -> Maria José da Silva');
  console.log('  CPF 11122233344  -> Antônio Carlos Ferreira');
}

main().catch((e) => {
  console.error('Falhou:', e);
  process.exit(1);
});
