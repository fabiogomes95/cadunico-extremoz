# Controle de Atendimentos — Cadastro Único (Extremoz/RN)

App desktop (Electron) para substituir a planilha do Word usada na recepção do
Cadastro Único. Registra cada atendimento, mostra o histórico da pessoa no ano
e gera relatórios (dia/mês/ano, por tipo) com exportação para Excel/CSV.

## Como rodar (desenvolvimento)

```
npm install
npm start
```

## Tecnologia

- **Electron** — janela desktop, roda local no computador da recepção.
- **SQLite** (via `sql.js`, WebAssembly) — banco de dados em arquivo único,
  guardado em `%APPDATA%/cadunico-atendimentos/cadunico.db`. Sem servidor,
  sem internet, sem login. Feito para rodar em **um único computador**.
- **xlsx** — exportação dos relatórios para Excel (.xlsx) ou CSV.

## Estrutura

```
src/
  main.js         processo principal do Electron (janela + IPC)
  preload.js      ponte segura entre a tela e o banco de dados
  db.js           schema e consultas SQLite
  renderer/        interface (HTML/CSS/JS puro, sem framework)
```

## Dados guardados

- **Pessoa**: nome, NIS, CPF, bairro.
- **Atendimento**: pessoa, data, tipo (inclusão, atualização, transferência,
  consulta, folha resumo, declaração), bairro no momento, observação.

## Segurança dos dados

- **Backup automático**: toda vez que o app abre, guarda uma cópia do dia em
  `%APPDATA%/cadunico-atendimentos/backups/` (mantém as últimas 30).
- **Backup manual**: botão "Fazer backup" na aba Relatórios (ex.: salvar num pendrive).
- **Restaurar**: feche o app e copie o backup escolhido por cima de `cadunico.db`.
- Gravação atômica (arquivo temporário + troca) para não corromper o banco se faltar energia.
- O app só abre uma janela por vez (duas instâncias apagariam dados uma da outra).
- `scripts/seed-teste.js` grava dados fictícios — **nunca rodar no PC da recepção**.

## Gerar o instalador

```
npm run dist
```

O `.exe` sai em `dist/`. Sem assinatura digital, o Windows mostra o aviso do
SmartScreen na primeira instalação ("Mais informações" → "Executar assim mesmo").

## Próximos passos possíveis

- Campo "atendente" (quem registrou).
- Aviso de atendimento repetido (mesma pessoa, mesmo tipo, mesmo dia).
- Versão em rede (FastAPI + PostgreSQL) se passar a ter mais de um computador.
