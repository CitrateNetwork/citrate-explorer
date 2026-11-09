#!/usr/bin/env node
/**
 * Capture real verification-tool HTTP requests as replay fixtures (EXP-S2).
 *
 *   node scripts/verify/capture-tool-fixtures.mjs --hardhat-dir <dir with hardhat + hardhat-verify installed>
 *
 * What it does, all locally:
 *  1. starts `anvil --chain-id 40204` on a free port;
 *  2. builds src/lib/verify/__fixtures__/project with forge and deploys, with `forge create`:
 *     FixtureMath (library), FixtureCounter (linked to it, constructor args), FixturePlain x2;
 *  3. starts a recorder that answers like an Etherscan / Sourcify server and logs every request;
 *  4. runs `forge verify-contract` (Etherscan protocol via `--verifier custom`, and `--verifier sourcify`)
 *     and `hardhat verify` (hardhat-verify customChains) against the recorder;
 *  5. reads the deployed code, creation txs and receipts back from anvil;
 *  6. writes src/lib/verify/__fixtures__/tools/{forge-etherscan,forge-sourcify,hardhat-etherscan}.json.
 *
 * The replay tests (src/lib/verify/tools.replay.test.ts) send the recorded requests to the real
 * route handlers and answer chain reads from the recorded chain state. Re-run this script when a
 * tool version changes; the versions are written into each fixture.
 *
 * Data sources: anvil (local dev chain), forge / cast / hardhat binaries on this machine.
 * Never points at a real network. Uses anvil's unlocked default account (no keys handled).
 */
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..");
const projectSrc = join(repo, "src/lib/verify/__fixtures__/project");
const outDir = join(repo, "src/lib/verify/__fixtures__/tools");

const argv = process.argv.slice(2);
const hhIdx = argv.indexOf("--hardhat-dir");
const hardhatDir = hhIdx >= 0 ? resolve(argv[hhIdx + 1]) : null;

const FROM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // anvil default account 0 (unlocked)
const ANVIL_PORT = 18000 + Math.floor(Math.random() * 1000);
const REC_PORT = ANVIL_PORT + 1;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;
const REC = `http://127.0.0.1:${REC_PORT}`;
const SOURCIFY_JOB = "0d6b0d6b-5b1e-4c3a-9d1e-000000000001";

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}

/** Async run, so the in-process recorder keeps answering while the tool talks to it. */
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

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await res.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (Date.now() - t0 > ms) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

// ---- recorder ---------------------------------------------------------------
let log = [];
const recorder = createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    log.push({ method: req.method, url: req.url, contentType: req.headers["content-type"] ?? null, body });
    const u = new URL(req.url, REC);
    const form = (req.headers["content-type"] ?? "").includes("x-www-form-urlencoded")
      ? new URLSearchParams(body)
      : u.searchParams;
    const action = form.get("action") ?? u.searchParams.get("action");
    res.setHeader("content-type", "application/json");
    const send = (status, obj) => {
      res.statusCode = status;
      res.end(JSON.stringify(obj));
    };
    if (u.pathname.startsWith("/v2/contract/")) return send(404, { customCode: "not_found", message: "not found", errorId: "rec" });
    if (u.pathname.startsWith("/v2/verify/") && req.method === "POST") return send(202, { verificationId: SOURCIFY_JOB });
    if (u.pathname.startsWith("/v2/verify/"))
      return send(200, {
        isJobCompleted: true,
        verificationId: SOURCIFY_JOB,
        contract: { match: "exact_match", creationMatch: "exact_match", runtimeMatch: "exact_match", chainId: "40204", address: "0x" },
      });
    if (action === "getabi") return send(200, { status: "0", message: "NOTOK", result: "Contract source code not verified" });
    if (action === "getsourcecode")
      return send(200, {
        status: "1",
        message: "OK",
        result: [{ SourceCode: "", ABI: "Contract source code not verified", ContractName: "", CompilerVersion: "" }],
      });
    if (action === "verifysourcecode") return send(200, { status: "1", message: "OK", result: "recordedguid" });
    if (action === "checkverifystatus") return send(200, { status: "1", message: "OK", result: "Pass - Verified" });
    return send(200, { status: "0", message: "NOTOK", result: "unhandled by recorder" });
  });
});

function take() {
  const out = log;
  log = [];
  return out;
}

async function chainState(addresses) {
  const genesis = await rpc("eth_getBlockByNumber", ["0x0", false]);
  const contracts = [];
  for (const { address, txHash } of addresses) {
    const code = await rpc("eth_getCode", [address, "latest"]);
    const tx = await rpc("eth_getTransactionByHash", [txHash]);
    const receipt = await rpc("eth_getTransactionReceipt", [txHash]);
    const block = await rpc("eth_getBlockByNumber", [receipt.blockNumber, false]);
    contracts.push({
      address: address.toLowerCase(),
      code,
      creationTx: {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        input: tx.input,
        blockNumber: tx.blockNumber,
        blockHash: tx.blockHash,
        timestamp: block.timestamp,
      },
      receipt: { contractAddress: receipt.contractAddress, status: receipt.status, blockNumber: receipt.blockNumber },
    });
  }
  return { chainId: 40204, genesisHash: genesis.hash, contracts };
}

function forgeCreate(cwd, target, extra = []) {
  const out = run("forge", ["create", "--rpc-url", RPC, "--unlocked", "--from", FROM, "--broadcast", "--json", target, ...extra], { cwd });
  const j = JSON.parse(out.slice(out.indexOf("{")));
  return { address: j.deployedTo, txHash: j.transactionHash };
}

async function main() {
  const anvil = spawn("anvil", ["--chain-id", "40204", "--port", String(ANVIL_PORT), "--silent"], { stdio: "ignore" });
  try {
    await waitFor(() => rpc("eth_chainId", []));
    await new Promise((r) => recorder.listen(REC_PORT, "127.0.0.1", r));
    const forgeVersion = run("forge", ["--version"]).split("\n")[0].trim();

    // ---- forge ----
    const work = mkdtempSync(join(tmpdir(), "verify-capture-"));
    cpSync(projectSrc, work, { recursive: true });
    run("forge", ["build"], { cwd: work });
    const lib = forgeCreate(work, "src/Fixture.sol:FixtureMath");
    const libFlag = `src/Fixture.sol:FixtureMath:${lib.address}`;
    const args = run("cast", ["abi-encode", "c(uint256,string)", "7", "citrate fixture"]).trim();
    const counter = forgeCreate(work, "src/Fixture.sol:FixtureCounter", ["--libraries", libFlag, "--constructor-args", "7", "citrate fixture"]);
    const plainA = forgeCreate(work, "src/Fixture.sol:FixturePlain");
    const plainB = forgeCreate(work, "src/Fixture.sol:FixturePlain");

    const custom = ["--chain", "40204", "--rpc-url", RPC, "--verifier", "custom", "--verifier-url", `${REC}/api`, "--verifier-api-key", "citrate", "--watch"];
    await runAsync("forge", ["verify-contract", ...custom, "--libraries", libFlag, "--constructor-args", args, counter.address, "src/Fixture.sol:FixtureCounter"], { cwd: work });
    const counterEs = take();
    await runAsync("forge", ["verify-contract", ...custom, lib.address, "src/Fixture.sol:FixtureMath"], { cwd: work });
    const libEs = take();
    await runAsync("forge", ["verify-contract", ...custom, plainA.address, "src/Fixture.sol:FixturePlain"], { cwd: work });
    const plainEs = take();

    const sourcify = ["--chain", "40204", "--rpc-url", RPC, "--verifier", "sourcify", "--verifier-url", `${REC}/`, "--watch"];
    await runAsync("forge", ["verify-contract", ...sourcify, "--libraries", libFlag, "--constructor-args", args, counter.address, "src/Fixture.sol:FixtureCounter"], { cwd: work });
    const counterSf = take();

    const forgeChain = await chainState([
      { address: lib.address, txHash: lib.txHash },
      { address: counter.address, txHash: counter.txHash },
      { address: plainA.address, txHash: plainA.txHash },
      { address: plainB.address, txHash: plainB.txHash },
    ]);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(
      join(outDir, "forge-etherscan.json"),
      JSON.stringify(
        {
          tool: forgeVersion,
          protocol: "etherscan",
          command: "forge verify-contract --verifier custom --verifier-url <server>/api --verifier-api-key <any> --watch",
          chain: forgeChain,
          runs: [
            { name: "FixtureCounter (linked library, constructor args)", address: counter.address.toLowerCase(), requests: counterEs },
            { name: "FixtureMath (library)", address: lib.address.toLowerCase(), requests: libEs },
            { name: "FixturePlain", address: plainA.address.toLowerCase(), requests: plainEs },
          ],
        },
        null,
        1,
      ) + "\n",
    );
    writeFileSync(
      join(outDir, "forge-sourcify.json"),
      JSON.stringify(
        {
          tool: forgeVersion,
          protocol: "sourcify-v2",
          command: "forge verify-contract --verifier sourcify --verifier-url <server>/ --watch",
          chain: forgeChain,
          runs: [{ name: "FixtureCounter (linked library, constructor args)", address: counter.address.toLowerCase(), requests: counterSf }],
        },
        null,
        1,
      ) + "\n",
    );
    rmSync(work, { recursive: true, force: true });

    // ---- hardhat-verify ----
    if (hardhatDir) {
      const pkg = (name) => JSON.parse(readFileSync(join(hardhatDir, "node_modules", name, "package.json"), "utf8")).version;
      const hhVersion = `hardhat ${pkg("hardhat")}, @nomicfoundation/hardhat-verify ${pkg("@nomicfoundation/hardhat-verify")}`;
      mkdirSync(join(hardhatDir, "contracts"), { recursive: true });
      cpSync(join(projectSrc, "src/Fixture.sol"), join(hardhatDir, "contracts/Fixture.sol"));
      cpSync(join(projectSrc, "hardhat.config.js"), join(hardhatDir, "hardhat.config.js"));
      const env = { ...process.env, CAPTURE_RPC: RPC, CAPTURE_URL: REC };
      run("npx", ["hardhat", "compile"], { cwd: hardhatDir, env });
      const art = (n) => JSON.parse(readFileSync(join(hardhatDir, `artifacts/contracts/Fixture.sol/${n}.json`), "utf8"));
      const deploy = async (bytecode) => {
        const txHash = await rpc("eth_sendTransaction", [{ from: FROM, data: bytecode, gas: "0x989680" }]);
        const r = await waitFor(async () => {
          const x = await rpc("eth_getTransactionReceipt", [txHash]);
          if (!x) throw new Error("pending");
          return x;
        });
        return { address: r.contractAddress, txHash };
      };
      const hhLib = await deploy(art("FixtureMath").bytecode);
      const c = art("FixtureCounter");
      let bc = c.bytecode;
      for (const f of Object.values(c.linkReferences))
        for (const refs of Object.values(f))
          for (const r of refs) {
            const s = 2 + r.start * 2;
            bc = bc.slice(0, s) + hhLib.address.slice(2).toLowerCase() + bc.slice(s + 40);
          }
      const hhArgs = run("cast", ["abi-encode", "c(uint256,string)", "9", "hardhat fixture"]).trim();
      const hhCounter = await deploy(bc + hhArgs.slice(2));
      writeFileSync(join(hardhatDir, "libs.js"), `module.exports = { FixtureMath: "${hhLib.address}" };\n`);
      take();
      await runAsync(
        "npx",
        ["hardhat", "verify", "--network", "citrate", "--contract", "contracts/Fixture.sol:FixtureCounter", "--libraries", "libs.js", hhCounter.address, "9", "hardhat fixture"],
        { cwd: hardhatDir, env },
      );
      const hhReqs = take();
      writeFileSync(
        join(outDir, "hardhat-etherscan.json"),
        JSON.stringify(
          {
            tool: hhVersion,
            protocol: "etherscan",
            command: "npx hardhat verify --network citrate (etherscan.customChains apiURL <server>/api, per-network apiKey)",
            chain: await chainState([
              { address: hhLib.address, txHash: hhLib.txHash },
              { address: hhCounter.address, txHash: hhCounter.txHash },
            ]),
            runs: [{ name: "FixtureCounter (linked library, constructor args)", address: hhCounter.address.toLowerCase(), requests: hhReqs }],
          },
          null,
          1,
        ) + "\n",
      );
    }
    console.log(`fixtures written to ${outDir}`);
  } finally {
    anvil.kill();
    recorder.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
