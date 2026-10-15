import { createAgent } from "./agent.ts";

const args = process.argv.slice(2);
const verbose = args.includes("-v") || args.includes("--verbose");
const question = args.filter((a) => !a.startsWith("-")).join(" ");
if (!question) {
  console.error('Uso: npm run ask -- [-v] "sua pergunta"');
  process.exit(2);
}
const agent = await createAgent({ verbose });
try {
  console.log((await agent.ask(question)).answer);
} finally {
  await agent.close();
}
