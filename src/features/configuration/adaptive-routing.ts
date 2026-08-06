/**
 * Adaptive model selection.
 *
 * Static routing picks the same model for a slot forever, which is predictable
 * but blind: a model that fails schema validation half the time keeps getting
 * the work. This ranks the allowed models for a slot by what they actually did.
 *
 * Three rules keep it from being a black box:
 *
 * 1. It only runs when `routing_strategy` is `adaptive`. The default is static.
 * 2. An explicit `model_routing` entry always wins. Adaptation never overrides
 *    a decision someone wrote down.
 * 3. A model with too few attempts is *explored* before it is judged, so a
 *    newly added model is tried rather than starved by incumbents.
 */

/** One model's record for one routing slot. Shape mirrors `RoutingScore`. */
export interface ModelScore {
  readonly task_type: string;
  readonly model: string;
  readonly attempts: number;
  readonly completion_rate: number;
  readonly model_fault_rate: number;
  readonly patch_rejection_rate: number;
  readonly mean_duration_ms: number;
}

/**
 * Attempts before a model's record is treated as evidence.
 *
 * Below this, one unlucky failure would read as a 50% fault rate and bury the
 * model permanently. Models under the threshold are explored instead.
 */
export const EXPLORATION_MIN_ATTEMPTS = 5;

/**
 * How much slower a model may be and still win on quality.
 *
 * Latency is a tiebreaker, not a goal: a fast model that produces unusable
 * output costs more than a slow one that works.
 */
const LATENCY_WEIGHT = 0.15;

export interface SelectAdaptiveModelInput {
  readonly taskType: string;
  /** Models the protected policy permits for this slot. */
  readonly candidates: readonly string[];
  readonly scores: readonly ModelScore[];
}

export interface AdaptiveSelection {
  readonly model: string;
  readonly reason: "exploration" | "score";
}

/**
 * Ranks the candidates for a slot and returns the winner.
 *
 * Returns `undefined` when there is no basis to choose — no candidates, or no
 * scored candidate and nothing to explore. The caller then keeps the static
 * answer, which is the honest fallback: "no data" is not "any model will do".
 */
export function selectAdaptiveModel(
  input: SelectAdaptiveModelInput,
): AdaptiveSelection | undefined {
  const candidates = input.candidates.filter((model) => model !== "*");
  if (candidates.length === 0) {
    return undefined;
  }

  const byModel = new Map<string, ModelScore>();
  for (const score of input.scores) {
    if (score.task_type === input.taskType) {
      byModel.set(score.model, score);
    }
  }

  // Exploration first: a model nobody has tried enough cannot be compared.
  const unexplored = candidates
    .filter(
      (model) => (byModel.get(model)?.attempts ?? 0) < EXPLORATION_MIN_ATTEMPTS,
    )
    .sort(
      (left, right) =>
        (byModel.get(left)?.attempts ?? 0) -
        (byModel.get(right)?.attempts ?? 0),
    );
  const leastTried = unexplored[0];
  if (leastTried !== undefined) {
    return { model: leastTried, reason: "exploration" };
  }

  const ranked = candidates
    .map((model) => ({ model, score: byModel.get(model) }))
    .filter(
      (entry): entry is { model: string; score: ModelScore } =>
        entry.score !== undefined,
    );
  if (ranked.length === 0) {
    return undefined;
  }

  const slowest = Math.max(
    ...ranked.map((entry) => entry.score.mean_duration_ms),
    1,
  );

  let best: { model: string; value: number } | undefined;
  for (const entry of ranked) {
    const value = qualityOf(entry.score, slowest);
    // Ties break on name so the same data always yields the same choice.
    if (
      best === undefined ||
      value > best.value ||
      (value === best.value && entry.model.localeCompare(best.model) < 0)
    ) {
      best = { model: entry.model, value };
    }
  }

  return best === undefined
    ? undefined
    : { model: best.model, reason: "score" };
}

/**
 * Higher is better.
 *
 * Completions earn; faults and rejected patches cost. Latency only nudges,
 * normalized against the slowest candidate so the term stays bounded.
 */
function qualityOf(score: ModelScore, slowestMs: number): number {
  const speed = 1 - score.mean_duration_ms / slowestMs;
  return (
    score.completion_rate -
    score.model_fault_rate -
    score.patch_rejection_rate +
    LATENCY_WEIGHT * speed
  );
}
