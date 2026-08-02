#!/usr/bin/env node

import process from "node:process";

import { runCli } from "./main.js";

process.exitCode = runCli(process.argv.slice(2), (message) => {
  process.stderr.write(message);
});
