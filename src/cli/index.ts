#!/usr/bin/env node

import process from "node:process";

import {
  createMcpApplicationRuntime,
  serveMcpStdio,
} from "../features/mcp-server/index.js";
import {
  isInstallationCommand,
  runInstallationCommand,
} from "../features/installation/index.js";
import { runCli } from "./main.js";

const arguments_ = process.argv.slice(2);
if (arguments_.length > 0) {
  process.exitCode = isInstallationCommand(arguments_)
    ? await runInstallationCommand(arguments_, { write: writeDiagnostic })
    : runCli(arguments_, writeDiagnostic);
} else {
  try {
    const runtime = await createMcpApplicationRuntime();
    const application = serveMcpStdio(runtime);
    const close = (): void => {
      void application.close().finally(() => {
        process.exitCode = 0;
      });
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
  } catch {
    writeDiagnostic("Invalid startup configuration.\n");
    process.exitCode = 78;
  }
}

function writeDiagnostic(message: string): void {
  process.stderr.write(message);
}
