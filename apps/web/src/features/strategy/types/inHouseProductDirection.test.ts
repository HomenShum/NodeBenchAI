import { describe, expect, it } from "vitest";

import { TESTS_ASSURED_PRODUCT_DIRECTION } from "../data/testsAssuredProductDirection";
import {
  IN_HOUSE_PRODUCT_DIRECTION_JSON_SCHEMA,
  InHouseProductDirectionSchema,
} from "./inHouseProductDirection";

describe("InHouseProductDirectionSchema", () => {
  it("parses the seeded Tests Assured fixture", () => {
    expect(() => InHouseProductDirectionSchema.parse(TESTS_ASSURED_PRODUCT_DIRECTION)).not.toThrow();
  });

  it("exports a JSON schema contract", () => {
    expect(IN_HOUSE_PRODUCT_DIRECTION_JSON_SCHEMA).toBeTruthy();
    expect(IN_HOUSE_PRODUCT_DIRECTION_JSON_SCHEMA).toHaveProperty("$schema");
    expect(IN_HOUSE_PRODUCT_DIRECTION_JSON_SCHEMA).toHaveProperty("definitions");
  });
});
