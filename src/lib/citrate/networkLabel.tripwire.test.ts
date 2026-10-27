// Tripwire (r1006 cutover): r1005 and r1006 share chain id 40204, so a screen that identifies the
// chain by its id alone cannot tell users which network they are looking at. Any .tsx that shows
// the chain id as an identity ("chain 40204", "Chain ID", the header chain badge) must also show
// the build's network/genesis from the generated chain constants (src/lib/citrate/network.ts).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..");
const SHOWS_CHAIN_ID = /chain\s*40204|["'>]Chain ID["'<]|className="k">chain</i;
const SHOWS_NETWORK = /\bnetworkTag\(|\bCHAIN_CONSTANTS\b/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith(".tsx") && !p.endsWith(".test.tsx") ? [p] : [];
  });
}

describe("tripwire: chain-id displays name the 40204 network", () => {
  it("every .tsx that shows the chain id also shows the network/genesis", () => {
    const files = tsxFiles(SRC);
    const shows = files.filter((f) => SHOWS_CHAIN_ID.test(readFileSync(f, "utf8")));
    expect(shows.length).toBeGreaterThanOrEqual(5); // the scan must keep finding the known displays
    const offenders = shows.filter((f) => !SHOWS_NETWORK.test(readFileSync(f, "utf8"))).map((f) => relative(SRC, f));
    expect(offenders).toEqual([]);
  });
});
