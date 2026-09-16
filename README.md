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
- **SQLite** (via `better-sqlite3`) — banco de dados em arquivo único,
  guardado em `%APPDATA%/cadunico-atendimentos/cadunico.db`. Sem servidor,
  sem internet, sem login.
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

## Próximos passos possíveis

- Empacotar um instalador `.exe` (electron-builder) para distribuir sem
  precisar do Node instalado na recepção.
- Botão de backup/restauração do arquivo do banco.
- Edição/exclusão de atendimentos já registrados.
