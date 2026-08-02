import { createFileSystemCapacityCoordinator } from "../../src/features/task-execution/index.js";

const stateDirectory = process.argv[2];
const taskId = process.argv[3];
if (stateDirectory === undefined || taskId === undefined) {
  throw new Error("capacity worker requires state directory and task id");
}

const coordinator = createFileSystemCapacityCoordinator({
  stateDirectory,
  capacity: 2,
  pollIntervalMs: 5,
});

let release: (() => void) | undefined;
const released = new Promise<void>((resolve) => {
  release = resolve;
});
process.on("message", (message: unknown) => {
  if (message === "release") {
    release?.();
  }
});

await coordinator.runWithCapacity(
  { task_id: taskId, queue_timeout_ms: 5_000 },
  async () => {
    process.send?.({ type: "acquired", task_id: taskId });
    await released;
  },
);
process.send?.({ type: "released", task_id: taskId });
process.disconnect();
