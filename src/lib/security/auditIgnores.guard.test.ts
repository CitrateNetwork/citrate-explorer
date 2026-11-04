/**
 * Dependency-audit tripwire. CI blocks on `pnpm audit --audit-level=high`.
 * Two things keep that gate honest:
 *
 * 1. Every advisory in `pnpm.auditConfig.ignoreGhsas` is time-boxed. It has a
 *    machine-readable expiry in `pnpm.auditIgnoreExpiry` (YYYY-MM-DD), the
 *    expiry is not in the past, and it is at most 180 days out. When an expiry
 *    passes this test fails, so an ignore cannot outlive its justification.
 * 2. Advisories fixed by an override stay fixed: the lockfile resolves no copy
 *    of a package inside a known-vulnerable range.
 *
 * Data source: package.json and pnpm-lock.yaml at the repo root.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..", "..");

type PnpmConfig = {
  overrides?: Record<string, string>;
  auditConfig?: { ignoreGhsas?: string[] };
  auditIgnoreExpiry?: Record<string, string>;
};

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  pnpm?: PnpmConfig;
};
const lock = readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8");

const MAX_IGNORE_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

function lockedVersions(name: string): string[] {
  const re = new RegExp(`^  '?${name.replace(/[/@.]/g, "\\$&")}@(\\d+\\.\\d+\\.\\d+)'?:`, "gm");
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(lock))) out.add(m[1]);
  return [...out];
}

function cmp(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

describe("pnpm audit ignores are time-boxed", () => {
  const ignores = pkg.pnpm?.auditConfig?.ignoreGhsas ?? [];
  const expiry = pkg.pnpm?.auditIgnoreExpiry ?? {};

  it("every ignored GHSA has an expiry date", () => {
    const missing = ignores.filter((id) => !/^\d{4}-\d{2}-\d{2}$/.test(expiry[id] ?? ""));
    expect(missing).toEqual([]);
  });

  it("no expiry has passed and none is more than 180 days out", () => {
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
    const bad = ignores.filter((id) => {
      const at = Date.parse(`${expiry[id]}T00:00:00Z`);
      return !Number.isFinite(at) || at < today || at - today > MAX_IGNORE_DAYS * DAY_MS;
    });
    expect(bad).toEqual([]);
  });

  it("the expiry map names only advisories that are ignored", () => {
    const stale = Object.keys(expiry).filter((id) => !ignores.includes(id));
    expect(stale).toEqual([]);
  });
});

describe("overridden advisories stay fixed in the lockfile", () => {
  it("follow-redirects resolves to >=1.16.2 (GHSA-mrwp-f3q8-3g9p)", () => {
    const versions = lockedVersions("follow-redirects");
    expect(versions.length).toBeGreaterThan(0);
    expect(versions.filter((v) => v.startsWith("1.") && cmp(v, "1.16.2") < 0)).toEqual([]);
  });
});
