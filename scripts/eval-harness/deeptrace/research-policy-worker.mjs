// Executes reviewed, dependency-free policy code. This is not a hostile-code sandbox.
import { stripTypeScriptTypes, registerHooks } from "node:module";

try {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) throw new Error("Policy request exceeds 256 KiB");
    chunks.push(chunk);
  }
  const { source, inputs } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (
    typeof source !== "string" ||
    Buffer.byteLength(source) > 64 * 1024 ||
    !Array.isArray(inputs) ||
    inputs.length === 0 ||
    inputs.length > 32
  ) {
    throw new Error("Invalid policy request");
  }
  const moduleUrl =
    "data:text/javascript;base64," +
    Buffer.from(stripTypeScriptTypes(source)).toString("base64");
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== moduleUrl || context.parentURL?.startsWith("data:")) {
        throw new Error("Policy must have no runtime imports");
      }
      return nextResolve(specifier, context);
    },
  });
  const policy = await import(moduleUrl);
  const outputs = inputs.map((input) => {
    if (
      !Number.isInteger(input.repetitions) ||
      input.repetitions < 1 ||
      input.repetitions > 128
    ) {
      throw new Error("Invalid repetition bound");
    }
    const observations = [];
    for (let repetition = 0; repetition < input.repetitions; repetition++) {
      const state = structuredClone(input);
      const { trigger, reason } = policy.shouldTriggerResearchCell(
        state.triggerInput,
      );
      if (
        typeof trigger !== "boolean" ||
        (reason !== null && typeof reason !== "string")
      ) {
        throw new Error("Invalid trigger result");
      }
      const branches = trigger
        ? policy.planResearchBranches(
            reason,
            state.entityKey,
            state.existingFacts,
            policy.RESEARCH_CELL_DEFAULTS.maxBranches,
          )
        : [];
      if (!Array.isArray(branches) || branches.length > 8)
        throw new Error("Invalid branch result");
      // Stored branch state is fixture input, not a measured tool or model execution.
      const results = branches.map((branch) => ({
        observedFacts: [],
        relationships: [],
        hypothesis: null,
        counterHypothesis: null,
        evidenceRefs: [],
        usefulness: 0,
        toolCallCount: 0,
        wallClockMs: 0,
        ...state.storedResults[branch.strategy],
        branchId: branch.branchId,
        strategy: branch.strategy,
      }));
      const ranked = policy.judgeBranches(results);
      const merged = policy.mergeBranchResults(ranked, state.entityKey);
      observations.push({
        trigger,
        reason,
        branches,
        rankedBranchIds: ranked.map((item) => item.branchId),
        merged,
      });
    }
    return { caseId: input.caseId, observations };
  });
  process.stdout.write(JSON.stringify(outputs));
} catch (error) {
  process.stderr.write(
    (error instanceof Error ? error.message : String(error)).slice(0, 1200),
  );
  process.exitCode = 1;
}
