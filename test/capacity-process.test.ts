import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const workerPath = fileURLToPath(
  new URL("./fixtures/capacity-worker.ts", import.meta.url),
);

void test("shares two slots across processes and recovers a crashed owner", async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "lmw-process-capacity-"),
  );
  const children: ChildProcess[] = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    await rm(directory, { recursive: true, force: true });
  });

  const first = startWorker(directory, "first");
  const second = startWorker(directory, "second");
  children.push(first, second);
  await Promise.all([
    waitForMessage(first, "acquired"),
    waitForMessage(second, "acquired"),
  ]);

  const third = startWorker(directory, "third");
  children.push(third);
  const thirdAcquisition = waitForMessage(third, "acquired");
  let thirdAcquired = false;
  third.on("message", (message: WorkerMessage) => {
    if (message.type === "acquired") {
      thirdAcquired = true;
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(thirdAcquired, false);

  first.kill("SIGKILL");
  await waitForExit(first);
  await thirdAcquisition;
  assert.equal(thirdAcquired, true);

  second.send("release");
  third.send("release");
  await Promise.all([waitForExit(second), waitForExit(third)]);
});

interface WorkerMessage {
  readonly type: "acquired" | "released";
  readonly task_id: string;
}

function startWorker(directory: string, taskId: string): ChildProcess {
  return fork(workerPath, [directory, taskId], {
    execArgv: ["--import", "tsx"],
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });
}

function waitForMessage(
  child: ChildProcess,
  type: WorkerMessage["type"],
): Promise<WorkerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`worker did not send ${type}`));
    }, 5_000);
    const onMessage = (message: WorkerMessage): void => {
      if (message.type === type) {
        cleanup();
        resolve(message);
      }
    };
    const onExit = (): void => {
      cleanup();
      reject(new Error(`worker exited before ${type}`));
    };
    const cleanup = (): void => {
      clearTimeout(timeout);
      child.off("message", onMessage);
      child.off("exit", onExit);
    };
    child.on("message", onMessage);
    child.once("exit", onExit);
  });
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
  });
}
