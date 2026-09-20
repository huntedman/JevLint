export const plugin = {
  id: "descriptive-names",
  instructions: {
    question:
      "Does the source in this file declare at least one application-owned identifier whose vague or misleading name materially obscures its purpose, and whose role is clear enough from the visible code to justify a more descriptive name?",
    rules: [
      "Judge variable, parameter, function, method, class, type, interface, and application-owned property names by their meaning in context. A violation must concern a declaration in this file, not a name merely imported or referenced here.",
      "Flag placeholders such as doStuff, handleThing, foo, bar, tmp, obj, or data only when they conceal a specific role visible in the code. Include arbitrary letters or numbered names used for distinct domain concepts, and names that contradict the work performed or the value stored.",
      "Prefer names that reveal the relevant concept, action, or unit. Do not demand longer names for their own sake, an exact preferred synonym, a naming convention, or redundant repetition of information already obvious in a small scope.",
      "Allow conventional short names when their meaning is clear: i and j as loop indices, x and y as coordinates, a and b in a short comparator, T in generic utilities, and well-known abbreviations such as id, url, HTTP, and SQL.",
      "Allow contextual names such as data, value, result, item, key, error, req, and res in short generic helpers, callbacks, or framework handlers when their role is obvious. Do not apply a blacklist or minimum name length.",
      "Do not flag external API fields, serialized wire keys, database columns, imported library identifiers, framework-required hooks, or interface-mandated method names merely for style. Local aliases and internal domain names remain eligible when the file establishes a clearer role.",
      "Do not infer a domain concept that is absent from the file. Ignore identifier-like text inside strings or comments, including examples used as data. If the only concern is subjective preference, insufficient context, or a name outside this file's control, answer no.",
    ],
    examples: {
      compliant: [
        {
          code: `
            function getOverdueInvoiceIds(invoices) {
              return invoices
                .filter(invoice => invoice.isOverdue)
                .map(invoice => invoice.invoiceId);
            }
          `,
          reason:
            "The function and parameter names describe the visible invoice-selection responsibility.",
        },
        {
          code: `
            function identity<T>(value: T): T {
              return value;
            }

            function compareNumbers(a: number, b: number) {
              return a - b;
            }
          `,
          reason:
            "Generic values and short comparator parameters have clear conventional meanings.",
        },
      ],
      violations: [
        {
          code: `
            function doStuff(data) {
              return data.filter(x => x.isOverdue).map(x => x.invoiceId);
            }
          `,
          reason:
            "The function and parameter names conceal the specific responsibility of selecting overdue invoice IDs.",
        },
      ],
    },
  },
  message:
    "Unclear names: rename vague or misleading identifiers to describe their role in this file.",
} as const;
