import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Groq from "groq-sdk";
import { TOOL_NAMES, defaultOracleSchemas, groqApiKey, groqModelName } from "./config.ts";

type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;
type AssistantMessage = Groq.Chat.Completions.ChatCompletionMessage;
type GroqToolCall = Groq.Chat.Completions.ChatCompletionMessageToolCall;

export type ExecutedToolCall = { name: string; args: Record<string, unknown>; result: string };
export type AgentAnswer = { answer: string; calls: ExecutedToolCall[]; apiCalls: number };
type RecoveredToolCall = { name: string; args: Record<string, unknown> };

const MAX_COMPLETION_ROUNDS = 10;
const MAX_TOOL_CALL_RECOVERIES = 2;
const VERBOSE_RESULT_PREVIEW_LENGTH = 200;

const SYSTEM_PROMPT = `Voce e um analista de dados de um banco Oracle (somente leitura). Schemas principais: ${defaultOracleSchemas.join(", ")}. Fluxo: 1) list_tables com 'search' para achar tabelas relevantes (as tabelas se chamam em portugues/abreviacoes; use comentarios); 2) get_table_schema apenas das tabelas necessarias; 3) execute_readonly_query com UMA query. Sintaxe Oracle: sem LIMIT (use FETCH FIRST n ROWS ONLY), nomes OWNER.TABELA, strings com aspas simples. Nunca peca esclarecimentos: se o termo for ambiguo, procure no dicionario (list_tables com search) e tente a interpretacao mais provavel. Seja economico: poucas chamadas de ferramenta. Responda em portugues, de forma clara, com base nos resultados.`;

function inferToolNameFromArguments(toolArguments: Record<string, unknown>): string {
  if (toolArguments.sqlQuery) return TOOL_NAMES.executeReadonlyQuery;
  if (toolArguments.tableName) return TOOL_NAMES.getTableSchema;
  return TOOL_NAMES.listTables;
}

export function recoverToolCallFromGroqError(groqError: any): RecoveredToolCall | null {
  const errorBody = groqError?.error?.error ?? groqError?.error ?? {};
  if (errorBody.code !== "tool_use_failed" || !errorBody.failed_generation) return null;
  try {
    const failedGeneration = JSON.parse(errorBody.failed_generation);
    const toolArguments: Record<string, unknown> = failedGeneration.arguments ?? {};
    const inferredToolName = inferToolNameFromArguments(toolArguments);
    const hasListTablesEvidence =
      failedGeneration.name === TOOL_NAMES.listTables || "owner" in toolArguments || "search" in toolArguments;
    if (inferredToolName === TOOL_NAMES.listTables && !hasListTablesEvidence) return null;
    return { name: inferredToolName, args: toolArguments };
  } catch {
    return null;
  }
}

function removeNullArguments(rawArgumentsJson: string): Record<string, unknown> {
  const parsedArguments = JSON.parse(rawArgumentsJson || "{}");
  return Object.fromEntries(Object.entries(parsedArguments).filter(([, value]) => value !== null));
}

function extractTextFromMcpToolResult(mcpToolResult: any): string {
  return mcpToolResult.content
    .filter((contentItem: any) => contentItem.type === "text")
    .map((contentItem: any) => contentItem.text)
    .join("\n");
}

function buildAssistantMessageFromRecoveredCall(recoveredCall: RecoveredToolCall, roundIndex: number): AssistantMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: `rec_${roundIndex}`,
        type: "function",
        function: { name: recoveredCall.name, arguments: JSON.stringify(recoveredCall.args) },
      },
    ],
  };
}

async function connectToMcpServer(): Promise<Client> {
  const mcpClient = new Client({ name: "groq-mcp-cli", version: "1.0.0" }, { capabilities: {} });
  await mcpClient.connect(
    new StdioClientTransport({
      command: "npx",
      args: ["tsx", "server.ts"],
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    }),
  );
  return mcpClient;
}

export async function createAgent(options: { verbose?: boolean } = {}) {
  const groqClient = new Groq({ apiKey: groqApiKey });
  const mcpClient = await connectToMcpServer();
  const { tools: mcpTools } = await mcpClient.listTools();
  const groqToolDefinitions = mcpTools.map((mcpTool) => ({
    type: "function" as const,
    function: { name: mcpTool.name, description: mcpTool.description, parameters: mcpTool.inputSchema },
  }));

  async function requestNextAssistantMessage(
    conversation: ChatMessage[],
    roundIndex: number,
    recoveryState: { recoveriesUsed: number },
  ): Promise<AssistantMessage> {
    try {
      const completion = await groqClient.chat.completions.create({
        model: groqModelName,
        messages: conversation,
        tools: groqToolDefinitions,
        tool_choice: "auto",
      });
      return completion.choices[0].message;
    } catch (groqError) {
      const recoveredCall = recoverToolCallFromGroqError(groqError);
      if (!recoveredCall || recoveryState.recoveriesUsed >= MAX_TOOL_CALL_RECOVERIES) throw groqError;
      recoveryState.recoveriesUsed++;
      return buildAssistantMessageFromRecoveredCall(recoveredCall, roundIndex);
    }
  }

  async function executeToolCall(toolCall: GroqToolCall): Promise<ExecutedToolCall> {
    const toolArguments = removeNullArguments(toolCall.function.arguments);
    const mcpToolResult = await mcpClient.callTool({ name: toolCall.function.name, arguments: toolArguments });
    const resultText = extractTextFromMcpToolResult(mcpToolResult);
    if (options.verbose) {
      const resultPreview = resultText.slice(0, VERBOSE_RESULT_PREVIEW_LENGTH).replace(/\s+/g, " ");
      console.error(`[tool] ${toolCall.function.name} ${JSON.stringify(toolArguments)}\n       -> ${resultPreview}`);
    }
    return { name: toolCall.function.name, args: toolArguments, result: resultText };
  }

  async function ask(question: string): Promise<AgentAnswer> {
    const conversation: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: question },
    ];
    const executedToolCalls: ExecutedToolCall[] = [];
    const recoveryState = { recoveriesUsed: 0 };

    for (let roundIndex = 0; roundIndex < MAX_COMPLETION_ROUNDS; roundIndex++) {
      const assistantMessage = await requestNextAssistantMessage(conversation, roundIndex, recoveryState);
      conversation.push(assistantMessage);
      if (!assistantMessage.tool_calls?.length) {
        return { answer: assistantMessage.content ?? "", calls: executedToolCalls, apiCalls: roundIndex + 1 };
      }
      for (const toolCall of assistantMessage.tool_calls) {
        const executedToolCall = await executeToolCall(toolCall);
        executedToolCalls.push(executedToolCall);
        conversation.push({ role: "tool", tool_call_id: toolCall.id, content: executedToolCall.result });
      }
    }
    throw new Error("Limite de iteracoes atingido");
  }

  return { ask, mcpClient, close: () => mcpClient.close() };
}
