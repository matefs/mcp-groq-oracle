import { createInterface } from "node:readline/promises";
import { createAgent } from "./agent.ts";

const agent = await createAgent();
const rl = createInterface({ input: process.stdin, output: process.stdout });
console.log("Pergunte sobre o banco Oracle (digite 'sair' para encerrar).");
while (true) {
  const q = (await rl.question("\n> ")).trim();
  if (!q) continue;
  if (q.toLowerCase() === "sair") break;
  try {
    const { answer, apiCalls } = await agent.ask(q);
    console.log(`\n${answer}\n\n[chamadas Groq: ${apiCalls}]`);
  } catch (e) {
    console.error("Erro:", (e as Error).message);
  }
}
rl.close();
await agent.close();
