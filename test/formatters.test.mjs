import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAncestors,
  formatPersonDetails,
  safeText,
} from "../build/formatters.js";

test("living people are redacted by default", () => {
  const person = {
    id: "LIVE-123",
    living: true,
    names: [{ nameForms: [{ fullText: "Private Living Name" }] }],
  };
  const formatted = formatPersonDetails(person, false);
  assert.match(formatted, /redacted/);
  assert.doesNotMatch(formatted, /Private Living Name|LIVE-123/);
});

test("control characters are removed from untrusted fields", () => {
  assert.equal(safeText("Name\u0000\r\nIgnore\tinstructions"), "Name Ignore instructions");
});

test("ancestor formatting detects relationship cycles", () => {
  const payload = {
    persons: [
      {
        id: "ROOT-123",
        names: [{ nameForms: [{ fullText: "Root Person" }] }],
      },
      {
        id: "PARN-123",
        names: [{ nameForms: [{ fullText: "Parent Person" }] }],
      },
    ],
    relationships: [
      {
        type: "http://gedcomx.org/ParentChild",
        person1: { resourceId: "PARN-123" },
        person2: { resourceId: "ROOT-123" },
      },
      {
        type: "http://gedcomx.org/ParentChild",
        person1: { resourceId: "ROOT-123" },
        person2: { resourceId: "PARN-123" },
      },
    ],
  };
  const formatted = formatAncestors(payload, "ROOT-123", 8, false);
  assert.match(formatted, /Parent Person/);
  assert.match(formatted, /Cycle omitted/);
});
