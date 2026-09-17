#!/usr/bin/env node
import process from "node:process";
import { runCli } from "#jevlint/cli.ts";

const result = await runCli({
  args: process.argv.slice(2),
  cwd: process.cwd(),
  environment: process.env,
  writeProgress: ({ text }) => {
    process.stderr.write(text);
  },
});

process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
