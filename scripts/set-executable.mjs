import { chmod } from "node:fs/promises";
import { URL } from "node:url";

const cliEntryPoint = new URL("../dist/cli/index.js", import.meta.url);

await chmod(cliEntryPoint, 0o755);
