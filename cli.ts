import { createAgent } from "./agent.ts";

const commandLineArguments = process.argv.slice(2);
const isVerbose = commandLineArguments.includes("-v") || commandLineArguments.includes("--verbose");
const question = commandLineArguments.filter((argument) => !argument.startsWith("-")).join(" ");

if (!question) {
  console.error('Uso: npm run ask -- [-v] "sua pergunta"');
  process.exit(2);
}

const agent = await createAgent({ verbose: isVerbose });
try {
  const { answer } = await agent.ask(question);
  console.log(answer);
} finally {
  await agent.close();
}
