/**
 * The Ask panel's suggested questions, from the page on screen (the shell's
 * AgentContext). Each one is a read the agent answers with its tools against the
 * live chain; none asks for a transaction. The prompt carries the full id so the
 * agent can call the right tool; the label shows a short form.
 *
 * Pure: no data is fetched here. Data source of the answers: the agent's tools
 * (live RPC, the indexer, the verification store).
 */
import type { AgentContext } from "./agentContext";
import { shortHash } from "./format";

export interface AskSuggestion {
  label: string;
  prompt: string;
}

const s = (label: string, prompt: string = label): AskSuggestion => ({ label, prompt });

const NETWORK: AskSuggestion[] = [
  s("What are the current blue score and tips?", "What are the current max blue score, the number of DAG tips, and the latest height on Citrate?"),
  s("How does GHOSTDAG order blocks here?"),
  s("Show the latest blocks and their merge parents", "Show the latest blocks with their selected parent and merge parents."),
];

export function askSuggestions(ctx: AgentContext): AskSuggestion[] {
  const id = ctx.id;
  const sh = id ? (id.startsWith("0x") ? shortHash(id, 8, 4) : id) : "";
  switch (ctx.kind) {
    case "block":
      if (!id) break;
      return [
        s(`Explain block ${sh}`, `Explain block ${id}: its selected parent, merge parents, blue score and transactions.`),
        s(`Is block ${sh} blue or red?`, `Is block ${id} blue or red in GHOSTDAG, and why?`),
        s(`How far is block ${sh} from finality?`, `How far is block ${id} from finality on Citrate?`),
      ];
    case "tx":
      if (!id) break;
      return [
        s(`Explain transaction ${sh}`, `Explain transaction ${id}.`),
        s(`Decode its call and events`, `Decode the call and the events of transaction ${id}.`),
        s(`Did it succeed, and what did it cost?`, `Did transaction ${id} succeed, and what did it cost in SALT?`),
      ];
    case "address":
      if (!id) break;
      return [
        s(`What is at ${sh}?`, `Is ${id} a contract or a wallet, and what is its SALT balance?`),
        s(`Recent activity of ${sh}`, `What has ${id} done recently on Citrate?`),
      ];
    case "contract":
      if (!id) break;
      return [
        s(`What does ${sh} do?`, `What does the contract ${id} do? Is it verified?`),
        s(`Is ${sh} a proxy?`, `Is ${id} a proxy? If so, which implementation does it delegate to?`),
        s(`What are its risky functions?`, `Which functions of ${id} change state, and which of them carry approval, ownership or upgrade risk?`),
      ];
    case "token":
      if (!id) break;
      return [
        s(`What is token ${sh}?`, `What are the name, symbol, decimals and total supply of the token ${id}?`),
        s(`Is ${sh} verified?`, `Is the token contract ${id} verified, and is it a proxy?`),
      ];
    case "dag":
      return id
        ? [
            s(`Explain the mergeset of ${sh}`, `Explain the mergeset of block ${id}: which blocks are blue, which are red, and why.`),
            s(`Where is ${sh} on the selected chain?`, `Is block ${id} on the selected chain, and what is its selected parent?`),
          ]
        : [
            s("What is the red-block rate right now?", "What share of recent blocks are red, and what does that mean for the DAG?"),
            s("How does GHOSTDAG pick the selected parent?"),
            s("How many merge parents do recent blocks have?", "How many merge parents do the most recent blocks have on average?"),
          ];
    case "verify":
      return [
        s("How do I verify a contract's source?", "How do I verify and publish a contract's source on CitrateScan?"),
        s("What is a partial match?", "What is the difference between a verified match and a partial match?"),
      ];
    case "agents":
      return [s("Which agents are registered?", "Which agents are registered on Citrate, and what do they do?"), s("What is an AgentSBT?")];
    case "agent":
      if (!id) break;
      return [s(`What does agent ${sh} do?`, `What does registered agent ${id} do, and who owns it?`), s(`Recent activity of agent ${sh}`, `What has registered agent ${id} done recently?`)];
    case "developer":
      return [
        s("How do I call the REST API?", "How do I call CitrateScan's REST API with an API key? Show an example."),
        s("How do I connect my agent over MCP?", "How do I connect my own agent to CitrateScan's MCP endpoint?"),
      ];
    default:
      break;
  }
  return NETWORK;
}
