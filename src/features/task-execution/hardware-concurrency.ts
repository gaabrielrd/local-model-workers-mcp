import os from "node:os";

/**
 * Calculates optimal task concurrency based on available system hardware memory and CPU cores.
 */
export function getHardwareConcurrency(
  totalMemoryBytes: number = os.totalmem(),
  cpuCount: number = os.cpus().length,
): number {
  const gigaBytes = totalMemoryBytes / (1024 * 1024 * 1024);

  if (gigaBytes < 8 || cpuCount <= 2) {
    return 1;
  }

  if (gigaBytes < 16 || cpuCount <= 4) {
    return 2;
  }

  return Math.min(4, Math.max(2, Math.floor(cpuCount / 2)));
}
