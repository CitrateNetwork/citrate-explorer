/**
 * Proxy detection for verifyproxycontract (EXP-S2): EIP-1167 minimal proxies by
 * code shape, EIP-1967 implementation and beacon slots, and the EIP-1822
 * PROXIABLE slot.
 *
 * Data source (Rule 7): the Citrate RPC via {@link ChainReader}
 * (eth_getCode, eth_getStorageAt, eth_call to a beacon's implementation()).
 */
import type { ChainReader } from "./chain";

export type ProxyType = "eip1167" | "eip1967" | "eip1967-beacon" | "eip1822";

/** bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1) */
export const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";
/** bytes32(uint256(keccak256("eip1967.proxy.beacon")) - 1) */
export const EIP1967_BEACON_SLOT = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50";
/** keccak256("PROXIABLE") */
export const EIP1822_SLOT = "0xc5f16f0fcc639fa48a6947836d9850f504798523bf8c9a3a87d5876cf622bcf7";
/** implementation() */
const IMPLEMENTATION_SELECTOR = "0x5c60da1b";

const MINIMAL_PROXY = /^0x363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3$/;

function slotAddress(word: string): string | null {
  const h = word.replace(/^0x/, "").padStart(64, "0");
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  const addr = h.slice(24);
  if (/^0+$/.test(addr) || !/^0{24}$/.test(h.slice(0, 24))) return null;
  return `0x${addr}`;
}

export async function detectProxy(
  chain: ChainReader,
  address: string,
  code: string,
): Promise<{ type: ProxyType; implementation: string } | null> {
  const minimal = MINIMAL_PROXY.exec(code.toLowerCase());
  if (minimal) return { type: "eip1167", implementation: `0x${minimal[1]}` };
  const impl = slotAddress(await chain.getStorageAt(address, EIP1967_IMPL_SLOT));
  if (impl) return { type: "eip1967", implementation: impl };
  const beacon = slotAddress(await chain.getStorageAt(address, EIP1967_BEACON_SLOT));
  if (beacon) {
    try {
      const fromBeacon = slotAddress(await chain.call(beacon, IMPLEMENTATION_SELECTOR));
      if (fromBeacon) return { type: "eip1967-beacon", implementation: fromBeacon };
    } catch {
      // a beacon that does not answer implementation() is not usable
    }
  }
  const uups = slotAddress(await chain.getStorageAt(address, EIP1822_SLOT));
  if (uups) return { type: "eip1822", implementation: uups };
  return null;
}
