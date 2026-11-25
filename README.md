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

## Como funciona o atendimento

1. A atendente escreve o nome dela no topo (fica salvo no computador).
2. Busca a pessoa por NIS ou CPF. O sistema mostra um cartão "Pessoa encontrada"
   ou "Novo cadastro" e só então libera o formulário.
3. Se o NIS/CPF for alterado depois da busca, o formulário some até buscar de novo
   (impede registrar no cadastro de outra pessoa).
4. Atendimento igual (mesma pessoa, data e tipo) pede confirmação.
5. "Excluir" só aparece depois de clicar em "Editar", e pede confirmação.

Busca por nome ignora acentos e maiúsculas ("jose" acha "José").
Relatórios mostram total de atendimentos, pessoas diferentes e a atendente.

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

- Versão em rede (FastAPI + PostgreSQL) se passar a ter mais de um computador.
