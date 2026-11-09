/**
 * EVM disassembler for the code pane and unverified contracts (EXP-S3). Pure.
 *
 * Covers the opcode set through Cancun (PUSH0, TLOAD/TSTORE, MCOPY, BLOBHASH,
 * BLOBBASEFEE). solc's CBOR metadata trailer is split off first, so the
 * instruction list lines up one-to-one with solc's deployedSourceMap.
 */
import { hexToBytes, type Hex } from "viem";

const NAMES: Record<number, string> = {
  0x00: "STOP", 0x01: "ADD", 0x02: "MUL", 0x03: "SUB", 0x04: "DIV", 0x05: "SDIV", 0x06: "MOD", 0x07: "SMOD",
  0x08: "ADDMOD", 0x09: "MULMOD", 0x0a: "EXP", 0x0b: "SIGNEXTEND",
  0x10: "LT", 0x11: "GT", 0x12: "SLT", 0x13: "SGT", 0x14: "EQ", 0x15: "ISZERO", 0x16: "AND", 0x17: "OR",
  0x18: "XOR", 0x19: "NOT", 0x1a: "BYTE", 0x1b: "SHL", 0x1c: "SHR", 0x1d: "SAR",
  0x20: "KECCAK256",
  0x30: "ADDRESS", 0x31: "BALANCE", 0x32: "ORIGIN", 0x33: "CALLER", 0x34: "CALLVALUE", 0x35: "CALLDATALOAD",
  0x36: "CALLDATASIZE", 0x37: "CALLDATACOPY", 0x38: "CODESIZE", 0x39: "CODECOPY", 0x3a: "GASPRICE",
  0x3b: "EXTCODESIZE", 0x3c: "EXTCODECOPY", 0x3d: "RETURNDATASIZE", 0x3e: "RETURNDATACOPY", 0x3f: "EXTCODEHASH",
  0x40: "BLOCKHASH", 0x41: "COINBASE", 0x42: "TIMESTAMP", 0x43: "NUMBER", 0x44: "PREVRANDAO", 0x45: "GASLIMIT",
  0x46: "CHAINID", 0x47: "SELFBALANCE", 0x48: "BASEFEE", 0x49: "BLOBHASH", 0x4a: "BLOBBASEFEE",
  0x50: "POP", 0x51: "MLOAD", 0x52: "MSTORE", 0x53: "MSTORE8", 0x54: "SLOAD", 0x55: "SSTORE", 0x56: "JUMP",
  0x57: "JUMPI", 0x58: "PC", 0x59: "MSIZE", 0x5a: "GAS", 0x5b: "JUMPDEST", 0x5c: "TLOAD", 0x5d: "TSTORE",
  0x5e: "MCOPY", 0x5f: "PUSH0",
  0xa0: "LOG0", 0xa1: "LOG1", 0xa2: "LOG2", 0xa3: "LOG3", 0xa4: "LOG4",
  0xf0: "CREATE", 0xf1: "CALL", 0xf2: "CALLCODE", 0xf3: "RETURN", 0xf4: "DELEGATECALL", 0xf5: "CREATE2",
  0xfa: "STATICCALL", 0xfd: "REVERT", 0xfe: "INVALID", 0xff: "SELFDESTRUCT",
};
for (let i = 1; i <= 32; i++) NAMES[0x5f + i] = `PUSH${i}`;
for (let i = 1; i <= 16; i++) {
  NAMES[0x7f + i] = `DUP${i}`;
  NAMES[0x8f + i] = `SWAP${i}`;
}

export function opcodeName(op: number): string {
  return NAMES[op] ?? `UNKNOWN_0x${op.toString(16).padStart(2, "0")}`;
}

export interface Instruction {
  /** Index in the instruction list (the source-map entry index). */
  index: number;
  pc: number;
  opcode: number;
  name: string;
  /** PUSH immediate as 0x hex. */
  push?: Hex;
  /** The PUSH immediate ran past the end of the code. */
  truncated?: boolean;
}

const toHex = (b: Uint8Array): Hex => ("0x" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")) as Hex;

/**
 * Split solc's CBOR metadata trailer off runtime code. The last two bytes are the
 * big-endian length of a CBOR map that starts with 0xa1..0xa5.
 */
export function splitMetadata(hex: string): { code: Hex; metadata: Hex | null } {
  const bytes = hexToBytes((hex.startsWith("0x") ? hex : "0x" + hex) as Hex);
  if (bytes.length >= 2) {
    const len = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
    const start = bytes.length - 2 - len;
    if (len > 0 && start >= 0 && bytes[start] >= 0xa1 && bytes[start] <= 0xa5) {
      return { code: toHex(bytes.slice(0, start)), metadata: toHex(bytes.slice(start, bytes.length - 2)) };
    }
  }
  return { code: toHex(bytes), metadata: null };
}

/** Disassemble runtime code (the metadata trailer is excluded). */
export function disassemble(hex: string): Instruction[] {
  const { code } = splitMetadata(hex);
  const b = hexToBytes(code);
  const out: Instruction[] = [];
  for (let pc = 0; pc < b.length; ) {
    const op = b[pc];
    const ins: Instruction = { index: out.length, pc, opcode: op, name: opcodeName(op) };
    if (op >= 0x60 && op <= 0x7f) {
      const n = op - 0x5f;
      const imm = b.slice(pc + 1, pc + 1 + n);
      ins.push = toHex(imm);
      if (imm.length < n) ins.truncated = true;
      pc += 1 + n;
    } else {
      pc += 1;
    }
    out.push(ins);
  }
  return out;
}

export interface DispatchEntry {
  selector: Hex;
  /** pc of the JUMPDEST the dispatcher jumps to for this selector. */
  entryPc: number;
}

/**
 * External-function entry points from the selector dispatcher: the solc pattern
 * `PUSH4 sel, (DUPn,) EQ, PUSHn dest, JUMPI` in either operand order.
 */
export function dispatcherEntries(ins: Instruction[]): DispatchEntry[] {
  const jumpdests = new Set(ins.filter((i) => i.name === "JUMPDEST").map((i) => i.pc));
  const seen = new Map<string, number>();
  for (let k = 0; k < ins.length; k++) {
    if (ins[k].name !== "PUSH4" || !ins[k].push) continue;
    let j = k + 1;
    if (ins[j]?.name.startsWith("DUP")) j++;
    if (ins[j]?.name !== "EQ") continue;
    const dest = ins[j + 1];
    if (!dest?.push || !dest.name.startsWith("PUSH") || ins[j + 2]?.name !== "JUMPI") continue;
    const pc = parseInt(dest.push.slice(2), 16);
    if (!jumpdests.has(pc)) continue;
    const sel = ins[k].push!.toLowerCase();
    if (!seen.has(sel)) seen.set(sel, pc);
  }
  return [...seen].map(([selector, entryPc]) => ({ selector: selector as Hex, entryPc }));
}
