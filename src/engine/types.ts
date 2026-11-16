export type ProblemKind = "production" | "quadratic";
export interface ProductionData {
  M: number[][];
  H: number[][];
  R: number[][];
  resourceLimits: number[];
  capacity0: number[];
  capacity1: number[];
  k: number[];
  p0: number[];
  p1: number[];
  r0: number[];
  r1: number[];
  v0: number;
  v1: number;
}
export interface QuadraticData {
  A: number[][];
  b0: number[];
  b1: number[];
  c0: number;
  c1: number;
  K: number[][];
  l0: number[];
  l1: number[];
}
export interface CalculationConfig {
  kind: ProblemKind;
  production: ProductionData;
  quadratic: QuadraticData;
  tStart: number;
  tEnd: number;
  points: number;
  degreeNumerator: number;
  degreeDenominator: number;
  enforceFeasibility: boolean;
  sampling: "fixed" | "adaptive";
  maxPoints: number;
  pointStep: number;
  coefficientTolerance: number;
  weightX: number;
  weightValue: number;
}
export interface RationalFit {
  numerator: number[];
  denominator: number[];
}
export interface Sample {
  t: number;
  x: number[];
  value: number;
  slack: number[];
  maxViolation: number;
  stationarity: number;
  kkt: boolean;
  xApprox: number[] | null;
  valueApprox: number | null;
}
export interface CurvePoint {
  t: number;
  xApprox: number[] | null;
  valueApprox: number | null;
  feasible: boolean;
  maxViolation: number | null;
  denominatorSafe: boolean;
}
export interface ConvergenceStep {
  points: number;
  coefficientChange: number | null;
  loss: number;
}
export interface CalculationResult {
  samples: Sample[];
  curve: CurvePoint[];
  fits: RationalFit[];
  canonical: QuadraticData;
  diagnostics: {
    concave: boolean;
    maxEigenvalue: number;
    fitSuccess: boolean;
    fitMessage: string;
    loss: number;
    maxXError: number;
    maxValueError: number;
    maxSampleViolation: number;
    maxCurveViolation: number;
    denominatorSafe: boolean;
    allKkt: boolean;
    converged: boolean | null;
    pointsUsed: number;
    elapsedSeconds: number;
    warnings: string[];
  };
  convergence: ConvergenceStep[];
}
export type CalculationMessage =
  | { type: "progress"; id: string; stage: string; progress: number }
  | { type: "result"; id: string; result: CalculationResult }
  | { type: "error"; id: string; message: string };
export interface CalculationRequest {
  id: string;
  config: CalculationConfig;
}
