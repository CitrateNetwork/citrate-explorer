import { describe, it, expect } from "vitest";
import { fromApiJson, fromEtherscanForm, fromSourcifyMetadata, fromSourcifyStdJson, RequestError } from "./request";

/** EXP-S2: every front door normalizes to one request, and refuses bad input before a job exists. */

const ADDR = "0xE7f1725E7734CE288F8367e1Bb143E90bb3F0512";
const STD = { language: "Solidity", sources: { "src/A.sol": { content: "contract A {}" } }, settings: { optimizer: { enabled: true, runs: 200 } } };

const form = (o: Record<string, string>) => new URLSearchParams(o);

describe("fromEtherscanForm", () => {
  it("reads standard JSON and Etherscan's 'constructorArguements' spelling", () => {
    const r = fromEtherscanForm(
      form({
        contractaddress: ADDR,
        codeformat: "solidity-standard-json-input",
        sourceCode: JSON.stringify(STD),
        contractname: "src/A.sol:A",
        compilerversion: "v0.8.26+commit.8a97fa7a",
        constructorArguements: "00000000000000000000000000000000000000000000000000000000000000ff",
      }),
    );
    expect(r.address).toBe(ADDR.toLowerCase());
    expect(r.format).toBe("solidity-standard-json-input");
    expect(r.stdJsonInput).toEqual(STD);
    expect(r.contractIdentifier).toBe("src/A.sol:A");
    expect(r.constructorArgs).toBe("00000000000000000000000000000000000000000000000000000000000000ff");
  });

  it("also accepts 'constructorArguments' and a 0x prefix", () => {
    const r = fromEtherscanForm(
      form({
        contractaddress: ADDR,
        codeformat: "solidity-standard-json-input",
        sourceCode: JSON.stringify(STD),
        compilerversion: "0.8.26",
        constructorArguments: "0xABCD",
      }),
    );
    expect(r.constructorArgs).toBe("abcd");
  });

  it("takes whichever constructor-args spelling is non-empty, and refuses two different values", () => {
    const base = { contractaddress: ADDR, codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify(STD), compilerversion: "0.8.26" };
    expect(fromEtherscanForm(form({ ...base, constructorArguements: "", constructorArguments: "0xabcd" })).constructorArgs).toBe("abcd");
    expect(fromEtherscanForm(form({ ...base, constructorArguements: "abcd", constructorArguments: "" })).constructorArgs).toBe("abcd");
    // The Citrate CLI and SDKs send both spellings with the same value (as forge does).
    expect(fromEtherscanForm(form({ ...base, constructorArguements: "ABCD", constructorArguments: "0xabcd" })).constructorArgs).toBe("abcd");
    expect(() => fromEtherscanForm(form({ ...base, constructorArguements: "abcd", constructorArguments: "ef01" }))).toThrow(RequestError);
  });

  it("accepts standard JSON wrapped in Etherscan's double braces", () => {
    const r = fromEtherscanForm(
      form({ contractaddress: ADDR, codeformat: "solidity-standard-json-input", sourceCode: `{${JSON.stringify(STD)}}`, compilerversion: "0.8.26" }),
    );
    expect(r.stdJsonInput).toEqual(STD);
  });

  it("wraps a single file with the optimizer, EVM version and named libraries", () => {
    const r = fromEtherscanForm(
      form({
        contractaddress: ADDR,
        codeformat: "solidity-single-file",
        sourceCode: "contract Counter {}",
        contractname: "Counter",
        compilerversion: "v0.8.26+commit.8a97fa7a",
        optimizationUsed: "1",
        runs: "999",
        evmversion: "paris",
        libraryname1: "FixtureMath",
        libraryaddress1: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      }),
    );
    expect(r.format).toBe("solidity-single-file");
    expect(r.stdJsonInput.sources).toEqual({ "Counter.sol": { content: "contract Counter {}" } });
    expect(r.stdJsonInput.settings).toEqual({ optimizer: { enabled: true, runs: 999 }, evmVersion: "paris" });
    expect(r.contractIdentifier).toBe("Counter.sol:Counter");
    expect(r.libraries).toEqual({ FixtureMath: "0x5fbdb2315678afecb367f032d93f642f64180aa3" });
  });

  it("refuses a bad address, a bad compiler version and an unknown codeformat", () => {
    const base = { contractaddress: ADDR, codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify(STD), compilerversion: "0.8.26" };
    expect(() => fromEtherscanForm(form({ ...base, contractaddress: "0x12" }))).toThrow(RequestError);
    expect(() => fromEtherscanForm(form({ ...base, compilerversion: "latest; rm -rf /" }))).toThrow(/compiler version/);
    expect(() => fromEtherscanForm(form({ ...base, codeformat: "vyper-json" }))).toThrow(/unsupported codeformat/);
  });

  it("refuses out-of-band (urls) sources and oversized source maps at the door", () => {
    const urls = { language: "Solidity", sources: { "R.sol": { urls: ["https://example.invalid/x.sol"] } } };
    expect(() =>
      fromEtherscanForm(form({ contractaddress: ADDR, codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify(urls), compilerversion: "0.8.26" })),
    ).toThrow(/urls/);
    const many: Record<string, { content: string }> = {};
    for (let i = 0; i < 2000; i++) many[`F${i}.sol`] = { content: "contract X {}" };
    expect(() =>
      fromEtherscanForm(
        form({ contractaddress: ADDR, codeformat: "solidity-standard-json-input", sourceCode: JSON.stringify({ language: "Solidity", sources: many }), compilerversion: "0.8.26" }),
      ),
    ).toThrow(/too many source files/);
  });
});

describe("fromSourcifyStdJson", () => {
  it("reads forge's v2 body (stdJsonInput, compilerVersion, contractIdentifier)", () => {
    const r = fromSourcifyStdJson(
      {
        stdJsonInput: STD,
        compilerVersion: "0.8.26+commit.8a97fa7a",
        contractIdentifier: "src/A.sol:A",
        creationTransactionHash: "0x" + "ab".repeat(32),
      },
      ADDR,
    );
    expect(r.contractIdentifier).toBe("src/A.sol:A");
    expect(r.creationTxHash).toBe("0x" + "ab".repeat(32));
  });

  it("requires a contractIdentifier", () => {
    expect(() => fromSourcifyStdJson({ stdJsonInput: STD, compilerVersion: "0.8.26" }, ADDR)).toThrow(/contractIdentifier/);
  });
});

describe("fromSourcifyMetadata", () => {
  const metadata = {
    compiler: { version: "0.8.26+commit.8a97fa7a" },
    language: "Solidity",
    settings: {
      compilationTarget: { "src/A.sol": "A" },
      evmVersion: "cancun",
      libraries: { "src/L.sol:L": "0x5fbdb2315678afecb367f032d93f642f64180aa3" },
      metadata: { bytecodeHash: "ipfs" },
      optimizer: { enabled: true, runs: 200 },
      remappings: [],
    },
    sources: { "src/A.sol": { keccak256: "0x00" }, "src/L.sol": { keccak256: "0x00" } },
  };

  it("rebuilds the standard JSON solc used: settings minus compilationTarget, libraries grouped by file", () => {
    const r = fromSourcifyMetadata({ metadata, sources: { "src/A.sol": "contract A {}", "src/L.sol": "library L {}" } }, ADDR);
    expect(r.format).toBe("metadata");
    expect(r.compilerVersion).toBe("0.8.26+commit.8a97fa7a");
    expect(r.contractIdentifier).toBe("src/A.sol:A");
    expect(r.stdJsonInput.settings).toEqual({
      evmVersion: "cancun",
      libraries: { "src/L.sol": { L: "0x5fbdb2315678afecb367f032d93f642f64180aa3" } },
      metadata: { bytecodeHash: "ipfs" },
      optimizer: { enabled: true, runs: 200 },
      remappings: [],
    });
    expect(Object.keys(r.stdJsonInput.sources)).toEqual(["src/A.sol", "src/L.sol"]);
  });

  it("refuses when a source named in the metadata is missing", () => {
    expect(() => fromSourcifyMetadata({ metadata, sources: { "src/A.sol": "contract A {}" } }, ADDR)).toThrow(/src\/L.sol/);
  });
});

describe("fromApiJson (POST /api/verify, Citrate Core)", () => {
  it("maps the JSON body onto the same request", () => {
    const r = fromApiJson({
      address: ADDR,
      format: "solidity-standard-json-input",
      compilerVersion: "v0.8.26+commit.8a97fa7a",
      source: JSON.stringify(STD),
      contractName: "src/A.sol:A",
      constructorArguments: "0x01",
    });
    expect(r.contractIdentifier).toBe("src/A.sol:A");
    expect(r.constructorArgs).toBe("01");
  });
});
