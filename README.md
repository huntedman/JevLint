# JevLint

JevLint is a configurable semantic linter for JavaScript and TypeScript, powered by
Jev. Its built-in `magic-strings` plugin checks for application-defined string
literals, such as states, modes, and actions, that should use named constants.
Ordinary display text, paths, and library-defined values are exempt.

JevLint sends each selected file's source to the Jev API and reports file-level
probabilities. The default threshold for a finding is `0.8`.

## Getting started

Requires Node.js 22.18 or newer. Install in your project:

```sh
npm install --save-dev @jevlint/cli
```

Add your API key to a `.env` file in the directory where you run JevLint:

```dotenv
JEV_API_KEY=your-api-key
```

Then run:

```sh
npx jevlint src
npx jevlint 'src/**/*.ts' --ignore '**/*.test.ts'
npx jevlint src --threshold 0.9 --format json
```

The CLI loads `.env` automatically. You can also export `JEV_API_KEY` in your shell;
exported variables take precedence. To preview request JSON without calling the
API or needing a key, use `npx jevlint src --dry-run`.

## Configuration

Configuration is optional. Run this from your repository root to create it:

```sh
npx jevlint init
npx jevlint
```

`init` creates `jevlint.config.json` with the built-in `magic-strings` plugin and
scans the current directory, excluding tests and TypeScript declaration files.
It needs no API key and refuses to overwrite an existing config. Use
`jevlint init --config path/to/config.json` to choose another file in an existing
directory.

Edit `files`, `ignore`, `plugins`, `model`, or `threshold` as needed. Configured paths
are relative to the config file's directory. Command-line targets are relative to
the working directory and replace configured `files`; without either, JevLint scans
the current directory. Common generated and dependency directories are excluded
automatically.

JevLint only scans files inside the directory where you run it. External paths
and symlinks resolving outside that directory are excluded. Dependency directories
(`node_modules`, `bower_components`, `vendor`, `.yarn`, `.pnpm`, and `.pnpm-store`)
are excluded even when explicitly targeted. Add other external-code directories
to your config's `ignore` list.

Use `--config path/to/config.json` to load another configuration. Custom plugins
can be registered by path and export a `plugin` object with `id`, `instructions`,
and `message`; see [the built-in plugin](https://github.com/huntedman/JevLint/blob/main/plugins/magic-strings/index.ts).

Run `npx jevlint --help` for all options. Exit codes are `0` for no findings,
`1` for findings, and `2` for configuration or analysis failures.

## Running from source

From this repository, use pnpm (the version is pinned in `package.json`):

```sh
pnpm install
pnpm jevlint src
```

The example configuration is at `jevlint.config.example.json` in the repository
root. Run `pnpm test`, `pnpm typecheck`, and `pnpm build` to check and build changes.
