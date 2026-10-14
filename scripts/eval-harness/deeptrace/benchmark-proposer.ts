import type { OptimizerProposeFn } from "./optimizerRunner.js";

// The old bridge copied candidate code into host imports and supplied proxy scores.
const propose: OptimizerProposeFn = async () => {
  throw new Error(
    "The self-measuring benchmark proposer is retired. Run canary-benchmark.ts with " +
      "--baseline-policy <file.ts> --candidate-policy <file.ts> --out <new-report.json>. " +
      "Its policy observations do not authorize optimizer baseline promotion.",
  );
};

export default propose;
