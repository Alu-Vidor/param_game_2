import type {
  CalculationConfig,
  CalculationResult,
  ProblemKind,
  ProductionData,
  QuadraticData,
} from "../engine/types";

export interface Scenario {
  id: string;
  name: string;
  notes: string;
  parameter: string;
  parameterUnit: string;
  valueLabel: string;
  valueUnit: string;
  variableNames: string[];
  resourceNames: string[];
  config: CalculationConfig;
  updatedAt: string;
  snapshot?: {
    fingerprint: string;
    result: CalculationResult;
    calculatedAt: string;
  };
}

export const STORAGE_KEY = "param-game-2-workspace-v1";
export function defaultConfig(
  kind: ProblemKind = "production",
): CalculationConfig {
  return {
    kind,
    production: {
      M: [
        [0.7, 0],
        [0, 0.5],
      ],
      H: [
        [0.1, 0, 0],
        [0, 0.1, 0],
        [0, 0, 0.1],
      ],
      R: [
        [0.15, 0.03],
        [0.05, 0.3],
        [0.1, 0.06],
      ],
      resourceLimits: [18, 11, 1],
      capacity0: [8, 23],
      capacity1: [0, 0],
      k: [3, 4],
      p0: [20, 30],
      p1: [2, -0.1],
      r0: [3, 2, 6],
      r1: [2, 0.3, -0.3],
      v0: -5,
      v1: -0.002,
    },
    quadratic: {
      A: [
        [-0.5, 0],
        [0, -0.3],
      ],
      b0: [3, 2],
      b1: [1, 0.8],
      c0: 0,
      c1: 0,
      K: [
        [0.2, 0.1],
        [0.1, 0.2],
        [1, 0],
        [0, 1],
        [0.05, 0.05],
      ],
      l0: [20, 15, 50, 50, 30],
      l1: [0.5, 0.3, -1, 1, 0.2],
    },
    tStart: 1,
    tEnd: 10,
    points: 10,
    degreeNumerator: 2,
    degreeDenominator: 2,
    enforceFeasibility: kind === "production",
    sampling: "fixed",
    maxPoints: 100,
    pointStep: 10,
    coefficientTolerance: 0.001,
    weightX: 1,
    weightValue: 0,
  };
}
export function createScenario(kind: ProblemKind = "production"): Scenario {
  return {
    id: crypto.randomUUID(),
    name:
      kind === "production"
        ? "Производственный план"
        : "Общая квадратичная модель",
    notes: "",
    parameter: "Параметр",
    parameterUnit: "",
    valueLabel: kind === "production" ? "Прибыль" : "Целевая функция",
    valueUnit: "ед.",
    variableNames:
      kind === "production"
        ? ["Продукт 1", "Продукт 2"]
        : ["Переменная 1", "Переменная 2"],
    resourceNames: ["Ресурс 1", "Ресурс 2", "Ресурс 3"],
    config: defaultConfig(kind),
    updatedAt: new Date().toISOString(),
  };
}
export const fingerprint = (s: Scenario) => JSON.stringify(s.config);
export const isCurrent = (s: Scenario) =>
  !!s.snapshot && s.snapshot.fingerprint === fingerprint(s);
export function loadWorkspace(): { scenarios: Scenario[]; warning?: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { scenarios: [createScenario()] };
    if (raw.length > 8 * 1024 * 1024) throw new Error();
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || data.length > 30) throw new Error();
    const scenarios = data.map((item) => parseScenario(item, false));
    const ids = new Set<string>();
    for (const scenario of scenarios) {
      if (ids.has(scenario.id)) scenario.id = crypto.randomUUID();
      ids.add(scenario.id);
    }
    return { scenarios };
  } catch {
    return {
      scenarios: [createScenario()],
      warning:
        "Не удалось прочитать сохранённые модели. Создан исходный пример. Ваши данные в хранилище не перезаписаны.",
    };
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}: ожидается объект с данными.`);
  return value as Record<string, unknown>;
}
function finite(value: unknown, label: string, max = 1e12): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > max
  )
    throw new Error(
      `${label}: требуется конечное число с модулем не более ${max}.`,
    );
  return value;
}
function integer(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  const number = finite(value, label, max);
  if (!Number.isInteger(number) || number < min || number > max)
    throw new Error(`${label}: требуется целое число от ${min} до ${max}.`);
  return number;
}
function text(
  value: unknown,
  label: string,
  max: number,
  fallback?: string,
): string {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.length > max)
    throw new Error(`${label}: текст не должен превышать ${max} символов.`);
  return value;
}
function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`${label}: требуется логическое значение.`);
  return value;
}
function vector(
  value: unknown,
  size: number,
  label: string,
  max = 1e12,
): number[] {
  if (!Array.isArray(value) || value.length !== size)
    throw new Error(`${label}: ожидается ${size} чисел.`);
  return Array.from(value, (item, i) =>
    finite(item, `${label}, элемент ${i + 1}`, max),
  );
}
function matrix(
  value: unknown,
  rows: number,
  columns: number,
  label: string,
  max = 1e12,
): number[][] {
  if (!Array.isArray(value) || value.length !== rows)
    throw new Error(`${label}: ожидается ${rows} строк.`);
  return Array.from(value, (row, i) =>
    vector(row, columns, `${label}, строка ${i + 1}`, max),
  );
}
function sizedArray(
  value: unknown,
  label: string,
  min: number,
  max: number,
): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max)
    throw new Error(`${label}: допустимо от ${min} до ${max} элементов.`);
  return value;
}
function parseQuadratic(
  value: unknown,
  maxRows = 15,
  coefficientLimit = 1e12,
): QuadraticData {
  const q = record(value, "Квадратичная модель");
  const n = sizedArray(q.A, "Матрица A", 1, 6).length;
  const m = sizedArray(q.K, "Матрица K", 1, maxRows).length;
  return {
    A: matrix(q.A, n, n, "Матрица A", coefficientLimit),
    b0: vector(q.b0, n, "Вектор b₀", coefficientLimit),
    b1: vector(q.b1, n, "Вектор b₁", coefficientLimit),
    c0: finite(q.c0, "Коэффициент c₀", coefficientLimit),
    c1: finite(q.c1, "Коэффициент c₁", coefficientLimit),
    K: matrix(q.K, m, n, "Матрица K", coefficientLimit),
    l0: vector(q.l0, m, "Вектор l₀", coefficientLimit),
    l1: vector(q.l1, m, "Вектор l₁", coefficientLimit),
  };
}
function parseProduction(value: unknown): ProductionData {
  const p = record(value, "Производственная модель");
  const n = sizedArray(p.M, "Матрица M", 1, 6).length;
  const m = sizedArray(p.R, "Матрица R", 1, 15).length;
  return {
    M: matrix(p.M, n, n, "Матрица M"),
    H: matrix(p.H, m, m, "Матрица H"),
    R: matrix(p.R, m, n, "Матрица R"),
    resourceLimits: vector(p.resourceLimits, m, "Запас ресурсов"),
    capacity0: vector(p.capacity0, n, "Начальные мощности"),
    capacity1: vector(p.capacity1, n, "Изменение мощностей"),
    k: vector(p.k, n, "Затраты k"),
    p0: vector(p.p0, n, "Цены p₀"),
    p1: vector(p.p1, n, "Изменение цен p₁"),
    r0: vector(p.r0, m, "Стоимость ресурсов r₀"),
    r1: vector(p.r1, m, "Изменение стоимости r₁"),
    v0: finite(p.v0, "Коэффициент v₀"),
    v1: finite(p.v1, "Коэффициент v₁"),
  };
}
function parseConfig(value: unknown, strict = true): CalculationConfig {
  const c = record(value, "Параметры расчёта");
  if (c.kind !== "production" && c.kind !== "quadratic")
    throw new Error("Неизвестный тип модели.");
  if (c.sampling !== "fixed" && c.sampling !== "adaptive")
    throw new Error("Неизвестный способ выбора сетки.");
  const result: CalculationConfig = {
    kind: c.kind,
    production: parseProduction(c.production),
    quadratic: parseQuadratic(c.quadratic),
    tStart: finite(c.tStart, "Начало диапазона", 1e9),
    tEnd: finite(c.tEnd, "Конец диапазона", 1e9),
    points: integer(c.points, "Число точек", 2, 501),
    degreeNumerator: integer(c.degreeNumerator, "Степень числителя", 0, 4),
    degreeDenominator: integer(
      c.degreeDenominator,
      "Степень знаменателя",
      0,
      4,
    ),
    enforceFeasibility: flag(c.enforceFeasibility, "Учёт ограничений"),
    sampling: c.sampling,
    maxPoints: integer(c.maxPoints, "Максимум точек", 2, 501),
    pointStep: integer(c.pointStep, "Прибавление точек", 1, 499),
    coefficientTolerance: finite(
      c.coefficientTolerance,
      "Допуск коэффициентов",
    ),
    weightX: finite(c.weightX, "Вес ошибки переменных"),
    weightValue: finite(c.weightValue, "Вес ошибки цели"),
  };
  if (strict && result.tStart >= result.tEnd)
    throw new Error("Начало диапазона должно быть меньше конца.");
  if (result.coefficientTolerance <= 0)
    throw new Error("Допуск коэффициентов должен быть положительным.");
  if (
    result.weightX < 0 ||
    result.weightValue < 0 ||
    (strict && result.weightX + result.weightValue <= 0)
  )
    throw new Error(
      "Веса неотрицательны; хотя бы один вес должен быть положительным.",
    );
  if (
    strict &&
    result.sampling === "adaptive" &&
    result.maxPoints <= result.points
  )
    throw new Error("Максимум точек должен быть больше начального числа.");
  return result;
}
function names(
  value: unknown,
  label: string,
  min: number,
  max: number,
): string[] {
  return Array.from(sizedArray(value, label, min, max), (item) =>
    text(item, label, 80),
  );
}
function date(value: unknown, label: string): string {
  const result = text(value, label, 64);
  if (!Number.isFinite(Date.parse(result)))
    throw new Error(`${label}: неверная дата.`);
  return result;
}
function nonnegative(value: unknown, label: string): number {
  const result = finite(value, label, Number.MAX_VALUE);
  if (result < 0) throw new Error(`${label}: требуется неотрицательное число.`);
  return result;
}
function parseSnapshot(value: unknown): Scenario["snapshot"] {
  if (value === undefined) return undefined;
  try {
    const s = record(value, "Сохранённый расчёт");
    const storedFingerprint = text(s.fingerprint, "Данные расчёта", 100000);
    const sourceConfig = parseConfig(JSON.parse(storedFingerprint), false);
    const n =
      sourceConfig.kind === "production"
        ? sourceConfig.production.M.length
        : sourceConfig.quadratic.A.length;
    const m =
      sourceConfig.kind === "production"
        ? sourceConfig.production.R.length + 2 * n
        : sourceConfig.quadratic.K.length;
    const raw = record(s.result, "Результат");
    const canonical = parseQuadratic(raw.canonical, 27, Number.MAX_VALUE);
    if (canonical.A.length !== n || canonical.K.length !== m)
      throw new Error(
        "Размерность сохранённого расчёта отличается от исходных данных.",
      );
    const samples = sizedArray(raw.samples, "Расчётные точки", 2, 501).map(
      (item) => {
        const point = record(item, "Расчётная точка");
        const xApprox =
          point.xApprox === null
            ? null
            : vector(point.xApprox, n, "Приближённый план", Number.MAX_VALUE);
        const valueApprox =
          point.valueApprox === null
            ? null
            : finite(
                point.valueApprox,
                "Приближённый результат",
                Number.MAX_VALUE,
              );
        if ((xApprox === null) !== (valueApprox === null))
          throw new Error("Неполное приближение.");
        return {
          t: finite(point.t, "Параметр расчётной точки", 1e9),
          x: vector(point.x, n, "Численный план", Number.MAX_VALUE),
          value: finite(point.value, "Численный результат", Number.MAX_VALUE),
          slack: vector(point.slack, m, "Запасы ограничений", Number.MAX_VALUE),
          maxViolation: nonnegative(
            point.maxViolation,
            "Нарушение ограничений",
          ),
          stationarity: nonnegative(
            point.stationarity,
            "Остаток стационарности",
          ),
          kkt: flag(point.kkt, "Проверка оптимальности"),
          xApprox,
          valueApprox,
        };
      },
    );
    const curve = sizedArray(raw.curve, "Проверочная сетка", 2, 1100).map(
      (item) => {
        const point = record(item, "Точка проверочной сетки");
        const xApprox =
          point.xApprox === null
            ? null
            : vector(
                point.xApprox,
                n,
                "План на проверочной сетке",
                Number.MAX_VALUE,
              );
        const valueApprox =
          point.valueApprox === null
            ? null
            : finite(
                point.valueApprox,
                "Результат на проверочной сетке",
                Number.MAX_VALUE,
              );
        const maxViolation =
          point.maxViolation === null
            ? null
            : nonnegative(point.maxViolation, "Нарушение на проверочной сетке");
        if (
          (xApprox === null) !== (valueApprox === null) ||
          (xApprox === null) !== (maxViolation === null)
        )
          throw new Error("Неполная точка проверочной сетки.");
        return {
          t: finite(point.t, "Параметр проверочной точки", 1e9),
          xApprox,
          valueApprox,
          feasible: flag(point.feasible, "Допустимость точки"),
          maxViolation,
          denominatorSafe: flag(point.denominatorSafe, "Проверка знаменателя"),
        };
      },
    );
    for (const points of [samples, curve]) {
      for (let i = 0; i < points.length; i++) {
        if (
          points[i].t < sourceConfig.tStart ||
          points[i].t > sourceConfig.tEnd ||
          (i > 0 && points[i].t <= points[i - 1].t)
        )
          throw new Error("Неверный порядок точек.");
      }
    }
    const fits = sizedArray(raw.fits, "Функции приближения", n, n).map(
      (item) => {
        const fit = record(item, "Функция приближения");
        const numerator = vector(
          fit.numerator,
          sourceConfig.degreeNumerator + 1,
          "Числитель",
          Number.MAX_VALUE,
        );
        const denominator = vector(
          fit.denominator,
          sourceConfig.degreeDenominator + 1,
          "Знаменатель",
          Number.MAX_VALUE,
        );
        if (denominator[0] !== 1)
          throw new Error("Знаменатель должен быть нормирован.");
        return { numerator, denominator };
      },
    );
    const d = record(raw.diagnostics, "Диагностика");
    const diagnostics: CalculationResult["diagnostics"] = {
      concave: flag(d.concave, "Вогнутость"),
      maxEigenvalue: finite(
        d.maxEigenvalue,
        "Собственное значение",
        Number.MAX_VALUE,
      ),
      fitSuccess: flag(d.fitSuccess, "Подбор коэффициентов"),
      fitMessage: text(d.fitMessage, "Сообщение подбора", 5000),
      loss: nonnegative(d.loss, "Критерий приближения"),
      maxXError: nonnegative(d.maxXError, "Ошибка плана"),
      maxValueError: nonnegative(d.maxValueError, "Ошибка результата"),
      maxSampleViolation: nonnegative(
        d.maxSampleViolation,
        "Нарушение в узлах",
      ),
      maxCurveViolation: nonnegative(
        d.maxCurveViolation,
        "Нарушение между узлами",
      ),
      denominatorSafe: flag(d.denominatorSafe, "Проверка знаменателей"),
      allKkt: flag(d.allKkt, "Проверка всех решений"),
      converged:
        d.converged === null ? null : flag(d.converged, "Сходимость сетки"),
      pointsUsed: integer(d.pointsUsed, "Число использованных точек", 2, 501),
      elapsedSeconds: nonnegative(d.elapsedSeconds, "Время расчёта"),
      warnings: sizedArray(d.warnings, "Предупреждения", 0, 100).map((item) =>
        text(item, "Предупреждение", 5000),
      ),
    };
    if (diagnostics.pointsUsed !== samples.length)
      throw new Error("Неполный набор расчётных точек.");
    const convergence = sizedArray(
      raw.convergence,
      "История сеток",
      1,
      500,
    ).map((item) => {
      const step = record(item, "Шаг выбора сетки");
      return {
        points: integer(step.points, "Размер сетки", 2, 501),
        coefficientChange:
          step.coefficientChange === null
            ? null
            : nonnegative(step.coefficientChange, "Изменение коэффициентов"),
        loss: nonnegative(step.loss, "Критерий на сетке"),
      };
    });
    if (convergence.at(-1)!.points !== samples.length)
      throw new Error("История сетки не соответствует результату.");
    return {
      fingerprint: JSON.stringify(sourceConfig),
      result: { samples, curve, fits, canonical, diagnostics, convergence },
      calculatedAt: date(s.calculatedAt, "Дата расчёта"),
    };
  } catch {
    return undefined;
  }
}
export function parseScenario(data: unknown, strict = true): Scenario {
  const s = record(data, "Модель");
  const config = parseConfig(s.config, strict);
  const n =
    config.kind === "production"
      ? config.production.M.length
      : config.quadratic.A.length;
  const resources =
    config.kind === "production" ? config.production.R.length : 0;
  return {
    id:
      s.id === undefined
        ? crypto.randomUUID()
        : text(s.id, "Идентификатор модели", 200),
    name: text(s.name, "Название модели", 200),
    notes: text(s.notes, "Примечание", 1000, ""),
    parameter: text(s.parameter, "Название параметра", 80, "Параметр"),
    parameterUnit: text(s.parameterUnit, "Единицы параметра", 40, ""),
    valueLabel: text(s.valueLabel, "Название результата", 80, "Результат"),
    valueUnit: text(s.valueUnit, "Единицы результата", 40, "ед."),
    variableNames: names(s.variableNames, "Названия переменных", n, 6),
    resourceNames: names(s.resourceNames, "Названия ресурсов", resources, 15),
    config,
    updatedAt:
      s.updatedAt === undefined
        ? new Date().toISOString()
        : date(s.updatedAt, "Дата изменения"),
    snapshot: parseSnapshot(s.snapshot),
  };
}
export function exportScenario(s: Scenario) {
  download(
    JSON.stringify({ app: "param-game-2", version: 1, scenario: s }, null, 2),
    "planning-model.json",
    "application/json",
  );
}
export function download(
  body: string,
  filename: string,
  mime = "text/plain;charset=utf-8",
) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function number(value: number | null | undefined, digits = 4) {
  if (value == null || !Number.isFinite(value)) return "—";
  const normalized = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: digits,
  }).format(normalized);
}
export function scientific(value: number) {
  return Math.abs(value) < 0.0001 && value !== 0
    ? value.toExponential(2).replace("e-", " × 10⁻")
    : number(value, 6);
}
export function resizeMatrix(
  a: number[][],
  rows: number,
  cols: number,
  diagonal = 0,
): number[][] {
  return Array.from({ length: rows }, (_, i) =>
    Array.from(
      { length: cols },
      (_, j) => a[i]?.[j] ?? (i === j ? diagonal : 0),
    ),
  );
}
export function resizeVector(
  a: number[],
  size: number,
  fallback = 0,
): number[] {
  return Array.from({ length: size }, (_, i) => a[i] ?? fallback);
}
