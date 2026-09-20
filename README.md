# JevLint

**Slop happens. Don’t ship it.**

Write coding conventions in plain English. JevLint checks what your code means, semantically, so your coding agent can fix what syntax rules miss.

Use it in a **write → check → fix → repeat** workflow: your agent writes code,
JevLint checks it against your conventions, and the agent uses the findings to
make the next edit. Run it from your terminal, an agent’s verification step, or CI.
Your agent or workflow controls when to run checks and how to fix findings;
JevLint supplies the judgments.

JevLint is powered by Jev, TypeSafe AI’s System One model. It sends selected source
files and plugin instructions to the Jev API, then reports the probability that
each file violates a rule. Findings are file-level signals for review, without
line-level diagnostics, generated replacement names, or automatic fixes. The
default finding threshold is `0.8` (80%).

[Website](https://jevlint.com) · [npm](https://www.npmjs.com/package/@jevlint/cli) ·
[GitHub](https://github.com/huntedman/JevLint)

## Get started

Requires **Node.js 24 or newer**. From your project root:

```sh
npm install --save-dev @jevlint/cli
npx jevlint init
```

`init` creates `jevlint.config.json` with `magic-strings` enabled,
`prettyPrint: true`, and exclusions for tests and TypeScript declaration files.
It never overwrites an existing config. Configuration is optional: without one, JevLint scans the current directory with `magic-strings`.

Add your key to `.env` in the directory where you run JevLint:

```dotenv
JEV_API_KEY=your-api-key
```

The CLI loads `.env` automatically; exported shell variables take precedence.
Then run:

```sh
npx jevlint
```

To choose targets, preview requests, or adjust the threshold:

```sh
npx jevlint src
npx jevlint 'src/**/*.ts' --ignore '**/*.test.ts'
npx jevlint src --dry-run
npx jevlint src --threshold 0.9 --format json
```

Quote globs so JevLint expands them. Repeat `--ignore` for additional exclusions.
`--dry-run` prints request JSON without calling the Jev API or requiring a key.
It still imports and executes configured JavaScript and TypeScript plugins with
normal Node.js permissions. Plugin code can read files, modify files, or make its
own network requests, including during a dry run. Only run configurations and
plugins you trust; this flag is not a sandbox for unfamiliar repositories.

Source scanning excludes `secrets/` and `credentials/` directories and files named
`secrets` or `credentials` with any supported extension: `.js`, `.jsx`, `.mjs`,
`.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`. These filename exclusions are not secret
detection: sensitive values in other source files can still be included. Use
`--ignore` or configuration exclusions for additional sensitive files.

## Your rules, your files

Built-in plugins can be enabled by name:

| Plugin              | What it checks                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `magic-strings`     | Application-defined symbolic strings, such as states, modes, and actions, that should use named constants. Ordinary display text, paths, and library-defined values are exempt.                  |
| `descriptive-names` | Vague or misleading identifiers whose purpose is clear enough from the file to justify a better name. Conventional short names, clear local names, and externally defined API names are allowed. |

Enable both across all selected files with:

```json
{
  "plugins": ["magic-strings", "descriptive-names"]
}
```

Or give each plugin its own scope. This example checks separate parts of a project:

```json
{
  "files": ["src"],
  "ignore": ["**/*.test.*", "**/*.d.ts"],
  "plugins": [
    {
      "path": "magic-strings",
      "files": ["src/domain/**"],
      "ignore": ["**/*.generated.ts"]
    },
    {
      "path": "descriptive-names",
      "files": ["src/services/**"],
      "ignore": ["**/*.generated.ts"]
    }
  ],
  "threshold": 0.8,
  "format": "text",
  "prettyPrint": true
}
```

## Plugins from another folder

Write your convention as a yes/no question and export a `plugin` object from
`index.mjs` or `index.ts`. For example, save this as
`custom-plugins/no-debug-logs/index.mjs`:

```js
export const plugin = {
  id: "no-debug-logs",
  instructions:
    "Does this file contain temporary debugging console calls that should be removed? Allow intentional CLI output, operational logging, and error reporting. Judge executable calls, not examples inside strings or comments.",
  message: "Remove temporary debug logging from this file.",
};
```

Register its directory path in your config:

```json
{
  "files": ["src"],
  "plugins": [
    {
      "path": "./custom-plugins/no-debug-logs",
      "files": ["src/**"],
      "ignore": ["**/*.test.ts"]
    }
  ]
}
```

The plugin path is relative to the config file. You can also point directly to a
plugin file. Plugin IDs must be unique within a configuration. `instructions` can
be a string or a structured object or array for more detailed rules and examples.

## Human-readable and machine-readable output

Pretty text is the default: findings are grouped by file, probabilities appear as
percentages, and terminal colours distinguish warnings, errors, and clean results.
Set `"prettyPrint": false` for compact plain text. Use `--color always` or
`--color never` to control colours in pretty output; `NO_COLOR` disables automatic
colours.

For scripts, agents, and CI:

```sh
npx jevlint --format json > report.json
```

You can also set `"format": "json"` in your config. JSON output includes no colours
or progress messages, regardless of `prettyPrint`. Reports contain `plugins`,
`model`, `threshold`, `results`, and `summary`. File failures appear in `results`;
fatal errors use `{ "error": { "message": "..." } }`.

| Exit code | Meaning                                                                |
| --------- | ---------------------------------------------------------------------- |
| `0`       | No findings or analysis failures. Check the summary for skipped files. |
| `1`       | At least one file has a finding at or above the threshold.             |
| `2`       | Configuration or analysis failure.                                     |

Run `npx jevlint --help` for all options. The included
`jevlint.config.example.json` also shows model selection, a custom API-key
environment variable, request timeout, and file-size limits.

## Developing JevLint

From this repository, use the pnpm version pinned in `package.json`:

```sh
pnpm install
pnpm jevlint init
pnpm jevlint src
pnpm test
pnpm typecheck
pnpm build
```

The source CLI also runs through `npm run jevlint -- src`. To get JSON without npm’s
script banner, use `npm run --silent jevlint -- --format json`.

JevLint is an independent project, not affiliated with or endorsed by TypeSafe AI.
Licensed under MIT.
