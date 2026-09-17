export const plugin = {
  id: "magic-strings",
  instructions: {
    question:
      "Does this file contain at least one application-defined symbolic string literal that should be replaced with a named member of a descriptive constant object?",
    rules: [
      "Flag raw strings representing application-defined states, modes, actions, kinds, or other finite program choices, even when used only once. Include comparisons, switch cases, assignments, arguments, defaults, and independently repeated literal unions or validation choices.",
      "Require a descriptive constant object with named members, such as FocusState.tabs. In TypeScript use as const and derive the value type from that object; reuse members in runtime checks and schemas. Preserve existing serialized values.",
      "Allow literal values in the authoritative constant definition, including named factories such as defineError({ kind: 'example' }) that expose the value as a reusable member. Do not require a second constant for that definition. Reuse an existing constant when shown; otherwise a constant should belong to the relevant concept, not a global bag of unrelated strings.",
      "Do not flag ordinary display text, messages, paths, import specifiers, URLs, CSS classes, selectors, property keys, or language/platform/library-defined values such as typeof value === 'string' and DOM keyboard keys. Repetition alone is not evidence of a magic string.",
      "Do not flag SQL statements, fragments, database identifiers, or database-defined configuration syntax and values, including SQLite PRAGMA expressions. Choosing a database setting does not make its SQL syntax an application-defined symbolic string.",
      "Never flag primitive booleans or their serialized 'true' / 'false' values, including environment variables and DOM dataset attributes. An application-specific property name does not turn a boolean into a symbolic string.",
      "Library-owned values remain exempt when application code compares them, such as Kysely migration.status === 'Success'. Apply these exceptions before deciding whether a string represents a finite choice.",
      "Allow package-resolution condition names in compiler and resolver configuration, such as customConditions: ['development']. They do not need application constants, even when the project chooses the names.",
      "Answer yes only for violations requiring a change in this file. Exempt or compliant code must receive no finding. Do not invent unseen constants or require changes to dependencies. Exemptions do not cover unrelated application states merely because they use the same string.",
    ],
    examples: {
      violation:
        'type FocusState = "tabs" | "browser"; const active = state.focus === "tabs";',
      compliant:
        'const FocusState = { tabs: "tabs", browser: "browser" } as const; type FocusState = (typeof FocusState)[keyof typeof FocusState]; const active = state.focus === FocusState.tabs;',
    },
  },
  message:
    "Possible magic strings: replace application-defined symbolic literals with named members of a descriptive constant object.",
} as const;
