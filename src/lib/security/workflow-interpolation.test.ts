/**
 * Tripwire: no GitHub Actions `run:` script may contain a `${{ ... }}`
 * expression. Expressions are substituted into the script text before the
 * shell parses it, so any value derived from PR content (file names, titles,
 * step outputs computed from them) becomes shell syntax. Values go through
 * `env:` and are referenced as quoted shell variables instead.
 *
 * The scanner is deliberately small (no YAML dependency): it finds each `run:`
 * key, takes its inline value or its indented block scalar, and reports any
 * `${{` inside. The negative controls below prove it fires.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface Hit {
  line: number;
  text: string;
}

export function runScriptInterpolations(yaml: string): Hit[] {
  const lines = yaml.split(/\r?\n/);
  const hits: Hit[] = [];
  const RUN = /^(\s*)(?:-\s+)?run:\s*(.*)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = RUN.exec(lines[i]);
    if (!m) continue;
    const keyIndent = lines[i].indexOf("run:");
    const inline = m[2].replace(/\s+#.*$/, "");
    if (/^[|>][-+0-9]*$/.test(inline.trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j];
        if (l.trim() === "") continue;
        const indent = l.length - l.trimStart().length;
        if (indent <= keyIndent) break;
        if (l.includes("${{")) hits.push({ line: j + 1, text: l.trim() });
      }
    } else if (inline.includes("${{")) {
      hits.push({ line: i + 1, text: lines[i].trim() });
    }
  }
  return hits;
}

const WORKFLOWS = join(process.cwd(), ".github", "workflows");

describe("workflow run: scripts never interpolate expressions", () => {
  const files = readdirSync(WORKFLOWS).filter((f) => /\.ya?ml$/.test(f));

  it("finds the workflow directory", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    it(`${f} has no \${{ }} inside a run: script`, () => {
      expect(runScriptInterpolations(readFileSync(join(WORKFLOWS, f), "utf8"))).toEqual([]);
    });
  }
});

describe("scanner negative controls", () => {
  it("flags an expression inside a block run: script", () => {
    const y = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - name: lint",
      "        run: |",
      "          echo start",
      "          ./check.py ${{ steps.changed.outputs.list }}",
      "      - name: next",
      "        run: echo ok",
    ].join("\n");
    expect(runScriptInterpolations(y)).toEqual([{ line: 7, text: "./check.py ${{ steps.changed.outputs.list }}" }]);
  });

  it("flags an expression in an inline run: value and in a folded block", () => {
    const y = [
      "steps:",
      "  - run: echo ${{ github.event.pull_request.title }}",
      "  - run: >-",
      "      echo ${{ github.head_ref }}",
    ].join("\n");
    expect(runScriptInterpolations(y).map((h) => h.line)).toEqual([2, 4]);
  });

  it("allows expressions in env:, if: and with: (the safe channel)", () => {
    const y = [
      "steps:",
      "  - if: ${{ steps.a.outputs.has_files == '1' }}",
      "    env:",
      "      LIST: ${{ steps.a.outputs.list }}",
      "    run: |",
      '      printf "%s\\n" "$LIST" | ./check.py',
      "  - uses: actions/checkout@v4",
      "    with:",
      "      ref: ${{ github.sha }}",
    ].join("\n");
    expect(runScriptInterpolations(y)).toEqual([]);
  });

  it("stops the block at the next key at the same indentation", () => {
    const y = ["  - run: |", "      echo safe", "    env:", "      X: ${{ github.sha }}"].join("\n");
    expect(runScriptInterpolations(y)).toEqual([]);
  });
});
