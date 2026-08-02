import { rm } from "node:fs/promises";
import { URL } from "node:url";

const buildDirectory = new URL("../dist/", import.meta.url);

await rm(buildDirectory, { force: true, recursive: true });
