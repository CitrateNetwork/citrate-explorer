/**
 * The approval dialog shows every fact the requirement lists, and its Approve
 * button is disabled while anything blocks approval. Rendered to static HTML
 * (react-dom/server) so it runs in the node test environment.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalView, type ApprovalViewProps } from "./approval-view";
import { approvalBlockers, initialApproval, setAcknowledged, setTyped } from "@/lib/agent/approval";
import { approvalFacts } from "@/lib/agent/wire";
import { prepareFromRequest } from "@/lib/contract/request";
import { createStoreInfoSource } from "@/lib/contract/infoSources";
import { fakeChain, ALICE, MALLORY, PROXY, TOKEN } from "@/lib/agent/tests/fakeChain";

const noop = () => {};
async function render(fn: string, args: unknown[], o: { address?: string; typed?: string; ack?: boolean; connected?: string | null } = {}) {
  const f = fakeChain();
  // The dialog's preparation path: kit prepareFromRequest from the connected wallet.
  const out = await prepareFromRequest({
    reader: f.reader,
    info: createStoreInfoSource((a) => f.deps.verified(a)),
    request: { address: o.address ?? TOKEN, function: fn, args },
    from: ALICE,
    forwarder: f.deps.forwarder(),
    payableThresholdWei: f.deps.payableThresholdWei(),
  });
  const p = out.prepared;
  const facts = approvalFacts(out, "chat");
  let s = initialApproval(p);
  if (o.typed) s = setTyped(s, o.typed);
  if (o.ack) for (const r of p.risks) if (r.severity === "high") s = setAcknowledged(s, r.code, true);
  const connected = o.connected === undefined ? ALICE : o.connected;
  const props: ApprovalViewProps = {
    state: s,
    target: facts.target,
    explanation: facts.explanation,
    connected,
    blockers: approvalBlockers(s, connected as `0x${string}` | null),
    loading: false,
    error: null,
    busy: false,
    editable: true,
    editing: false,
    editArgs: [],
    editValue: "0",
    relayAvailable: false,
    onTyped: noop,
    onAck: noop,
    onPath: noop,
    onApprove: noop,
    onReject: noop,
    onEdit: noop,
    onEditArg: noop,
    onEditValue: noop,
    onResimulate: noop,
    onCancelEdit: noop,
    onConnect: noop,
    onClose: noop,
  };
  return { html: renderToStaticMarkup(createElement(ApprovalView, props)), p };
}

const approveButton = (html: string) => /<button[^>]*>Approve and sign<\/button>/.exec(html)?.[0] ?? "";

describe("approval dialog content", () => {
  it("shows target + verification, method, args, value in SALT, simulation, gas, flags and chain 40204", async () => {
    const { html, p } = await render("transfer", [MALLORY, "10"]);
    expect(html).toContain("Citrate · chain 40204");
    expect(html).toContain(p.to);
    expect(html).toContain("Verified");
    expect(html).toContain("transfer(address,uint256)");
    expect(html).toContain(p.method.selector);
    expect(html).toContain(">10 <");
    expect(html).toContain("0 SALT");
    expect(html).toContain("succeeds at latest");
    expect(html).toContain("50,000");
    expect(html).toContain("About 50000 gas");
    expect(html).toContain("No specific risk flags");
    expect(html).toContain("Reject");
    expect(html).toContain("Edit");
    expect(approveButton(html)).not.toContain("disabled");
  });

  it("shows a proxy and its implementation", async () => {
    const { html } = await render("stake", ["1"], { address: PROXY });
    expect(html).toContain("Proxy · implementation verified");
    expect(html).toMatch(/eip1967 proxy → implementation/);
  });

  it("an elevated call shows its flags, asks for the typed phrase and keeps Approve disabled until typed", async () => {
    const before = await render("approve", [MALLORY, "5"]);
    expect(before.html).toContain("This lets");
    expect(before.html).toContain('Type <strong class="mono">approve</strong> to confirm');
    expect(approveButton(before.html)).toContain("disabled");
    const typedOnly = await render("approve", [MALLORY, "5"], { typed: "approve" });
    expect(approveButton(typedOnly.html)).toContain("disabled");
    const after = await render("approve", [MALLORY, "5"], { typed: "approve", ack: true });
    expect(approveButton(after.html)).not.toContain("disabled");
  });

  it("every high risk has its own I-understand box (the kit rule), and approval waits for all of them", async () => {
    const { html, p } = await render("approve", [MALLORY, "5"], { typed: "approve" });
    const highs = p.risks.filter((r) => r.severity === "high");
    expect(highs.length).toBeGreaterThan(0);
    for (const r of highs) expect(html).toContain(`aria-label="I understand: ${r.code}"`);
    expect(html).toContain("acknowledge");
  });

  it("a reverting call shows the revert reason", async () => {
    const { html } = await render("transfer", [MALLORY, "5000"]);
    expect(html).toContain("reverts: InsufficientBalance(have: 1000, want: 5000)");
  });

  it("without a wallet it offers Connect, not Approve", async () => {
    const { html } = await render("transfer", [MALLORY, "1"], { connected: null });
    expect(html).toContain("Connect wallet");
    expect(html).not.toContain("Approve and sign");
  });
});
