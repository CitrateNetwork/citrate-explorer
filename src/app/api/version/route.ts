import pkg from "../../../../package.json";
import { getInferenceProvider } from "@/lib/ai/provider";

/**
 * Build + runtime provenance (SR-1) for the Transparency settings panel. Every
 * value is REAL — no hardcoded version/commit/model (Rule 11). Sources:
 *  - version  — package.json
 *  - license  — Apache-2.0 (canonical; matches LICENSE + package.json + CONFIG)
 *  - repo     — Vercel git system env, else the canonical CitrateNetwork slug
 *  - commit/ref/env/deploymentId — Vercel system env (exposed to functions)
 *  - model    — the actually-configured inference provider (mode + model id)
 *
 * On-chain model attestation (ModelRegistry hash) is reported as `pending` until
 * the registry read lands (WP-1.2) — an honest state, never a fabricated hash.
 */
export const dynamic = "force-dynamic";

const CANONICAL_REPO = "CitrateNetwork/citrate-explorer";

function repoSlug(): string {
  const owner = process.env.VERCEL_GIT_REPO_OWNER;
  const slug = process.env.VERCEL_GIT_REPO_SLUG;
  return owner && slug ? `${owner}/${slug}` : CANONICAL_REPO;
}

export function GET() {
  let model: { mode: string; id: string; attestation: string } | { error: string };
  try {
    const p = getInferenceProvider();
    model = { mode: p.mode, id: p.modelId, attestation: "pending" };
  } catch (err) {
    // e.g. CITRATE_INFERENCE_MODE=onchain (not wired) — report honestly.
    model = { error: (err as Error).message };
  }

  const repo = repoSlug();
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

  return Response.json({
    name: pkg.name,
    version: pkg.version,
    license: "Apache-2.0",
    repo,
    repoUrl: `https://github.com/${repo}`,
    commit,
    commitShort: commit ? commit.slice(0, 7) : null,
    ref: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    commitUrl: commit ? `https://github.com/${repo}/commit/${commit}` : null,
    environment: process.env.VERCEL_ENV ?? "development",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
    model,
  });
}
