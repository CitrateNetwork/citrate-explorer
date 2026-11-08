/**
 * ABI guessing for unverified code (EXP-S3): whatsabi (MIT, @shazow/whatsabi)
 * finds selectors, payability/mutability hints and event topics in the bytecode;
 * the bundled signature subset names them. Pure and offline: whatsabi's network
 * loaders are never used, so nothing is fetched at runtime.
 */
import { abiFromBytecode } from "@shazow/whatsabi";
import type { Abi, AbiEvent, AbiFunction, Hex } from "viem";
import { canonicalSignature, lookupEvent, lookupFunction } from "./signatures";

export interface GuessedFunction {
  selector: Hex;
  /** The first matching signature from the subset (its own mutability); null if unknown. */
  resolved: AbiFunction | null;
  /** Other signatures in the subset with the same selector and different types. */
  alternatives: AbiFunction[];
  /** whatsabi's payability hint from the bytecode (unreliable for via-IR code). */
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
      // whatsabi's payability is a bytecode hint; via-IR code (no CALLVALUE check before
      // dispatch) reads as payable everywhere, so the subset's mutability is kept as is.
      const payable = item.payable === true || item.stateMutability === "payable";
      const first = hits[0] ?? null;
      const firstSig = first ? canonicalSignature(first) : null;
      const alternatives = hits.slice(1).filter((h) => canonicalSignature(h) !== firstSig);
      functions.push({ selector, resolved: first, alternatives, payable, stateMutability: item.stateMutability ?? null });
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
