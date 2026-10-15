import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import Groq from "groq-sdk";
import { createInterface } from "node:readline/promises";

const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY ?? process.env.GROQ_TOKEN,
});

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "server.ts"],
  cwd: process.cwd(),
});

const mcpClient = new Client(
  {
    name: "groq-mcp-orchestrator",
    version: "1.0.0",
  },
  {
    capabilities: {},
  }
);

await mcpClient.connect(transport);

const { tools: availableMcpTools } = await mcpClient.listTools();

const groqFormattedTools = availableMcpTools.map((mcpTool) => ({
  type: "function" as const,
  function: {
    name: mcpTool.name,
    description: mcpTool.description,
    parameters: mcpTool.inputSchema,
  },
}));

let apiCalls = 0;

async function executeAgentTurn(userPrompt: string): Promise<string> {
  const conversationHistory: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: "Voce e um analista de banco de dados SQLite. Inspecione tabelas e schemas antes de gerar e executar queries. Responda em portugues de forma clara com base nos resultados.",
    },
    {
      role: "user",
      content: userPrompt,
    },
  ];

  for (let round = 0; round < 8; round++) {
    apiCalls++;
    const chatResponse = await groqClient.chat.completions.create({
      model: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
      messages: conversationHistory,
      tools: groqFormattedTools,
      tool_choice: "auto",
    });

    const choiceMessage = chatResponse.choices[0].message;
    conversationHistory.push(choiceMessage);

    if (!choiceMessage.tool_calls || choiceMessage.tool_calls.length === 0) {
      return choiceMessage.content || "";
    }

    for (const toolCall of choiceMessage.tool_calls) {
      const toolName = toolCall.function.name;
      const parsedArguments = JSON.parse(toolCall.function.arguments);

      const mcpResult = await mcpClient.callTool({
        name: toolName,
        arguments: parsedArguments,
      });

      const responseText = mcpResult.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");

      conversationHistory.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: responseText,
      });
    }
  }
  return "Limite de rodadas atingido.";
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("Pergunte sobre o banco (digite 'sair' para encerrar).");
while (true) {
  const q = (await rl.question("\n> ")).trim();
  if (!q) continue;
  if (q.toLowerCase() === "sair") break;
  try {
    apiCalls = 0;
    console.log("\n" + (await executeAgentTurn(q)));
    console.log(`\n[chamadas Groq: ${apiCalls}]`);
  } catch (e) {
    console.error("Erro:", (e as Error).message);
  }
}
rl.close();
await mcpClient.close();
