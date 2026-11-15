import test from "node:test";
import assert from "node:assert/strict";
import { classifyTicket } from "../src/incidentRules.js";

test("classifies network and VPN tickets", () => {
  assert.equal(classifyTicket({ title: "VPN cannot connect" }).category, "NETWORK_VPN");
});

test("classifies Outlook and email tickets", () => {
  assert.equal(classifyTicket({ title: "Outlook mailbox unavailable" }).category, "EMAIL_OUTLOOK");
});

test("uses department and description as correlation signals", () => {
  assert.equal(classifyTicket({ title: "Service failure", department: "IT Network", description: "No connectivity" }).category, "NETWORK_VPN");
});

test("does not guess a category when there is no matching signal", () => {
  assert.equal(classifyTicket({ title: "Need help", description: "Please contact me" }).category, "OTHER");
});
