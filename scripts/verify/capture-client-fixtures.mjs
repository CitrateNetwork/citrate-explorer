#!/usr/bin/env node
/**
 * Capture the Citrate clients' verification HTTP requests as replay fixtures.
 *
 *   node scripts/verify/capture-client-fixtures.mjs \
 *     --chain-dir <citrate-chain checkout> \
 *     --sdk-js-dir <citrate-sdk-js checkout, npm ci done> \
 *     --sdk-python-dir <citrate-sdk-python checkout> \
 *     --python <python with that citrate_sdk installed>
 *
 * The clients are the ones that call CitrateScan's Etherscan-compatible API:
 *   - `citrate contract verify | verify-get` (citrate-chain cli/src/commands/{contract,verify}.rs),
 *     driven through its own command code (`contract::execute`) inside a cargo integration
 *     test that this script writes into the chain checkout for the run and removes after;
 *   - `verifyContract` from @citrate/sdk (citrate-sdk-js src/verify/index.ts);
 *   - `verify_contract` from citrate_sdk (citrate-sdk-python citrate_sdk/verify.py).
 *
 * Each client is pointed at a local recorder that answers like an Etherscan server and logs
 * every request. The submissions reuse the contracts and the standard JSON input of the
 * forge fixture (src/lib/verify/__fixtures__/tools/forge-etherscan.json), so the replay test
 * (src/lib/verify/clients.replay.test.ts) can answer chain reads from that recorded anvil state.
 * Writes src/lib/verify/__fixtures__/tools/citrate-clients.json.
 *
 * Data sources: the client code at the given checkouts; the forge fixture. Never points at a
 * real network, handles no keys.
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const toolsDir = join(repo, "src/lib/verify/__fixtures__/tools");

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  if (i < 0 || !argv[i + 1]) throw new Error(`missing ${name}`);
  return resolve(argv[i + 1]);
};
const chainDir = arg("--chain-dir");
const sdkJsDir = arg("--sdk-js-dir");
const python = argv.includes("--python") ? argv[argv.indexOf("--python") + 1] : "python3";

const REC_PORT = 19000 + Math.floor(Math.random() * 1000);
const REC = `http://127.0.0.1:${REC_PORT}/api`;
const GUID = "recordedguid";
const COMPILER = "v0.8.26+commit.8a97fa7a";

function rev(dir) {
  return execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
}

function runAsync(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => (code === 0 ? res(out) : rej(new Error(`${cmd} ${args.join(" ")} exited ${code}\n${out}\n${err}`))));
  });
}

// ---- inputs from the forge fixture --------------------------------------------------------
const forge = JSON.parse(readFileSync(join(toolsDir, "forge-etherscan.json"), "utf8"));
function forgeSubmission(contractName) {
  for (const run of forge.runs) {
    for (const r of run.requests) {
      if (r.method !== "POST") continue;
      const p = new URLSearchParams(r.body);
      if (p.get("contractname") === contractName) return { address: p.get("contractaddress"), form: p };
    }
  }
  throw new Error(`no forge submission for ${contractName}`);
}
const counter = forgeSubmission("src/Fixture.sol:FixtureCounter");
const math = forgeSubmission("src/Fixture.sol:FixtureMath");
const stdJson = JSON.parse(counter.form.get("sourceCode"));
const ctorArgs = counter.form.get("constructorArguments");
const plainB = forge.chain.contracts[3].address; // the second FixturePlain deployment
const fixtureSol = readFileSync(join(repo, "src/lib/verify/__fixtures__/project/src/Fixture.sol"), "utf8");

const work = mkdtempSync(join(tmpdir(), "citrate-client-capture-"));
const stdJsonPath = join(work, "standard-json-input.json");
writeFileSync(stdJsonPath, JSON.stringify(stdJson));
const mathStdJsonPath = join(work, "math-standard-json-input.json");
writeFileSync(mathStdJsonPath, math.form.get("sourceCode"));
const solPath = join(work, "FixturePlain.sol");
writeFileSync(solPath, fixtureSol);

// ---- recorder -----------------------------------------------------------------------------
let current = null;
const notVerifiedEntry = {
  SourceCode: "",
  ABI: "Contract source code not verified",
  ContractName: "",
  CompilerVersion: "",
  OptimizationUsed: "",
  Runs: "",
  ConstructorArguments: "",
  EVMVersion: "Default",
  Library: "",
  LicenseType: "Unknown",
  Proxy: "0",
  Implementation: "",
  SwarmSource: "",
};
const server = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, `http://127.0.0.1:${REC_PORT}`);
    current?.requests.push({ method: req.method, url: `${url.pathname}${url.search}`, contentType: req.headers["content-type"] ?? null, body });
    const p = new URLSearchParams(req.method === "POST" ? body : url.search);
    const action = p.get("action");
    let answer;
    if (action === "verifysourcecode") answer = { status: "1", message: "OK", result: GUID };
    else if (action === "checkverifystatus") {
      current.polls = (current.polls ?? 0) + 1;
      answer = current.polls === 1 ? { status: "0", message: "NOTOK", result: "Pending in queue" } : { status: "1", message: "OK", result: "Pass - Verified" };
    } else if (action === "getsourcecode") answer = { status: "1", message: "OK", result: [notVerifiedEntry] };
    else answer = { status: "0", message: "NOTOK", result: `unexpected action ${action}` };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(answer));
  });
});
await new Promise((r) => server.listen(REC_PORT, "127.0.0.1", r));

const runs = [];
async function capture(name, client, address, fn) {
  current = { name, client, address: address.toLowerCase(), requests: [] };
  await fn();
  runs.push({ name: current.name, client: current.client, address: current.address, requests: current.requests });
  current = null;
}

// ---- citrate CLI (its contract::execute, inside a cargo integration test) ------------------
const cliTest = join(chainDir, "cli/tests/zz_capture_explorer_requests.rs");
writeFileSync(
  cliTest,
  `// Written by citrate-explorer scripts/verify/capture-client-fixtures.mjs; removed after the run.
use citrate_cli::commands::contract::{self, ContractCommands};
use citrate_cli::config::Config;
use clap::Parser;

#[derive(Parser)]
struct Cli {
    #[command(subcommand)]
    cmd: ContractCommands,
}

#[tokio::test]
async fn capture() {
    let Ok(raw) = std::env::var("CITRATE_CAPTURE_ARGS") else { return };
    let args: Vec<String> = serde_json::from_str(&raw).expect("args JSON");
    if args.is_empty() {
        return;
    }
    let cli = Cli::try_parse_from(std::iter::once("citrate".to_owned()).chain(args)).expect("parse CLI args");
    contract::execute(cli.cmd, &Config::default()).await.expect("citrate contract command");
}
`,
);
const cliRev = rev(chainDir);
const cargo = (args) =>
  runAsync("cargo", ["test", "-q", "-p", "citrate-cli", "--test", "zz_capture_explorer_requests", "--", "--nocapture"], {
    cwd: chainDir,
    env: { ...process.env, CITRATE_CAPTURE_ARGS: JSON.stringify(args) },
  });
try {
  await cargo([]); // build once; no args = no-op
  await capture("citrate contract verify --standard-json --constructor-args --chain-id 40204 (FixtureCounter)", `citrate-cli@${cliRev}`, counter.address, () =>
    cargo([
      "verify", counter.address,
      "--standard-json", stdJsonPath,
      "--contract", "src/Fixture.sol:FixtureCounter",
      "--compiler", COMPILER,
      "--constructor-args", `0x${ctorArgs}`,
      "--explorer-url", REC,
      "--chain-id", "40204",
      "--watch", "--poll-interval-ms", "50",
    ]),
  );
  await capture("citrate contract verify-get --chain-id 40204 (FixtureCounter)", `citrate-cli@${cliRev}`, counter.address, () =>
    cargo(["verify-get", counter.address, "--explorer-url", REC, "--chain-id", "40204"]),
  );
  await capture("citrate contract verify <file.sol> single-file, no chainid (FixturePlain)", `citrate-cli@${cliRev}`, plainB, () =>
    cargo([
      "verify", plainB, solPath,
      "--contract", "FixturePlain",
      "--compiler", COMPILER,
      "--optimized", "--runs", "200", "--evm-version", "cancun",
      "--explorer-url", REC,
      "--watch", "--poll-interval-ms", "50",
    ]),
  );
} finally {
  rmSync(cliTest, { force: true });
}

// ---- @citrate/sdk ---------------------------------------------------------------------------
const jsRev = rev(sdkJsDir);
const jsDriver = join(work, "sdk-js-driver.mts");
writeFileSync(
  jsDriver,
  `import { verifyContract } from ${JSON.stringify(join(sdkJsDir, "src/verify/index.ts"))};
import { readFileSync } from "node:fs";
const a = JSON.parse(process.argv[2]);
const r = await verifyContract({
  address: a.address,
  standardJsonInput: JSON.parse(readFileSync(a.stdJsonPath, "utf8")),
  contract: a.contract,
  compilerVersion: a.compiler,
  ...(a.constructorArgs ? { constructorArgs: a.constructorArgs } : {}),
  ...(a.chainId ? { chainId: a.chainId } : {}),
  explorerUrl: a.explorerUrl,
  allowInsecureHttp: true,
  pollIntervalMs: 50,
});
if (r.status !== "verified") throw new Error("unexpected " + JSON.stringify(r));
`,
);
const tsx = join(repo, "node_modules/.bin/tsx");
await capture("@citrate/sdk verifyContract standardJsonInput + constructorArgs, no chainId (FixtureCounter)", `citrate-sdk-js@${jsRev}`, counter.address, () =>
  runAsync(tsx, [jsDriver, JSON.stringify({ address: counter.address, stdJsonPath, contract: "src/Fixture.sol:FixtureCounter", compiler: COMPILER, constructorArgs: `0x${ctorArgs}`, explorerUrl: REC })], { cwd: sdkJsDir }),
);
await capture("@citrate/sdk verifyContract standardJsonInput, chainId 40204 (FixtureMath)", `citrate-sdk-js@${jsRev}`, math.address, () =>
  runAsync(tsx, [jsDriver, JSON.stringify({ address: math.address, stdJsonPath: mathStdJsonPath, contract: "src/Fixture.sol:FixtureMath", compiler: COMPILER, chainId: 40204, explorerUrl: REC })], { cwd: sdkJsDir }),
);

// ---- citrate_sdk (Python) -------------------------------------------------------------------
const pyRev = rev(arg("--sdk-python-dir"));
const pyDriver = `
import json, sys
from citrate_sdk.verify import verify_contract
a = json.loads(sys.argv[1])
r = verify_contract(
    address=a["address"],
    contract=a["contract"],
    standard_json_input=json.load(open(a["stdJsonPath"])),
    compiler_version=a["compiler"],
    constructor_args=a.get("constructorArgs"),
    explorer_url=a["explorerUrl"],
    chain_id=a.get("chainId"),
    allow_insecure_http=True,
    poll_interval=0.05,
)
assert r.status == "verified", r
`;
await capture("citrate_sdk verify_contract standard_json_input + constructor_args, chain_id 40204 (FixtureCounter)", `citrate-sdk-python@${pyRev}`, counter.address, () =>
  runAsync(python, ["-c", pyDriver, JSON.stringify({ address: counter.address, stdJsonPath, contract: "src/Fixture.sol:FixtureCounter", compiler: COMPILER, constructorArgs: ctorArgs, chainId: 40204, explorerUrl: REC })]),
);

server.close();
rmSync(work, { recursive: true, force: true });

// Local temp paths never reach the fixture: requests carry file contents, not paths.
const fixture = {
  tool: `citrate-cli@${cliRev}, citrate-sdk-js@${jsRev}, citrate-sdk-python@${pyRev}`,
  protocol: "etherscan",
  command: "node scripts/verify/capture-client-fixtures.mjs --chain-dir … --sdk-js-dir … --sdk-python-dir … --python …",
  chain: forge.chain,
  runs: runs.map((r) => ({ ...r, requests: r.requests.map((q) => ({ ...q, url: q.url.replace(/127\.0\.0\.1:\d+/g, "recorder") })) })),
};
writeFileSync(join(toolsDir, "citrate-clients.json"), `${JSON.stringify(fixture, null, 1)}\n`);
console.log(`wrote ${runs.length} runs, ${runs.reduce((n, r) => n + r.requests.length, 0)} requests`);
