// RED-COMMIT PLACEHOLDER: keeps the pre-guard behaviour (always index) so the new tests compile
// and fail on their assertions. Replaced by the real guard in the next commit.
export interface GenesisRpc {
  blockHashAt(height: number): Promise<string | null>;
}
export interface GenesisStatusRecord {
  status: "ok" | "refused" | "unavailable";
  code: string | null;
  observed: string | null;
  detail: string | null;
}
export interface GenesisStore {
  recorded(): Promise<string | null>;
  anchor(): Promise<{ height: number; hash: string } | null>;
  record(genesis: string): Promise<string | null>;
  markStatus(s: GenesisStatusRecord): Promise<void>;
}
export type GenesisVerdict =
  | { action: "index" | "record"; genesis: string }
  | { action: "unavailable"; detail: string }
  | { action: "refuse"; code: string; detail: string; observed: string | null; recorded: string | null };

export function normalizeHash(h: unknown): string | null {
  return typeof h === "string" ? h : null;
}

export async function checkGenesis(deps: {
  rpc: GenesisRpc;
  store: GenesisStore | null;
  expected: string | null;
}): Promise<GenesisVerdict> {
  void deps;
  return { action: "index", genesis: "" };
}

export class GenesisGate {
  refusal: { code: string } | null = null;
  constructor(deps: unknown, opts: unknown) {
    void deps;
    void opts;
  }
  async allow(): Promise<boolean> {
    return true;
  }
}

export function genesisHealth(i: { status: string | null; recorded: string | null; rpcGenesis: string | null }): string | null {
  void i;
  return null;
}
