# MCP Groq SQLite

Pergunte em linguagem natural sobre um banco SQLite. Um LLM da [Groq](https://groq.com) usa tools de um servidor **MCP** (Model Context Protocol) para inspecionar o schema e rodar queries `SELECT`. **Sem embeddings, sem RAG**: o modelo gera o SQL na hora.

```
Navegador / CLI ──► agent (Groq, tool calling) ──► MCP client ──stdio──► server.ts ──► app.db (somente leitura)
```

## Requisitos
- Node.js 20+
- Chave da Groq: https://console.groq.com/keys

## Instalação
```bash
git clone https://github.com/matefs/mcp-groq-sqlite.git
cd mcp-groq-sqlite
npm install
cp .env.example .env     # edite e coloque sua GROQ_TOKEN
```
O repositório já inclui um `app.db` de exemplo (`clientes`, `produtos`, `pedidos`). Para recriá-lo: `npm run seed`.

## Uso
| Comando | O que faz |
|---|---|
| `npm start` | Interface web em http://localhost:3000 |
| `npm run cli` | Chat interativo no terminal |
| `npm run ask -- -v "pergunta"` | Uma pergunta e sai (`-v` mostra as tool calls) |
| `npm test` | Testes da camada MCP e de segurança (sem chamadas à API) |
| `npm run test:e2e` | Testes com LLM (gasta ~25 chamadas à Groq) |
| `npm run seed` | Recria o `app.db` de exemplo (apaga o atual) |

Exemplos de perguntas: *"Quais tabelas existem?"*, *"Quanto cada cliente gastou?"*, *"Qual o produto mais caro?"*.

## Usar seu próprio banco
Substitua o arquivo `app.db` na raiz (ou altere o caminho em [server.ts](server.ts)). O LLM descobre as tabelas sozinho.

## Configuração (`.env`)
| Variável | Padrão | Descrição |
|---|---|---|
| `GROQ_TOKEN` (ou `GROQ_API_KEY`) | – | Chave da Groq |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Modelo com suporte a tool calling |
| `PORT` | `3000` | Porta da web |

## Tools MCP ([server.ts](server.ts))
- `list_tables`: lista as tabelas.
- `get_table_schema`: colunas de uma tabela.
- `execute_readonly_query`: só `SELECT`/`WITH`, limitado a 100 linhas.

## Segurança
- Banco aberto com `readonly: true` e queries validadas (somente `SELECT`/`WITH`).
- A web escuta apenas em `127.0.0.1` e **não tem autenticação**: não exponha na internet.
- Cada pergunta usa em geral 2 a 6 chamadas à Groq; o loop é limitado a 8 rodadas.
- Nunca commite o `.env` (já está no `.gitignore`).

## Estrutura
`server.ts` servidor MCP · `agent.ts` loop LLM + MCP · `web.ts` interface web · `client.ts` CLI interativo · `cli.ts` pergunta única · `test.ts` testes · `seed.ts` banco de exemplo
