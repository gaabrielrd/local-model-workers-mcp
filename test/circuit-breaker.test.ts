import assert from "node:assert/strict";
import test from "node:test";

import { CircuitBreaker } from "../src/features/model-inference/index.js";

void test("starts in closed state", () => {
  const breaker = new CircuitBreaker();
  assert.equal(breaker.getState(), "closed");
});

void test("allows requests in closed state", () => {
  const breaker = new CircuitBreaker();
  assert.equal(breaker.allowRequest(), true);
});

void test("remains closed after failures below threshold", () => {
  const breaker = new CircuitBreaker({ failureThreshold: 5 });
  for (let i = 0; i < 4; i++) {
    breaker.recordFailure();
  }
  assert.equal(breaker.getState(), "closed");
  assert.equal(breaker.allowRequest(), true);
});

void test("opens after reaching failure threshold", () => {
  const breaker = new CircuitBreaker({ failureThreshold: 5 });
  for (let i = 0; i < 5; i++) {
    breaker.recordFailure();
  }
  assert.equal(breaker.getState(), "open");
  assert.equal(breaker.allowRequest(), false);
});

void test("transitions from open to half-open after cooldown", () => {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    cooldownMs: 1000,
    now: () => clock,
  });

  // Open circuit
  for (let i = 0; i < 5; i++) {
    breaker.recordFailure();
  }
  assert.equal(breaker.getState(), "open");

  // Advance time past cooldown
  clock = 1001;
  assert.equal(breaker.getState(), "half-open");
  assert.equal(breaker.allowRequest(), true);
});

void test("stays open before cooldown elapses", () => {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    cooldownMs: 1000,
    now: () => clock,
  });

  // Open circuit
  for (let i = 0; i < 5; i++) {
    breaker.recordFailure();
  }

  // Advance time to just before cooldown
  clock = 999;
  assert.equal(breaker.getState(), "open");
  assert.equal(breaker.allowRequest(), false);
});

void test("closes on success in half-open state", () => {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    cooldownMs: 1000,
    now: () => clock,
  });

  // Open circuit
  for (let i = 0; i < 5; i++) {
    breaker.recordFailure();
  }

  // Advance time past cooldown to reach half-open
  clock = 1001;
  assert.equal(breaker.getState(), "half-open");

  // Record success should close it
  breaker.recordSuccess();
  assert.equal(breaker.getState(), "closed");
});

void test("reopens on failure in half-open state", () => {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 5,
    cooldownMs: 1000,
    now: () => clock,
  });

  // Open circuit
  for (let i = 0; i < 5; i++) {
    breaker.recordFailure();
  }

  // Advance time past cooldown to reach half-open
  clock = 1001;
  assert.equal(breaker.getState(), "half-open");

  // Record failure should reopen it
  breaker.recordFailure();
  assert.equal(breaker.getState(), "open");
});

void test("reset returns to closed state", () => {
  const breaker = new CircuitBreaker({ failureThreshold: 5 });

  // Open circuit
  for (let i = 0; i < 5; i++) {
    breaker.recordFailure();
  }
  assert.equal(breaker.getState(), "open");

  breaker.reset();
  assert.equal(breaker.getState(), "closed");
  assert.equal(breaker.allowRequest(), true);
});

void test("success in closed state keeps it closed and resets failure count", () => {
  const breaker = new CircuitBreaker({ failureThreshold: 5 });

  // 3 failures
  for (let i = 0; i < 3; i++) {
    breaker.recordFailure();
  }

  // Success resets failure count
  breaker.recordSuccess();
  assert.equal(breaker.getState(), "closed");

  // Now need 5 failures to open, not 2
  for (let i = 0; i < 4; i++) {
    breaker.recordFailure();
  }
  assert.equal(breaker.getState(), "closed");

  // 5th failure opens it
  breaker.recordFailure();
  assert.equal(breaker.getState(), "open");
});

void test("uses custom threshold and cooldown", () => {
  let clock = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 2,
    cooldownMs: 100,
    now: () => clock,
  });

  breaker.recordFailure();
  assert.equal(breaker.getState(), "closed");

  breaker.recordFailure();
  assert.equal(breaker.getState(), "open");

  clock = 99;
  assert.equal(breaker.getState(), "open");

  clock = 101;
  assert.equal(breaker.getState(), "half-open");
});

void test("defaults to threshold 5 and cooldown 30000", () => {
  const breaker = new CircuitBreaker();
  for (let i = 0; i < 4; i++) {
    breaker.recordFailure();
  }
  assert.equal(breaker.getState(), "closed");

  breaker.recordFailure();
  assert.equal(breaker.getState(), "open");
});
