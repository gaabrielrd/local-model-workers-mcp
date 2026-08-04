/**
 * Options for configuring the CircuitBreaker.
 */
export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening the circuit. Default: 5 */
  readonly failureThreshold?: number;
  /** Time in ms to wait before allowing a probe request (half-open). Default: 30_000 */
  readonly cooldownMs?: number;
  /** Injectable clock for testing. Default: Date.now */
  readonly now?: () => number;
}

/**
 * Represents the possible states of a circuit breaker.
 *
 * - `closed`: Operations are executing normally.
 * - `open`: Operations are failing and requests are denied.
 * - `half-open`: Circuit is probing to see if the underlying service has recovered.
 */
export type CircuitState = "closed" | "open" | "half-open";

/**
 * A Circuit Breaker implementation that prevents cascading failures when a service is failing.
 */
export class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureAt: number | null = null;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  /**
   * Creates a new CircuitBreaker with the given options.
   *
   * @param options Configuration for the circuit breaker.
   */
  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /**
   * Get the current circuit state, transitioning from open → half-open if cooldown elapsed.
   */
  getState(): CircuitState {
    if (this.state === "open" && this.lastFailureAt !== null) {
      const elapsed = this.now() - this.lastFailureAt;
      if (elapsed >= this.cooldownMs) {
        this.state = "half-open";
      }
    }
    return this.state;
  }

  /**
   * Check if a request should be allowed through.
   */
  allowRequest(): boolean {
    const state = this.getState();
    // closed: always allow
    // half-open: allow (probe request)
    // open: deny
    return state !== "open";
  }

  /**
   * Record a successful request. Resets to closed state.
   */
  recordSuccess(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.lastFailureAt = null;
  }

  /**
   * Record a failed request. Increments failure counter. Opens circuit if threshold reached.
   */
  recordFailure(): void {
    this.consecutiveFailures += 1;
    this.lastFailureAt = this.now();
    if (
      this.state === "half-open" ||
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = "open";
    }
  }

  /**
   * Reset the circuit breaker to initial closed state.
   */
  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.lastFailureAt = null;
  }
}
