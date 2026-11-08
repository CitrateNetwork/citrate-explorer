/**
 * ABI guessing for unverified code (EXP-S3): whatsabi (MIT, @shazow/whatsabi)
 * finds selectors, payability/mutability hints and event topics in the bytecode;
 * the bundled signature subset names them. Pure and offline: whatsabi's network
 * loaders are never used, so nothing is fetched at runtime.
 */
import { abiFromBytecode } from "@shazow/whatsabi";
import type { Abi, AbiEvent, AbiFunction, Hex } from "viem";
import { lookupEvent, lookupFunction } from "./signatures";

export interface GuessedFunction {
  selector: Hex;
  /** The first matching signature from the subset, with whatsabi's payability applied; null if unknown. */
  resolved: AbiFunction | null;
  /** Other signatures in the subset with the same selector. */
  alternatives: AbiFunction[];
  payable: boolean;
  /** whatsabi's mutability hint, from the bytecode. */
  stateMutability: AbiFunction["stateMutability"] | null;
}

export interface AbiGuess {
  functions: GuessedFunction[];
  eventTopics: Hex[];
  events: AbiEvent[];
  /** A usable ABI made only of resolved entries. */
  abi: Abi;
}

export function guessAbi(runtimeCode: string): AbiGuess {
  if (!runtimeCode || runtimeCode === "0x") return { functions: [], eventTopics: [], events: [], abi: [] };
  let raw: ReturnType<typeof abiFromBytecode>;
  try {
    raw = abiFromBytecode(runtimeCode);
  } catch {
    return { functions: [], eventTopics: [], events: [], abi: [] };
  }
  const functions: GuessedFunction[] = [];
  const eventTopics: Hex[] = [];
  const events: AbiEvent[] = [];
  for (const item of raw) {
    if (item.type === "function") {
      const selector = item.selector.toLowerCase() as Hex;
      const hits = lookupFunction(selector);
      const payable = item.payable === true || item.stateMutability === "payable";
      // The subset's mutability wins (it comes from a real ABI); payability from the code is added when the subset says nonpayable.
      const first = hits[0]
        ? ({ ...hits[0], stateMutability: payable && hits[0].stateMutability === "nonpayable" ? "payable" : hits[0].stateMutability } as AbiFunction)
        : null;
      functions.push({ selector, resolved: first, alternatives: hits.slice(1), payable, stateMutability: item.stateMutability ?? null });
    } else if (item.type === "event") {
      const topic = item.hash.toLowerCase() as Hex;
      eventTopics.push(topic);
      const hit = lookupEvent(topic);
      events.push(...hit);
    }
  }
  functions.sort((a, b) => a.selector.localeCompare(b.selector));
  const abi: Abi = [...functions.flatMap((f) => (f.resolved ? [f.resolved] : [])), ...events];
  return { functions, eventTopics, events, abi };
}
