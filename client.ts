import { createInterface } from "node:readline/promises";
import { createAgent } from "./agent.ts";

const EXIT_COMMAND = "sair";

const agent = await createAgent();
const terminal = createInterface({ input: process.stdin, output: process.stdout });
console.log(`Pergunte sobre o banco Oracle (digite '${EXIT_COMMAND}' para encerrar).`);

while (true) {
  const question = (await terminal.question("\n> ")).trim();
  if (!question) continue;
  if (question.toLowerCase() === EXIT_COMMAND) break;
  try {
    const { answer, apiCalls } = await agent.ask(question);
    console.log(`\n${answer}\n\n[chamadas Groq: ${apiCalls}]`);
  } catch (error) {
    console.error("Erro:", (error as Error).message);
  }
}

terminal.close();
await agent.close();
