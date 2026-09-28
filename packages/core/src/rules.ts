/**
 * Smart-collection rules in disjunctive normal form:
 *   match if ANY group matches; a group matches if ALL its conditions match.
 * Example ("Cybersecurity"):
 *   groups: [
 *     [tag is cybersecurity],
 *     [domain contains hacktricks.xyz],
 *     [domain contains github.com, tag is security],
 *   ]
 */
import { z } from "zod";
import { SAVE_TYPES } from "./schemas";

export const RULE_FIELDS = ["tag", "domain", "type", "title", "url", "text"] as const;
export type RuleField = (typeof RULE_FIELDS)[number];
export const RULE_OPS = ["is", "is_not", "contains", "not_contains"] as const;
export type RuleOp = (typeof RULE_OPS)[number];

export const RULE_FIELD_LABELS: Record<RuleField, string> = {
  tag: "Tag",
  domain: "Domain",
  type: "Type",
  title: "Title",
  url: "URL",
  text: "Any text",
};
export const RULE_OP_LABELS: Record<RuleOp, string> = {
  is: "is",
  is_not: "is not",
  contains: "contains",
  not_contains: "does not contain",
};

export const ruleCondition = z.object({
  field: z.enum(RULE_FIELDS),
  op: z.enum(RULE_OPS),
  value: z.string().trim().min(1).max(200),
});
export type RuleCondition = z.infer<typeof ruleCondition>;

export const smartRules = z.object({
  groups: z.array(z.array(ruleCondition).min(1).max(10)).min(1).max(10),
});
export type SmartRules = z.infer<typeof smartRules>;

/** Minimal save shape needed to evaluate rules in memory (tests, previews). */
export interface RuleSubject {
  title: string;
  url: string | null;
  domain: string | null;
  type: string;
  tags: string[];
  description?: string | null;
  notes?: string | null;
}

function textMatch(haystack: string, op: RuleOp, needle: string) {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  switch (op) {
    case "is":
      return h === n;
    case "is_not":
      return h !== n;
    case "contains":
      return h.includes(n);
    case "not_contains":
      return !h.includes(n);
  }
}

export function matchesCondition(s: RuleSubject, c: RuleCondition): boolean {
  switch (c.field) {
    case "tag": {
      const v = c.value.toLowerCase().replace(/^#/, "");
      const has =
        c.op === "contains" || c.op === "not_contains"
          ? s.tags.some((t) => t.includes(v))
          : s.tags.includes(v);
      return c.op === "is" || c.op === "contains" ? has : !has;
    }
    case "domain":
      return textMatch(s.domain ?? "", c.op, c.value);
    case "type":
      return textMatch(s.type, c.op, c.value);
    case "title":
      return textMatch(s.title, c.op, c.value);
    case "url":
      return textMatch(s.url ?? "", c.op, c.value);
    case "text":
      return textMatch(
        [s.title, s.description, s.notes, s.url].filter(Boolean).join(" "),
        c.op,
        c.value,
      );
  }
}

export function matchesRules(s: RuleSubject, rules: SmartRules): boolean {
  return rules.groups.some((g) => g.every((c) => matchesCondition(s, c)));
}

export function describeRules(rules: SmartRules): string {
  return rules.groups
    .map((g) =>
      g
        .map(
          (c) => `${RULE_FIELD_LABELS[c.field].toLowerCase()} ${RULE_OP_LABELS[c.op]} "${c.value}"`,
        )
        .join(" and "),
    )
    .join("  or  ");
}

export const TYPE_OPTIONS = SAVE_TYPES;
