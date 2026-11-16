import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { CalculationResult } from '../src/engine/types';
import { createScenario, fingerprint, isCurrent, loadWorkspace, number, parseScenario, resizeMatrix, resizeVector, scientific, STORAGE_KEY, type Scenario } from '../src/lib/workspace';

const clone = <T>(value: T): T => structuredClone(value);
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
function storage(raw: string | null) {
  let writes = 0;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => { assert.equal(key, STORAGE_KEY); return raw; },
    setItem: () => { writes++; },
  } });
  return () => writes;
}
function withSnapshot(): Scenario {
  const scenario = createScenario('quadratic');
  scenario.config.points = 2;
  const n = scenario.config.quadratic.A.length;
  const result: CalculationResult = {
    canonical: clone(scenario.config.quadratic),
    samples: [1, 10].map(t => ({ t, x: [1, 2], value: 3, slack: [1, 1, 1, 1, 1], maxViolation: 0, stationarity: 0, kkt: true, xApprox: [1, 2], valueApprox: 3 })),
    curve: [1, 5, 10].map(t => ({ t, xApprox: [1, 2], valueApprox: 3, feasible: true, maxViolation: 0, denominatorSafe: true })),
    fits: Array.from({ length: n }, (_, i) => ({ numerator: [i + 1, 0, 0], denominator: [1, 0, 0] })),
    diagnostics: { concave: true, maxEigenvalue: -.3, fitSuccess: true, fitMessage: 'Готово', loss: 0, maxXError: 0, maxValueError: 0, maxSampleViolation: 0, maxCurveViolation: 0, denominatorSafe: true, allKkt: true, converged: null, pointsUsed: 2, elapsedSeconds: .5, warnings: [] },
    convergence: [{ points: 2, coefficientChange: null, loss: 0 }],
  };
  scenario.snapshot = { fingerprint: fingerprint(scenario), calculatedAt: '2026-11-16T15:00:00.000Z', result };
  return scenario;
}

test('an exported scenario round-trips without retaining references to imported objects', () => {
  const source = withSnapshot();
  const exported = JSON.stringify({ app: 'param-game-2', version: 1, scenario: source });
  const parsed = parseScenario(JSON.parse(exported).scenario);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), JSON.parse(JSON.stringify(source)));
  assert.equal(isCurrent(parsed), true);
  parsed.config.quadratic.A[0][0] = -9;
  assert.equal(source.config.quadratic.A[0][0], -.5);
});

test('import rejects wrong matrix dimensions before the editor can index them', () => {
  const edits: Array<(s: Scenario) => void> = [
    s => { s.config.production.R[0] = [.15]; },
    s => { s.config.production.H = [[.1]]; },
    s => { s.config.production.M = []; },
    s => { s.config.production.resourceLimits.pop(); },
    s => { s.config.production.p0 = [20]; },
    s => { s.variableNames = []; },
    s => { s.resourceNames = ['Ресурс 1']; },
    s => { s.config.quadratic.K[0] = [1]; },
    s => { s.config.quadratic.b1.push(1); },
  ];
  for (const edit of edits) {
    const bad = createScenario(); edit(bad);
    assert.throws(() => parseScenario(bad));
  }
});

test('import validates inactive data and rejects non-numeric or non-finite coefficients', () => {
  const invalidValues: unknown[] = [NaN, Infinity, -Infinity, '0.5', true, null, undefined];
  for (const value of invalidValues) {
    const bad = createScenario();
    (bad.config.quadratic.b0 as unknown[])[0] = value;
    assert.throws(() => parseScenario(bad));
  }
  const sparse = createScenario();
  sparse.config.production.R = Array(3);
  assert.throws(() => parseScenario(sparse));
  const enormous = createScenario();
  enormous.config.production.M[0][0] = 1e13;
  assert.throws(() => parseScenario(enormous));
});

test('import enforces supported dimensions and numerical settings', () => {
  const edits: Array<(s: Scenario) => void> = [
    s => { s.config.kind = 'other' as never; },
    s => { s.config.points = 1; },
    s => { s.config.points = 501.5; },
    s => { s.config.tEnd = s.config.tStart; },
    s => { s.config.tStart = -Infinity; },
    s => { s.config.degreeNumerator = 5; },
    s => { s.config.degreeDenominator = -1; },
    s => { s.config.weightX = 0; s.config.weightValue = 0; },
    s => { s.config.weightValue = -.1; },
    s => { s.config.coefficientTolerance = 0; },
    s => { s.config.pointStep = 0; },
    s => { s.config.enforceFeasibility = 'yes' as never; },
    s => { s.config.sampling = 'adaptive'; s.config.maxPoints = s.config.points; },
    s => { s.config.quadratic.A = Array.from({ length: 7 }, () => Array(7).fill(0)); },
    s => { s.config.production.R = Array.from({ length: 16 }, () => [0, 0]); },
  ];
  for (const edit of edits) {
    const bad = createScenario(); edit(bad);
    assert.throws(() => parseScenario(bad));
  }
});

test('negative coefficients and a negative parameter range remain valid input', () => {
  const source = createScenario();
  source.config.tStart = -10;
  source.config.tEnd = -1;
  source.config.production.p1 = [-2, -3];
  assert.deepEqual(parseScenario(source).config, source.config);
});

test('renaming keeps a result current but changing calculation inputs makes it stale', () => {
  const scenario = withSnapshot();
  scenario.name = 'Вариант';
  scenario.variableNames[0] = 'Товар';
  assert.equal(isCurrent(scenario), true);
  scenario.config.quadratic.b0[0] += 1;
  assert.equal(isCurrent(scenario), false);
  const reloaded = parseScenario(scenario);
  assert.ok(reloaded.snapshot);
  assert.equal(isCurrent(reloaded), false);
});

test('corrupt saved results are discarded while usable input data survives', () => {
  const edits: Array<(s: Scenario) => void> = [
    s => { s.snapshot!.result.samples[0].x = [1]; },
    s => { s.snapshot!.result.samples[0].value = Infinity; },
    s => { s.snapshot!.result.samples[0].slack = []; },
    s => { s.snapshot!.result.curve[0].xApprox = null; },
    s => { s.snapshot!.result.curve[1].t = 0; },
    s => { s.snapshot!.result.curve[1].t = 10; },
    s => { s.snapshot!.result.fits[0].denominator = [0, 0, 0]; },
    s => { s.snapshot!.result.diagnostics.pointsUsed = 10; },
    s => { s.snapshot!.result.diagnostics.warnings = Array(101).fill('x'); },
    s => { s.snapshot!.fingerprint = '{broken'; },
    s => { s.snapshot!.calculatedAt = 'не дата'; },
  ];
  for (const edit of edits) {
    const scenario = withSnapshot(); edit(scenario);
    const parsed = parseScenario(scenario);
    assert.equal(parsed.snapshot, undefined);
    assert.deepEqual(parsed.config, scenario.config);
  }
});

test('a pole represented by null approximation is a valid saved result', () => {
  const source = withSnapshot();
  source.snapshot!.result.curve[1] = { t: 5, xApprox: null, valueApprox: null, feasible: false, maxViolation: null, denominatorSafe: false };
  source.snapshot!.result.diagnostics.denominatorSafe = false;
  assert.ok(parseScenario(source).snapshot);
});

test('loading corrupt storage preserves the original storage and reports recovery', () => {
  const writes = storage('[{"name":"broken"}]');
  const loaded = loadWorkspace();
  assert.equal(loaded.scenarios.length, 1);
  assert.equal(loaded.scenarios[0].config.kind, 'production');
  assert.ok(loaded.warning);
  assert.equal(writes(), 0);
});

test('loading preserves empty workspaces and separates colliding model identifiers', () => {
  storage('[]');
  assert.deepEqual(loadWorkspace(), { scenarios: [] });
  const scenario = createScenario();
  storage(JSON.stringify([scenario, scenario]));
  const loaded = loadWorkspace();
  assert.equal(loaded.warning, undefined);
  assert.notEqual(loaded.scenarios[0].id, loaded.scenarios[1].id);
});

test('storage restores an unfinished range draft without losing other models', () => {
  const draft = createScenario();
  draft.config.tStart = 20;
  draft.config.tEnd = 10;
  const complete = createScenario('quadratic');
  storage(JSON.stringify([draft, complete]));
  const loaded = loadWorkspace();
  assert.equal(loaded.warning, undefined);
  assert.equal(loaded.scenarios.length, 2);
  assert.equal(loaded.scenarios[0].config.tStart, 20);
  assert.equal(loaded.scenarios[0].config.tEnd, 10);
  assert.equal(loaded.scenarios[1].id, complete.id);
  assert.throws(() => parseScenario(draft));
});

test('storage restores temporary zero weights and equal adaptive grid limits as drafts', () => {
  const weights = createScenario();
  weights.config.weightX = 0;
  weights.config.weightValue = 0;
  const grid = createScenario();
  grid.config.sampling = 'adaptive';
  grid.config.maxPoints = grid.config.points;
  storage(JSON.stringify([weights, grid]));
  const loaded = loadWorkspace();
  assert.equal(loaded.warning, undefined);
  assert.equal(loaded.scenarios.length, 2);
  assert.equal(loaded.scenarios[0].config.weightX, 0);
  assert.equal(loaded.scenarios[0].config.weightValue, 0);
  assert.equal(loaded.scenarios[1].config.maxPoints, grid.config.points);
  assert.throws(() => parseScenario(weights));
  assert.throws(() => parseScenario(grid));
});

test('resizing retains existing negative coefficients and initializes only new cells', () => {
  const matrix = [[-2, 3], [4, -5]];
  assert.deepEqual(resizeMatrix(matrix, 3, 3, -1), [[-2, 3, 0], [4, -5, 0], [0, 0, -1]]);
  assert.deepEqual(resizeMatrix(matrix, 1, 1, -1), [[-2]]);
  assert.deepEqual(resizeVector([-2, 0], 4, 7), [-2, 0, 7, 7]);
  assert.deepEqual(matrix, [[-2, 3], [4, -5]]);
});

test('rounded display removes negative zero while raw data and scientific notation keep its value', () => {
  const raw = -1e-13;
  assert.equal(number(raw), '0');
  assert.equal(number(-0), '0');
  assert.equal(number(-.00006), '-0,0001');
  assert.equal(number(null), '—');
  assert.equal(scientific(raw), '-1.00 × 10⁻13');
  assert.equal(String(raw), '-1e-13');
});
