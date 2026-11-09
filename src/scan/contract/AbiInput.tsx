"use client";

/**
 * ABI-generated inputs (EXP-S3): scalars as text fields, tuples as grouped fields,
 * arrays with add/remove rows (fixed arrays have a fixed row count). Values are the
 * FormValue shape from src/lib/contract/abiForm.ts, which parses them.
 */
import type { AbiParameter } from "viem";
import { arrayInfo, emptyValue, typeLabel, type FormValue } from "@/lib/contract/abiForm";

type TupleParam = AbiParameter & { components?: readonly AbiParameter[] };

function placeholder(t: string): string {
  if (t === "address") return "0x… (20 bytes)";
  if (t === "bool") return "true or false";
  if (t === "string") return "text";
  if (t === "bytes") return "0x…";
  const n = /^bytes(\d+)$/.exec(t);
  if (n) return `0x… (${n[1]} bytes)`;
  if (/^u?int/.test(t)) return t.startsWith("u") ? "0 (decimal or 0x hex)" : "-1, 0, 1 (decimal or 0x hex)";
  return t;
}

export function AbiInput({
  param,
  value,
  onChange,
  id,
  error,
  label,
}: {
  param: AbiParameter;
  value: FormValue;
  onChange: (v: FormValue) => void;
  id: string;
  error?: string | null;
  label?: string;
}) {
  const name = label ?? (param.name || "value");
  const arr = arrayInfo(param);
  if (arr) {
    const items = Array.isArray(value) ? value : [];
    return (
      <fieldset className="cx-group">
        <legend className="cx-legend">
          {name} <span className="mono muted">{typeLabel(param)}</span>
        </legend>
        {items.length === 0 && <span className="muted small">empty list</span>}
        {items.map((item, i) => (
          <div className="cx-row" key={i} style={{ alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <AbiInput param={arr.inner} value={item} id={`${id}-${i}`} label={`${name}[${i}]`} onChange={(v) => onChange(items.map((x, k) => (k === i ? v : x)))} />
            </div>
            {arr.length === null && (
              <button type="button" className="cx-btn ghost sm" aria-label={`Remove ${name}[${i}]`} onClick={() => onChange(items.filter((_, k) => k !== i))}>
                Remove
              </button>
            )}
          </div>
        ))}
        {arr.length === null && (
          <div>
            <button type="button" className="cx-btn ghost sm" onClick={() => onChange([...items, emptyValue(arr.inner)])}>
              Add item
            </button>
          </div>
        )}
        {error && <span className="cx-err" role="alert">{error}</span>}
      </fieldset>
    );
  }
  if (param.type === "tuple") {
    const comps = (param as TupleParam).components ?? [];
    const vals = Array.isArray(value) ? value : comps.map(emptyValue);
    return (
      <fieldset className="cx-group">
        <legend className="cx-legend">
          {name} <span className="mono muted">{typeLabel(param)}</span>
        </legend>
        {comps.map((c, i) => (
          <AbiInput key={i} param={c} value={vals[i]} id={`${id}-${i}`} label={c.name || `field ${i}`} onChange={(v) => onChange(vals.map((x, k) => (k === i ? v : x)))} />
        ))}
        {error && <span className="cx-err" role="alert">{error}</span>}
      </fieldset>
    );
  }
  const text = typeof value === "string" ? value : "";
  return (
    <div className="cx-field">
      <label htmlFor={id}>
        {name} <span className="mono muted">{param.type}</span>
      </label>
      {param.type === "bool" ? (
        <select id={id} value={text} onChange={(e) => onChange(e.target.value)} aria-invalid={error ? "true" : "false"}>
          <option value="">choose</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <input id={id} className="mono" autoComplete="off" spellCheck={false} placeholder={placeholder(param.type)} value={text} aria-invalid={error ? "true" : "false"} onChange={(e) => onChange(e.target.value)} />
      )}
      {error && <span className="cx-err" role="alert">{error}</span>}
    </div>
  );
}
