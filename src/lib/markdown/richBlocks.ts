/**
 * Lightweight block parser for the agent's chat answers (used by agent.tsx's
 * renderRich). Splits text into paragraph / ordered-list / unordered-list / TABLE
 * blocks. Markdown tables matter: the agent is told to use them for multi-row
 * answers (transfers, holders), and without this they render as raw `| --- |` pipes.
 *
 * Pure (no JSX/DOM) so it's unit-tested; the component maps blocks → elements.
 */

export type RichBlock =
  | { type: "p"; text: string }
  | { type: "ol"; items: string[] }
  | { type: "ul"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] };

/** A markdown table row → trimmed cells (tolerant of optional leading/trailing pipes). */
export function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** The `|---|:--:|---|` separator beneath a header row. */
export function isTableSep(line: string): boolean {
  return /\|/.test(line) && /^[\s|:-]+$/.test(line.trim()) && line.includes("-");
}

/** A plausible table row: at least one internal pipe. */
export function isTableRow(line: string): boolean {
  return /\S\s*\|\s*\S/.test(line) || /^\s*\|.*\|/.test(line);
}

export function parseRichBlocks(text: string): RichBlock[] {
  const lines = String(text).split("\n");
  const blocks: RichBlock[] = [];
  let list: string[] | null = null;
  let listType: "ol" | "ul" | null = null;
  const flush = () => {
    if (list && listType) blocks.push({ type: listType, items: list });
    list = null;
    listType = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { flush(); continue; }

    // Markdown table: a header row immediately followed by a |---| separator.
    if (isTableRow(t) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flush();
      const header = tableCells(t);
      const rows: string[][] = [];
      i += 2; // skip header + separator
      while (i < lines.length && lines[i].trim() && isTableRow(lines[i])) {
        rows.push(tableCells(lines[i]));
        i++;
      }
      i--; // the for-loop re-increments
      blocks.push({ type: "table", header, rows });
      continue;
    }

    let m: RegExpMatchArray | null;
    if ((m = t.match(/^(\d+)\.\s+(.*)/))) {
      if (listType !== "ol") { flush(); listType = "ol"; list = []; }
      list!.push(m[2]);
    } else if ((m = t.match(/^[-*]\s+(.*)/))) {
      if (listType !== "ul") { flush(); listType = "ul"; list = []; }
      list!.push(m[1]);
    } else {
      flush();
      blocks.push({ type: "p", text: t });
    }
  }
  flush();
  return blocks;
}
