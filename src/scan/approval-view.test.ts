/**
 * The approval dialog shows every fact the requirement lists, and its Approve
 * button is disabled while anything blocks approval. Rendered to static HTML
 * (react-dom/server) so it runs in the node test environment.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApprovalView, type ApprovalViewProps } from "./approval-view";
import { approvalBlockers, initialApproval, setTyped } from "@/lib/agent/approval";
import { createContractModule } from "@/lib/agent/contractModule";
import { explainPreparedWrite } from "@/lib/agent/explain";
import { fakeChain, ALICE, MALLORY, PROXY, TOKEN } from "@/lib/agent/tests/fakeChain";

const noop = () => {};
async function render(fn: string, args: unknown[], o: { address?: string; typed?: string; connected?: string | null } = {}) {
  const m = createContractModule(fakeChain().deps);
  const p = await m.prepareWrite({ address: (o.address ?? TOKEN) as `0x${string}`, function: fn, args, from: ALICE, origin: "chat" });
  let s = initialApproval(p);
  if (o.typed) s = setTyped(s, o.typed);
  const connected = o.connected === undefined ? ALICE : o.connected;
  const props: ApprovalViewProps = {
    state: s,
    explanation: explainPreparedWrite(p),
    connected,
    blockers: approvalBlockers(s, connected as `0x${string}` | null),
    loading: false,
    error: null,
    busy: false,
    editing: false,
    editArgs: [],
    editValue: "0",
    relayAvailable: false,
    onTyped: noop,
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
    expect(html).toContain(p.target.address);
    expect(html).toContain("Verified");
    expect(html).toContain("transfer(address,uint256)");
    expect(html).toContain(p.call.selector);
    expect(html).toContain(">10<");
    expect(html).toContain("0 SALT");
    expect(html).toContain("Succeeds");
    expect(html).toContain("50000 gas ≈ 0.00005 SALT");
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
    const after = await render("approve", [MALLORY, "5"], { typed: "approve" });
    expect(approveButton(after.html)).not.toContain("disabled");
  });

  it("a reverting call shows the revert reason", async () => {
    const { html } = await render("transfer", [MALLORY, "5000"]);
    expect(html).toContain("Reverts: InsufficientBalance(1000, 5000)");
  });

  it("without a wallet it offers Connect, not Approve", async () => {
    const { html } = await render("transfer", [MALLORY, "1"], { connected: null });
    expect(html).toContain("Connect wallet");
    expect(html).not.toContain("Approve and sign");
  });
});
