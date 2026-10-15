# MCP Groq Oracle

Pergunte em linguagem natural sobre um banco Oracle. Um LLM da [Groq](https://groq.com) usa tools de um servidor **MCP** (Model Context Protocol) para inspecionar o schema e rodar queries `SELECT`. **Sem embeddings, sem RAG**: o modelo gera o SQL na hora.

```
Navegador / CLI ──► agent (Groq, tool calling) ──► MCP client ──stdio──► server.ts ──► Oracle (somente SELECT)
```

## Requisitos
- Node.js 20+
- Chave da Groq: https://console.groq.com/keys

## Instalação
```bash
git clone https://github.com/matefs/mcp-groq-oracle.git
cd mcp-groq-oracle
npm install
cp .env.example .env     # edite e coloque sua GROQ_TOKEN
```
Preencha no `.env` os dados do Oracle (`ORACLE_HOST`, `ORACLE_PORT`, `ORACLE_SID`, `ORACLE_USER`, `ORACLE_PASSWORD`, `ORACLE_SCHEMAS`). Usa o driver `oracledb` em modo thin: não precisa de Oracle Client.

## Uso
| Comando | O que faz |
|---|---|
| `npm start` | Interface web em http://localhost:3000 |
| `npm run cli` | Chat interativo no terminal |
| `npm run ask -- -v "pergunta"` | Uma pergunta e sai (`-v` mostra as tool calls) |
| `npm test` | Testes contra o Oracle (conexão, metadados, bloqueio de escrita); sem chamadas à Groq |
| `npm run test:e2e` | Idem + 1 pergunta com LLM |

Exemplos: *"Quais tabelas do schema OBRA existem?"*, *"Qual tabela guarda fornecedores?"*.

## Configuração (`.env`)
| Variável | Padrão | Descrição |
|---|---|---|
| `GROQ_TOKEN` (ou `GROQ_API_KEY`) | – | Chave da Groq |
| `ORACLE_*` | – | Conexão (host, porta, SID, usuário, senha) |
| `ORACLE_SCHEMAS` | todos | Schemas padrão do `list_tables` (separados por vírgula) |
| `ROW_LIMIT` | `100` | Máx. de linhas por consulta |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Modelo com suporte a tool calling |
| `PORT` | `3000` | Porta da web |

## Tools MCP ([server.ts](server.ts))
- `list_tables`: tabelas (owner, nome, comentário) com filtro `search`/`owner` e total real.
- `get_table_schema`: colunas, PK e FKs de uma tabela.
- `execute_readonly_query`: só `SELECT`/`WITH`, uma instrução, limitado a `ROW_LIMIT` linhas.

## Segurança
- Queries validadas (somente `SELECT`/`WITH`, sem `;`, sem DML/DDL/PLSQL) e sessão com `SET TRANSACTION READ ONLY`. Use de preferência um usuário Oracle só com SELECT.
- A web escuta apenas em `127.0.0.1` e **não tem autenticação**: não exponha na internet.
- Cada pergunta usa em geral 2 a 6 chamadas à Groq; o loop é limitado a 10 rodadas.
- Nunca commite o `.env` (já está no `.gitignore`).

## Estrutura
`server.ts` servidor MCP · `oracle-repository.ts` consultas Oracle · `readonly-query-guard.ts` validação de SQL somente leitura · `config.ts` variáveis de ambiente · `agent.ts` loop LLM + MCP · `web.ts` + `chat-page.html` interface web · `client.ts` CLI interativo · `cli.ts` pergunta única · `test.ts` testes
