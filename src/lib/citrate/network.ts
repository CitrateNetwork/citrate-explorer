// RED-COMMIT PLACEHOLDER: keeps the pre-switch behaviour (one book, no network metadata) so the
// new tests compile and fail on their assertions. Replaced in the next commit.
import book from "@/generated/addresses.json";
import constants from "@/generated/chainConstants.json";

export const NETWORK_IDS = ["r1005"] as const;

interface Constants {
  network?: string;
  genesisHash?: string;
  chainId: number;
}
interface Network {
  id: string;
  book: { chainId: number; contracts: Record<string, string> };
  constants: Constants;
}

export function selectNetwork(value: string | undefined): Network {
  void value;
  return { id: "r1005", book: book as Network["book"], constants: constants as Constants };
}

export const NETWORK = selectNetwork(process.env.NEXT_PUBLIC_CITRATE_NETWORK);

export function shortGenesis(hash: string): string {
  return hash;
}

export function networkTag(c: Constants): string {
  return String(c.network ?? "");
}
