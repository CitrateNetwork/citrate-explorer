/**
 * Guard for the time-boxed `pnpm audit` ignore of GHSA-mrhx-c7xc-m3w5 (zod < 4.6.6,
 * memory exhaustion validating oversized constrained collections).
 *
 * The app's own zod (direct dependency) is on a patched 4.x. The ignore in
 * package.json `pnpm.auditConfig.ignoreGhsas` exists only because some third-party
 * SDKs hard-depend on zod 3, which has no patched release, and forcing them onto
 * zod 4 would change their runtime behaviour. The ignore is by advisory id, so it
 * would also hide a regression of the app's own zod. This guard fails when:
 *   1. the direct zod, or any zod 4.x in the lock, is below 4.6.6;
 *   2. a package outside ALLOWED_ZOD3_PARENTS depends on a zod below 4.6.6;
 *   3. the ignore is still present after EXPIRES;
 *   4. the ignore is present but no zod below 4.6.6 is left (stale: remove it).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ADVISORY = "GHSA-mrhx-c7xc-m3w5";
const PATCHED: Version = [4, 6, 6];
const EXPIRES = "2027-01-31";
/** Third-party packages whose published releases (latest included) require zod 3. */
const ALLOWED_ZOD3_PARENTS = new Set([
  "@coinbase/cdp-sdk",
  "@privy-io/api-base",
  "@privy-io/public-api",
  "@reown/appkit-wallet",
  "x402",
]);

type Version = [number, number, number];

function parseVersion(v: string): Version {
  const core = v.split(/[-+(]/, 1)[0];
  const parts = core.split(".").map((x) => Number.parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`unparseable version ${JSON.stringify(v)}`);
  }
  return [parts[0], parts[1], parts[2]];
}

function below(v: string, floor: Version): boolean {
  const a = parseVersion(v);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== floor[i]) return a[i] < floor[i];
  }
  return false;
}

/** "@scope/name@1.2.3(peer...)" or "name@1.2.3" -> "name". */
function packageName(key: string): string {
  const k = key.replace(/^'|'$/g, "");
  const at = k.indexOf("@", k.startsWith("@") ? 1 : 0);
  return k.slice(0, at);
}

interface LockFacts {
  /** zod version the root importer resolves, or null. */
  direct: string | null;
  /** every resolved zod version in the lock. */
  resolved: string[];
  /** parent package name -> zod versions it depends on (dependencies, not peers). */
  parents: Map<string, Set<string>>;
}

function lockFacts(lock: string): LockFacts {
  const direct = /\n {6}zod:\n {8}specifier: [^\n]+\n {8}version: ([^\s(]+)/.exec(lock.split("\npackages:\n")[0])?.[1] ?? null;
  const resolved = [...lock.matchAll(/^ {2}zod@([^:(]+):/gm)].map((m) => m[1]);
  const [, afterPackages = ""] = lock.split("\npackages:\n");
  const [packages, snapshots = ""] = afterPackages.split("\nsnapshots:\n");
  // Packages that take zod as a PEER use the host's zod; the host is checked
  // as a parent itself, so these are skipped. pnpm records resolved peers
  // under `dependencies` in snapshots, hence the lookup in `packages`.
  const zodPeers = new Set<string>();
  for (const block of packages.split("\n\n")) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length > 0 && /\n {4}peerDependencies:\n(?: {6}[^\n]+\n)*? {6}zod: /.test(block + "\n")) {
      zodPeers.add(packageName(lines[0].trim().replace(/:$/, "")));
    }
  }
  const parents = new Map<string, Set<string>>();
  for (const block of snapshots.split("\n\n")) {
    const lines = block.split("\n").filter((l) => l.length > 0);
    if (lines.length === 0) continue;
    const name = packageName(lines[0].trim().replace(/:$/, ""));
    if (zodPeers.has(name)) continue;
    let section = "";
    for (const line of lines.slice(1)) {
      const s = /^ {4}(\w+):/.exec(line);
      if (s) section = s[1];
      const d = /^ {6}zod: ([^\s(]+)/.exec(line);
      if (d && (section === "dependencies" || section === "optionalDependencies")) {
        if (!parents.has(name)) parents.set(name, new Set());
        parents.get(name)!.add(d[1]);
      }
    }
  }
  return { direct, resolved: [...new Set(resolved)], parents };
}

function guard(lock: string, pkg: { pnpm?: { auditConfig?: { ignoreGhsas?: string[] } } }, today: string): string[] {
  const errors: string[] = [];
  const f = lockFacts(lock);
  const floor = PATCHED.join(".");
  if (f.direct === null) errors.push("no direct zod dependency found in the lock importer");
  else if (below(f.direct, PATCHED)) errors.push(`direct zod ${f.direct} is below ${floor}`);
  for (const v of f.resolved) {
    if (parseVersion(v)[0] >= 4 && below(v, PATCHED)) errors.push(`zod ${v} (4.x) is below ${floor}`);
  }
  for (const [name, versions] of f.parents) {
    const vulnerable = [...versions].filter((v) => below(v, PATCHED));
    if (vulnerable.length > 0 && !ALLOWED_ZOD3_PARENTS.has(name)) {
      errors.push(`${name} -> zod ${vulnerable.join(", ")} (< ${floor}) is not covered by the ${ADVISORY} ignore`);
    }
  }
  const ignored = pkg.pnpm?.auditConfig?.ignoreGhsas?.includes(ADVISORY) ?? false;
  if (ignored && today > EXPIRES) {
    errors.push(`the ${ADVISORY} ignore expired on ${EXPIRES}: upgrade the zod 3 users, or renew it in a reviewed PR`);
  }
  if (ignored && !f.resolved.some((v) => below(v, PATCHED))) {
    errors.push(`no zod below ${floor} is left in the lock: the ${ADVISORY} ignore is stale, remove it and this guard`);
  }
  return errors;
}

// ---- fixtures (negative controls) -------------------------------------------

function fixture(direct: string, snapshots: Record<string, string>, zodPeerPackages: string[] = []): string {
  const versions = new Set<string>([direct, ...Object.values(snapshots)]);
  const pkgs =
    [...versions].map((v) => `  zod@${v}:\n    resolution: {integrity: sha512-x}\n`).join("\n") +
    zodPeerPackages.map((p) => `\n  ${p}:\n    resolution: {integrity: sha512-x}\n    peerDependencies:\n      typescript: '>=5.0.4'\n      zod: ^3 >=3.22.0\n`).join("");
  const snaps = Object.entries(snapshots)
    .map(([parent, v]) => `  ${parent}:\n    dependencies:\n      zod: ${v}\n`)
    .join("\n");
  return (
    `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n    dependencies:\n      zod:\n        specifier: ^${direct}\n        version: ${direct}\n` +
    `\npackages:\n\n${pkgs}\nsnapshots:\n\n${snaps}`
  );
}

const IGNORED = { pnpm: { auditConfig: { ignoreGhsas: [ADVISORY] } } };
const NOT_IGNORED = { pnpm: { auditConfig: { ignoreGhsas: [] } } };
const BEFORE = "2026-10-25";
const AFTER = "2027-02-01";

describe("zod advisory guard (fixtures)", () => {
  it("passes: patched direct zod, zod 3 only under allowed parents", () => {
    expect(guard(fixture("4.6.7", { "x402@0.7.3": "3.25.76", "'@reown/appkit-wallet@1.8.9(typescript@5.9.3)'": "3.22.4" }), IGNORED, BEFORE)).toEqual([]);
  });

  it("fails: direct zod below the patched floor", () => {
    const errors = guard(fixture("4.4.3", { "x402@0.7.3": "3.25.76" }), IGNORED, BEFORE);
    expect(errors).toContain("direct zod 4.4.3 is below 4.6.6");
  });

  it("fails: a new package depending on an unpatched zod", () => {
    const errors = guard(fixture("4.6.7", { "some-new-sdk@1.0.0": "3.25.76" }), IGNORED, BEFORE);
    expect(errors).toEqual(["some-new-sdk -> zod 3.25.76 (< 4.6.6) is not covered by the GHSA-mrhx-c7xc-m3w5 ignore"]);
  });

  it("fails: an unpatched zod 4.x anywhere, even under an allowed parent", () => {
    const errors = guard(fixture("4.6.7", { "x402@0.7.3": "4.5.0" }), IGNORED, BEFORE);
    expect(errors).toEqual(["zod 4.5.0 (4.x) is below 4.6.6"]);
  });

  it("skips packages that take zod as a peer; still fails the same package as a hard dependency", () => {
    const snaps = { "abitype@1.0.8(typescript@5.9.3)(zod@3.25.76)": "3.25.76", "x402@0.7.3": "3.25.76" };
    expect(guard(fixture("4.6.7", snaps, ["abitype@1.0.8"]), IGNORED, BEFORE)).toEqual([]);
    expect(guard(fixture("4.6.7", snaps), IGNORED, BEFORE)).toEqual([
      "abitype -> zod 3.25.76 (< 4.6.6) is not covered by the GHSA-mrhx-c7xc-m3w5 ignore",
    ]);
  });

  it("passes: a new package on a patched zod", () => {
    expect(guard(fixture("4.6.7", { "x402@0.7.3": "3.25.76", "fine-sdk@2.0.0": "4.6.7" }), IGNORED, BEFORE)).toEqual([]);
  });

  it("fails: ignore past its expiry; passes on the expiry day", () => {
    const lock = fixture("4.6.7", { "x402@0.7.3": "3.25.76" });
    expect(guard(lock, IGNORED, AFTER)).toEqual([`the ${ADVISORY} ignore expired on ${EXPIRES}: upgrade the zod 3 users, or renew it in a reviewed PR`]);
    expect(guard(lock, IGNORED, EXPIRES)).toEqual([]);
    expect(guard(lock, NOT_IGNORED, AFTER)).toEqual([]);
  });

  it("fails: stale ignore once no unpatched zod is left", () => {
    const lock = fixture("4.6.7", { "fine-sdk@2.0.0": "4.6.7" });
    expect(guard(lock, IGNORED, BEFORE)).toHaveLength(1);
    expect(guard(lock, IGNORED, BEFORE)[0]).toContain("stale");
    expect(guard(lock, NOT_IGNORED, BEFORE)).toEqual([]);
  });
});

describe("zod advisory guard (this repo)", () => {
  const root = join(__dirname, "..", "..");
  const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  it("the real lock parses: direct zod and its zod 3 parents are found", () => {
    const f = lockFacts(lock);
    expect(f.direct).not.toBeNull();
    expect(f.resolved.length).toBeGreaterThan(0);
  });

  it("the repo lock and audit config pass the guard", () => {
    expect(guard(lock, pkg, new Date().toISOString().slice(0, 10))).toEqual([]);
  });
});
