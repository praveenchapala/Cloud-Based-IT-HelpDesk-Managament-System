const CATEGORY_RULES = [
  { category: "NETWORK_VPN", label: "Network / VPN", terms: ["vpn", "network", "connectivity", "wifi", "wi-fi", "internet", "connection"] },
  { category: "EMAIL_OUTLOOK", label: "Email / Outlook", terms: ["outlook", "email", "mailbox", "exchange", "mail server"] },
  { category: "HARDWARE", label: "Hardware", terms: ["laptop", "desktop", "keyboard", "monitor", "computer", "hardware"] },
  { category: "PRINTING", label: "Printing", terms: ["printer", "printing", "print queue", "toner"] },
  { category: "ACCESS_PASSWORD", label: "Access / Password", terms: ["login", "password", "account locked", "access denied", "authentication", "sign in"] },
  { category: "BUSINESS_APPLICATIONS", label: "Business Applications", terms: ["erp", "crm", "application unavailable", "application error", "business app", "software unavailable"] }
];

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function classifyTicket(ticket) {
  const haystack = normalizeText(`${ticket?.title || ""} ${ticket?.description || ""} ${ticket?.department || ""}`);
  for (const rule of CATEGORY_RULES) {
    if (rule.terms.some((term) => haystack.includes(term))) {
      return { category: rule.category, label: rule.label };
    }
  }
  return { category: "OTHER", label: "Other" };
}
