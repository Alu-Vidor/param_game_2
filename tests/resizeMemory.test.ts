import assert from "node:assert/strict";
import test from "node:test";
import { rememberMatrix, rememberVector } from "../src/lib/resizeMemory";

test("restoring dimensions retains hidden values and prioritizes recent edits", () => {
  const original = [
    ["1", "t+1"],
    ["2", "3"],
  ];
  const saved = rememberMatrix([[""]], original);
  assert.deepEqual(saved, [
    ["", "t+1"],
    ["2", "3"],
  ]);
  assert.deepEqual(rememberMatrix([["-1", "0"]], saved), [
    ["-1", "0"],
    ["2", "3"],
  ]);
  assert.deepEqual(rememberVector([], [0, 23]), [0, 23]);
  assert.deepEqual(original, [
    ["1", "t+1"],
    ["2", "3"],
  ]);
});
