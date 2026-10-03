import { describe, expect, test } from "bun:test";
import { DEMO_INVOICES, DEMO_MAIL, demoMailLabel, searchInvoices } from "../src/lib/jev-mailbox-demo";

describe("demo mailbox", () => {
  test("every demo sender is fictional or a brand notice on a .test domain", () => {
    for (const m of DEMO_MAIL) expect(m.email.endsWith(".test")).toBe(true);
  });
  test("simulated labels put each email in its pile with odds that add up", () => {
    DEMO_MAIL.forEach((m, i) => {
      const l = demoMailLabel(m, i);
      expect(l.category).toBe(m.category);
      const a = l.decision.answers.category;
      if (a.type !== "choice") throw new Error("expected a choice");
      const sum = Object.values(a.probabilities).reduce((s, p) => s + p, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(0.02);
      expect(a.probabilities[m.category]).toBe(Math.max(...Object.values(a.probabilities)));
    });
  });
});

describe("invoice search", () => {
  test("finds the Halden invoice from August first", () => {
    const r = searchInvoices("the Halden invoice from August");
    expect(r.single).toBe(true);
    expect(r.matches[0].invoice.number).toBe("INV-2026-081");
    expect(r.matches[0].odds).toBeGreaterThan(0.8);
  });
  test("unpaid over 30 days returns only open invoices older than 30 days", () => {
    const r = searchInvoices("unpaid over 30 days");
    expect(r.matches.length).toBeGreaterThan(0);
    for (const h of r.matches) {
      expect(h.invoice.status).not.toBe("paid");
      expect(Date.parse("2026-09-28") - Date.parse(h.invoice.issued)).toBeGreaterThan(30 * 86_400_000);
    }
    const open = DEMO_INVOICES.filter((i) => i.status !== "paid" && Date.parse("2026-09-28") - Date.parse(i.issued) > 30 * 86_400_000);
    expect(r.matches.length).toBe(open.length);
  });
  test("an invoice number goes straight to that invoice", () => {
    expect(searchInvoices("INV-0412").matches[0].invoice.client).toBe("Cutroom Studio");
  });
  test("nonsense finds nothing", () => {
    expect(searchInvoices("purple elephants").matches).toHaveLength(0);
  });
});
