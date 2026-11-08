"use client";

/**
 * Code pane (EXP-S3): verified multi-file source next to the runtime opcodes, with
 * deployedSourceMap cross-highlighting both ways (click an opcode for its source
 * range, click a source line for its opcodes), raw bytecode and compiler settings.
 * For unverified code: the disassembly with dispatcher entries labeled.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Hex } from "viem";
import { disassemble, dispatcherEntries, splitMetadata, type Instruction } from "@/lib/contract/disasm";
import { buildCrossMap, decodeSourceMap, type CrossMap, type SourceRange } from "@/lib/contract/sourceMap";
import { lookupFunction } from "@/lib/contract/signatures";
import { functionSignature } from "@/lib/contract/codec";
import type { ContractInfo } from "@/lib/contract/types";

const KW = /\b(pragma|solidity|contract|interface|library|abstract|function|external|public|private|internal|view|pure|payable|returns|return|event|error|indexed|mapping|struct|enum|emit|revert|require|if|else|for|while|modifier|constructor|import|from|is|memory|calldata|storage|immutable|constant|override|virtual|unchecked|assembly)\b/g;
const TY = /\b(address|bool|string|bytes\d*|u?int\d*)\b/g;

/** Token-highlight one line of Solidity as React nodes (no HTML injection). */
function highlight(line: string): ReactNode {
  if (/^\s*(\/\/|\/\*|\*)/.test(line)) return <span className="cx-tk-c">{line}</span>;
  const cut = line.indexOf("//");
  const code = cut >= 0 ? line.slice(0, cut) : line;
  const comment = cut >= 0 ? line.slice(cut) : "";
  const parts: ReactNode[] = [];
  const re = new RegExp(`${KW.source}|${TY.source}`, "g");
  let last = 0;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (m.index > last) parts.push(code.slice(last, m.index));
    parts.push(<span key={m.index} className={m[1] ? "cx-tk-k" : "cx-tk-t"}>{m[0]}</span>);
    last = m.index + m[0].length;
  }
  parts.push(code.slice(last));
  if (comment) parts.push(<span key="c" className="cx-tk-c">{comment}</span>);
  return parts.length ? parts : " ";
}

function OpRow({ ins, label, on, onClick }: { ins: Instruction; label?: string; on?: boolean; onClick?: () => void }) {
  const inner = (
    <>
      <span className="cx-op-pc">{ins.pc.toString(16).padStart(4, "0")}</span>
      <span className="cx-op-n">{ins.name}</span>
      <span className="cx-op-a">{ins.push ?? ""}{ins.truncated ? " (truncated)" : ""}</span>
      <span className="cx-op-ln">{label ?? ""}</span>
    </>
  );
  if (!onClick) return <div className="cx-op">{inner}</div>;
  return (
    <button type="button" className={"cx-op" + (label ? "" : " gen") + (on ? " on" : "")} data-k={ins.index} onClick={onClick}>
      {inner}
    </button>
  );
}

function Settings({ info, runtimeSize }: { info: ContractInfo; runtimeSize: number }) {
  const s = info.settings as { optimizer?: { enabled?: boolean; runs?: number }; evmVersion?: string; viaIR?: boolean; libraries?: unknown } | null;
  const rows: Array<[string, ReactNode]> = [
    ["Compiler", <span className="mono" key="c">{info.compilerVersion ?? "not recorded"}</span>],
    ["Optimizer", s?.optimizer ? (s.optimizer.enabled ? `on, ${s.optimizer.runs ?? 200} runs` : "off") : "not recorded"],
    ["EVM version", s?.evmVersion ?? "compiler default"],
    ["Via IR", s?.viaIR === undefined ? "not recorded" : s.viaIR ? "yes" : "no"],
    ["Runtime match", info.runtimeMatch ?? "not recorded"],
    ["Creation match", info.creationMatch ?? (info.origin === "api-source-v1" ? "not compared (verification v1)" : "no creation transaction compared")],
    ["Runtime size", `${runtimeSize.toLocaleString()} bytes`],
  ];
  return (
    <section className="cx-sec">
      <h2 className="cx-sec-h">Compiler settings</h2>
      <dl className="cx-kv">
        {rows.map(([k, v]) => (
          <div className="cx-kv-r" key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
        {info.constructorArgs && (
          <div className="cx-kv-r"><dt>Constructor args</dt><dd><pre className="cx-pre">{info.constructorArgs}</pre></dd></div>
        )}
      </dl>
    </section>
  );
}

function RawBytecode({ code }: { code: Hex }) {
  const { metadata } = splitMetadata(code);
  return (
    <details className="cx-rawhex">
      <summary>Raw runtime bytecode ({((code.length - 2) / 2).toLocaleString()} bytes{metadata ? ", CBOR metadata at the end" : ""})</summary>
      <pre className="cx-pre" style={{ maxHeight: 260, marginTop: 8 }}>{code}</pre>
    </details>
  );
}

/** Verified source with opcodes; cross-highlighting when a source map is available. */
export function VerifiedCodePane({ info, runtimeCode }: { info: ContractInfo; runtimeCode: Hex }) {
  const ins = useMemo(() => disassemble(runtimeCode), [runtimeCode]);
  const cross: CrossMap | null = useMemo(() => {
    if (!info.deployedSourceMap || !info.sourceIndexById || !info.sources.length) return null;
    return buildCrossMap(ins, decodeSourceMap(info.deployedSourceMap), info.sources, info.sourceIndexById);
  }, [ins, info]);
  const [file, setFile] = useState(0);
  const [hl, setHl] = useState<SourceRange | null>(null);
  const [onOps, setOnOps] = useState<Set<number>>(new Set());
  const srcRef = useRef<HTMLDivElement>(null);
  const opsRef = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const lines = useMemo(() => (info.sources[file]?.content ?? "").split("\n"), [info.sources, file]);
  const opLines = useMemo(() => (cross ? cross.linesWithInstructions(file) : new Set<number>()), [cross, file]);

  useEffect(() => {
    if (!hl) return;
    srcRef.current?.querySelector(`[data-n="${hl.startLine}"]`)?.scrollIntoView({ block: "center" });
  }, [hl, file]);

  const clickOp = (k: number) => {
    if (!cross) return;
    setOnOps(new Set([k]));
    const r = cross.rangeOf(k);
    if (!r) {
      setHl(null);
      setNote("This opcode is compiler-generated; it has no source range.");
      return;
    }
    setNote(null);
    setFile(r.file);
    // A long range (a whole function) keeps the strong mark on its first line.
    setHl(r.endLine - r.startLine > 12 ? { ...r, endLine: r.startLine } : r);
  };
  const clickLine = (n: number) => {
    if (!cross) return;
    const hits = cross.instructionsAt(file, n);
    setOnOps(new Set(hits));
    setHl({ file, startLine: n, endLine: n });
    setNote(null);
    if (hits[0] !== undefined) opsRef.current?.querySelector(`[data-k="${hits[0]}"]`)?.scrollIntoView({ block: "center" });
  };

  const labelOf = (i: Instruction) => {
    const r = cross?.rangeOf(i.index);
    if (!r) return undefined;
    return `${info.sources[r.file].path.split("/").pop()!.replace(/\.sol$/, "")}:${r.startLine}`;
  };

  return (
    <>
      {!cross && (
        <div className="cx-banner info">
          <strong>No source map for this record.</strong> The verification store this page reads today keeps one source file and no
          deployedSourceMap, so opcodes cannot be linked to lines. Verification v2 records carry both.
        </div>
      )}
      <div className="cx-codegrid">
        <nav className="cx-ftree" aria-label="Source files">
          <div className="cx-ftree-h">Sources ({info.sources.length})</div>
          {info.sources.map((f, k) => (
            <button key={f.path} type="button" className="cx-ftree-i" aria-pressed={k === file} onClick={() => { setFile(k); setHl(null); }}>
              <span className="cx-ftree-d">{f.path.replace(/[^/]+$/, "")}</span>
              {f.path.split("/").pop()}
            </button>
          ))}
          <div className="cx-ftree-h">Compiler</div>
          <div className="cx-ftree-m">{info.compilerVersion ?? "not recorded"}</div>
        </nav>
        <section className="cx-src-pane" aria-label="Verified source">
          <div className="cx-pane-h">
            <span className="cx-pane-t">{info.sources[file]?.path}</span>
            <span className="muted small">{note ?? (cross ? "click a line to find its opcodes" : "")}</span>
          </div>
          <div className="cx-src" ref={srcRef}>
            {lines.map((ln, i) => {
              const n = i + 1;
              const has = opLines.has(n);
              const inHl = hl && hl.file === file && n >= hl.startLine && n <= hl.endLine;
              return (
                <div
                  key={i}
                  data-n={n}
                  className={"cx-sl" + (has ? " op" : "") + (inHl ? " hl" : "") + (hl && hl.file === file && n === hl.startLine ? " hl0" : "")}
                  {...(has ? { role: "button", tabIndex: 0, onClick: () => clickLine(n), onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") clickLine(n); } } : {})}
                >
                  <span className="cx-sl-n">{n}</span>
                  <span>{highlight(ln)}</span>
                </div>
              );
            })}
          </div>
        </section>
        <section className="cx-op-pane" aria-label="Runtime opcodes">
          <div className="cx-pane-h">
            <span className="cx-pane-t">Runtime opcodes</span>
            <span className="muted small">{ins.length.toLocaleString()} instructions{cross ? ", source map from solc" : ""}</span>
          </div>
          <div className="cx-ops" ref={opsRef}>
            {ins.map((i) => (
              <OpRow key={i.index} ins={i} label={labelOf(i)} on={onOps.has(i.index)} onClick={cross ? () => clickOp(i.index) : undefined} />
            ))}
          </div>
          <RawBytecode code={runtimeCode} />
        </section>
      </div>
      <div style={{ marginTop: 20 }}>
        <Settings info={info} runtimeSize={(runtimeCode.length - 2) / 2} />
      </div>
    </>
  );
}

/** Disassembly for unverified code, with dispatcher entries named from the signature subset. */
export function DisassemblyPane({ runtimeCode }: { runtimeCode: Hex }) {
  const ins = useMemo(() => disassemble(runtimeCode), [runtimeCode]);
  const entries = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of dispatcherEntries(ins)) {
      const fn = lookupFunction(e.selector)[0];
      m.set(e.entryPc, fn ? `${functionSignature(fn)} (${e.selector})` : `unknown ${e.selector}`);
    }
    return m;
  }, [ins]);
  return (
    <>
      <p className="muted small" style={{ marginTop: 0 }}>
        Disassembled from the runtime bytecode. Entry points found in the selector dispatcher are labeled; names come from the
        bundled signature subset, so an unknown selector stays unknown.
      </p>
      <div className="cx-ops wide">
        {ins.map((i) => (
          <div key={i.index}>
            {i.name === "JUMPDEST" && entries.has(i.pc) && (
              <div className="cx-op-lbl">{entries.get(i.pc)} <span className="muted">entry</span></div>
            )}
            <OpRow ins={i} />
          </div>
        ))}
        <RawBytecode code={runtimeCode} />
      </div>
    </>
  );
}
