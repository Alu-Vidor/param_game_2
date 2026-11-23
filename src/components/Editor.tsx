import { rememberMatrix, rememberVector } from "../lib/resizeMemory";
import { RationalExpression } from "./MathNotation";
import {
  QuadraticConstraint,
  QuadraticObjective,
  QuadraticLoss,
} from "./QuadraticNotation";
import {
  parseCoefficient,
  type CoefficientExpressions,
} from "../lib/coefficient";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Minus, Plus } from "lucide-react";
import type { CalculationConfig, QuadraticData } from "../engine/types";
import {
  MAX_CONSTRAINTS,
  MAX_VARIABLES,
  resizeMatrix,
  resizeVector,
  variableName,
  type Scenario,
} from "../lib/workspace";

type Props = {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  busy: boolean;
  onRun?: () => void;
};
type NumericProps = {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number;
  max?: number;
  integer?: boolean;
  helpId?: string;
  inputId?: string;
};

function NumericCell({
  value,
  onChange,
  label,
  min,
  max,
  integer,
  helpId,
  inputId,
}: NumericProps) {
  const generatedId = useId();
  const id = inputId ?? generatedId;
  const input = useRef<HTMLInputElement>(null);
  const focused = useRef(false);
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState("");
  function parse(text: string) {
    const normalized = text.trim().replace(",", ".").replace(/−/g, "-");
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized))
      return null;
    const number = Number(normalized);
    return Number.isFinite(number) ? number : null;
  }
  function message(text: string) {
    const parsed = parse(text);
    if (parsed === null) return "Введите число: например, 0,5 или −2.";
    if (integer && !Number.isInteger(parsed)) return "Введите целое число.";
    if (min !== undefined && parsed < min)
      return `Введите число не меньше ${min}.`;
    if (max !== undefined && parsed > max)
      return `Введите число не больше ${max}.`;
    return "";
  }
  useEffect(() => {
    if (!focused.current) {
      const next = Number.isFinite(value) ? String(value) : "";
      setDraft(next);
      input.current?.setCustomValidity(message(next));
      setError("");
    }
  }, [value, min, max, integer]);
  const descriptions =
    [helpId, error ? `${id}-error` : undefined].filter(Boolean).join(" ") ||
    undefined;
  return (
    <div className="numeric-field">
      <input
        ref={input}
        id={id}
        name={id}
        className="numeric-input"
        type="text"
        inputMode={integer ? "numeric" : "decimal"}
        enterKeyHint="next"
        autoComplete="off"
        spellCheck={false}
        autoCapitalize="none"
        required
        aria-label={label}
        aria-describedby={descriptions}
        aria-invalid={Boolean(error)}
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          const text = event.currentTarget.value;
          setDraft(text);
          setError("");
          const nextError = message(text);
          event.currentTarget.setCustomValidity(nextError);
          const next = parse(text);
          if (!nextError && next !== null) onChange(next);
        }}
        onBlur={(event) => {
          focused.current = false;
          const nextError = message(event.currentTarget.value);
          event.currentTarget.setCustomValidity(nextError);
          setError(nextError);
        }}
        onInvalid={(event) => {
          setError(message(event.currentTarget.value));
        }}
      />
      {error && (
        <span id={`${id}-error`} className="field-error">
          {error}
        </span>
      )}
    </div>
  );
}

function FormulaCell({
  label,
  value,
  onChange,
  labelledBy,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  labelledBy?: string;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [showError, setShowError] = useState(false);
  const { coefficient, error } = useMemo(() => {
    try {
      return { coefficient: parseCoefficient(value), error: "" };
    } catch (error) {
      return {
        coefficient: null,
        error: error instanceof Error ? error.message : "Проверьте формулу.",
      };
    }
  }, [value]);
  useEffect(() => {
    input.current?.setCustomValidity(error);
  }, [error]);
  const visibleError = showError && error;
  return (
    <div className="coefficient-cell">
      <input
        ref={input}
        name={id}
        id={id}
        className="numeric-input formula-input"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        aria-describedby={
          visibleError
            ? "coefficient-help " + id + "-error"
            : "coefficient-help"
        }
        aria-invalid={Boolean(visibleError)}
        required
        maxLength={2000}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => {
          setShowError(false);
          onChange(event.currentTarget.value);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setShowError(true);
        }}
        onInvalid={() => setShowError(true)}
      />
      {visibleError && (
        <span className="field-error coefficient-error" id={id + "-error"}>
          {error}
        </span>
      )}
      {focused && coefficient && value.includes("t") && (
        <div className="coefficient-preview" aria-hidden="true">
          <math>
            <RationalExpression {...coefficient} />
          </math>
        </div>
      )}
    </div>
  );
}

function asExpressions(q: QuadraticData): CoefficientExpressions {
  const affine = (a: number, b: number) =>
    b === 0 ? String(a) : a + (b < 0 ? " - " : " + ") + Math.abs(b) + "*t";
  return {
    A: q.A.map((row) => row.map(String)),
    b: q.b0.map((a, i) => affine(a, q.b1[i])),
    c: affine(q.c0, q.c1),
    K: q.K.map((row) => row.map(String)),
    l: q.l0.map((a, i) => affine(a, q.l1[i])),
  };
}

function NumberField(props: NumericProps & { help?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <NumericCell
        {...props}
        inputId={id}
        helpId={props.help ? `${id}-help` : undefined}
      />
      {props.help && (
        <span id={`${id}-help`} className="help-text">
          {props.help}
        </span>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Dimension({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <fieldset className="dimension-control">
      <legend>{label}</legend>
      <button
        type="button"
        className="button quiet icon"
        aria-label={`Уменьшить: ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={16} />
      </button>
      <output>{value}</output>
      <button
        type="button"
        className="button quiet icon"
        aria-label={`Увеличить: ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={16} />
      </button>
    </fieldset>
  );
}

function updateMatrix<T>(matrix: T[][], row: number, column: number, value: T) {
  return matrix.map((values, i) =>
    i === row
      ? values.map((entry, j) => (j === column ? value : entry))
      : values,
  );
}

function Matrix<T>({
  name,
  values,
  rowNames,
  columnNames,
  renderCell,
}: {
  name: string;
  values: T[][];
  rowNames: string[];
  columnNames: string[];
  renderCell: (value: T, row: number, column: number) => ReactNode;
}) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={name}>
      <table className="input-table matrix-grid">
        <caption>{name}</caption>
        <thead>
          <tr>
            <th scope="col" aria-label="Индексы строки и столбца">
              i / j
            </th>
            {columnNames.map((name, j) => (
              <th scope="col" key={j}>
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {values.map((row, i) => (
            <tr key={i}>
              <th scope="row">{rowNames[i]}</th>
              {row.map((value, j) => (
                <td key={j}>{renderCell(value, i, j)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Editor({ scenario, onChange, busy, onRun }: Props) {
  const resizeMemory = useRef<{
    quadratic: QuadraticData;
    expressions: CoefficientExpressions;
    variableNames: string[];
  }>(null);
  const c = scenario.config;
  const q = c.quadratic;
  const expressions =
    c.coefficientMode === "rational" ? c.expressions : undefined;
  const formulas = expressions ?? asExpressions(q);
  const nonnegative = c.nonnegative !== false;
  const n = q.A.length;
  const m = q.K.length;
  const varNames = q.A.map(
    (_, i) => scenario.variableNames[i] || variableName(i),
  );
  const update = (next: Partial<Scenario>) =>
    onChange({ ...scenario, ...next, updatedAt: new Date().toISOString() });
  const config = (next: Partial<CalculationConfig>) =>
    update({ config: { ...c, ...next } });
  function formula<K extends keyof CoefficientExpressions>(
    key: K,
    value: CoefficientExpressions[K],
  ) {
    config({
      coefficientMode: "rational",
      expressions: { ...formulas, [key]: value },
    });
  }

  function matrixFormula(
    key: "A" | "K",
    row: number,
    column: number,
    value: string,
  ) {
    formula(key, updateMatrix(formulas[key], row, column, value));
  }

  function vectorFormula(key: "b" | "l", index: number, value: string) {
    formula(
      key,
      formulas[key].map((entry, i) => (i === index ? value : entry)),
    );
  }

  function resizeQuadratic(nextN: number, nextM: number) {
    const saved = resizeMemory.current;
    const quadratic = {
      ...q,
      A: rememberMatrix(q.A, saved?.quadratic.A),
      b0: rememberVector(q.b0, saved?.quadratic.b0),
      b1: rememberVector(q.b1, saved?.quadratic.b1),
      K: rememberMatrix(q.K, saved?.quadratic.K),
      l0: rememberVector(q.l0, saved?.quadratic.l0),
      l1: rememberVector(q.l1, saved?.quadratic.l1),
    };
    const allFormulas = {
      A: rememberMatrix(formulas.A, saved?.expressions.A),
      b: rememberVector(formulas.b, saved?.expressions.b),
      c: formulas.c,
      K: rememberMatrix(formulas.K, saved?.expressions.K),
      l: rememberVector(formulas.l, saved?.expressions.l),
    };
    const variableNames = rememberVector(varNames, saved?.variableNames);
    resizeMemory.current = {
      quadratic,
      expressions: allFormulas,
      variableNames,
    };
    update({
      variableNames: Array.from(
        { length: nextN },
        (_, i) => variableNames[i] ?? variableName(i),
      ),
      config: {
        ...c,
        expressions: expressions && {
          A: Array.from({ length: nextN }, (_, i) =>
            Array.from(
              { length: nextN },
              (_, j) => allFormulas.A[i]?.[j] ?? (i === j ? "-1" : "0"),
            ),
          ),
          b: Array.from({ length: nextN }, (_, i) => allFormulas.b[i] ?? "0"),
          c: allFormulas.c,
          K: Array.from({ length: nextM }, (_, i) =>
            Array.from(
              { length: nextN },
              (_, j) => allFormulas.K[i]?.[j] ?? "0",
            ),
          ),
          l: Array.from({ length: nextM }, (_, i) => allFormulas.l[i] ?? "0"),
        },
        quadratic: {
          ...q,
          A: resizeMatrix(quadratic.A, nextN, nextN, -1),
          b0: resizeVector(quadratic.b0, nextN),
          b1: resizeVector(quadratic.b1, nextN),
          K: resizeMatrix(quadratic.K, nextM, nextN),
          l0: resizeVector(quadratic.l0, nextM),
          l1: resizeVector(quadratic.l1, nextM),
        },
      },
    });
  }
  return (
    <form
      id="model-form"
      className="editor"
      aria-label="Исходные данные"
      onInvalidCapture={(event) => {
        const input = event.target;
        if (input instanceof HTMLElement) {
          for (
            let group = input.closest("details");
            group;
            group = group.parentElement?.closest("details") ?? null
          ) {
            group.open = true;
          }
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        onRun?.();
      }}
    >
      <fieldset disabled={busy} className="editor-fields">
        <legend className="visually-hidden">Параметры модели</legend>

        {resizeMemory.current &&
          (resizeMemory.current.quadratic.A.length > n ||
            resizeMemory.current.quadratic.K.length > m) && (
            <p className="help-text">
              Скрытые коэффициенты восстановятся при увеличении размера в этом
              редакторе.
            </p>
          )}

        <Section title="Постановка задачи">
          <div className="equation-stack">
            <QuadraticObjective maximize />
            <QuadraticConstraint nonnegative={nonnegative} />
          </div>
          <p id="coefficient-help" className="help-text">
            Введите число, многочлен <code>-1-t^2</code> или дробь{" "}
            <code>(-1-t^2)/(1+t)</code>. Степень многочлена до 12.
          </p>
        </Section>

        <Section
          title="Целевая функция"
          actions={
            <Dimension
              label="Число переменных n"
              value={n}
              min={1}
              max={MAX_VARIABLES}
              onChange={(next) => resizeQuadratic(next, m)}
            />
          }
        >
          <div className="qp-objective-grid">
            <Matrix
              name="Матрица A(t)"
              values={formulas.A}
              rowNames={varNames}
              columnNames={varNames}
              renderCell={(v, i, j) => (
                <FormulaCell
                  label={`A[${i + 1}, ${j + 1}]`}
                  value={v}
                  onChange={(value) => matrixFormula("A", i, j, value)}
                />
              )}
            />
            <div className="qp-linear-terms">
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Вектор b(t)"
              >
                <table className="input-table">
                  <thead>
                    <tr>
                      <th scope="col">Переменная</th>
                      <th scope="col">b(t)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {varNames.map((name, i) => (
                      <tr key={i}>
                        <th scope="row">{name}</th>

                        <td>
                          <FormulaCell
                            label={`b[${i + 1}]`}
                            value={formulas.b[i]}
                            onChange={(value) => vectorFormula("b", i, value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="inline-fields">
                <div className="field">
                  <span id="c-formula">Свободный член c(t)</span>
                  <FormulaCell
                    label="c(t)"
                    labelledBy="c-formula"
                    value={formulas.c}
                    onChange={(value) => formula("c", value)}
                  />
                </div>
              </div>
            </div>
          </div>
          <p className="help-text">
            Симметричная часть A(t) должна быть отрицательно полуопределённой в
            расчётных узлах.
          </p>
        </Section>

        <Section
          title="Ограничения"
          actions={
            <Dimension
              label="Число строк m"
              value={m}
              min={0}
              max={MAX_CONSTRAINTS}
              onChange={(next) => resizeQuadratic(n, next)}
            />
          }
        >
          {m > 0 && (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Матрица ограничений K"
            >
              <table className="input-table">
                <thead>
                  <tr>
                    <th scope="col">Строка K</th>
                    {varNames.map((name, i) => (
                      <th scope="col" key={i}>
                        {name}
                      </th>
                    ))}
                    <th scope="col">l(t)</th>
                  </tr>
                </thead>
                <tbody>
                  {q.K.map((row, i) => (
                    <tr key={i}>
                      <th scope="row">{i + 1}</th>
                      {row.map((_, j) => (
                        <td key={j}>
                          <FormulaCell
                            label={`K[${i + 1}, ${j + 1}]`}
                            value={formulas.K[i][j]}
                            onChange={(value) =>
                              matrixFormula("K", i, j, value)
                            }
                          />
                        </td>
                      ))}

                      <td>
                        <FormulaCell
                          label={`l[${i + 1}]`}
                          value={formulas.l[i]}
                          onChange={(value) => vectorFormula("l", i, value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <label className="nonnegative-toggle">
            <input
              type="checkbox"
              name="nonnegative"
              checked={nonnegative}
              onChange={(event) =>
                config({ nonnegative: event.currentTarget.checked })
              }
            />
            Добавить границы xᵢ ≥ 0 для всех переменных
          </label>
          <p className="help-text">
            Всего неравенств: {m + (nonnegative ? n : 0)}.
          </p>
        </Section>

        <Section
          title="Сетка параметра t"
          description="В каждой точке диапазона программа найдёт численный оптимум, а затем построит приближение."
        >
          <div className="field-grid">
            <NumberField
              label="Начало диапазона"
              value={c.tStart}
              onChange={(tStart) => config({ tStart })}
            />
            <NumberField
              label="Конец диапазона"
              value={c.tEnd}
              onChange={(tEnd) => config({ tEnd })}
            />
            <NumberField
              label={
                c.sampling === "adaptive"
                  ? "Начальное число точек"
                  : "Число расчётных точек"
              }
              value={c.points}
              integer
              min={2}
              max={501}
              onChange={(points) => config({ points })}
              help="Точки распределены равномерно, включая обе границы."
            />
          </div>
          <fieldset className="radio-group">
            <legend>Выбор числа точек</legend>
            <label>
              <input
                type="radio"
                name="sampling"
                value="fixed"
                checked={c.sampling === "fixed"}
                onChange={() => config({ sampling: "fixed" })}
              />
              Фиксированная сетка
            </label>
            <label>
              <input
                type="radio"
                name="sampling"
                value="adaptive"
                checked={c.sampling === "adaptive"}
                onChange={() => config({ sampling: "adaptive" })}
              />
              Автоматически до сходимости
            </label>
          </fieldset>
          {c.sampling === "adaptive" && (
            <div className="field-grid">
              <NumberField
                label="Максимальное число точек"
                value={c.maxPoints}
                integer
                min={c.points}
                max={501}
                onChange={(maxPoints) => config({ maxPoints })}
              />
              <NumberField
                label="Прибавлять точек за шаг"
                value={c.pointStep}
                integer
                min={1}
                max={100}
                onChange={(pointStep) => config({ pointStep })}
              />
              <NumberField
                label="Допуск изменения коэффициентов"
                value={c.coefficientTolerance}
                min={1e-10}
                onChange={(coefficientTolerance) =>
                  config({ coefficientTolerance })
                }
              />
              <p className="help-text">
                Остановка зависит от изменения коэффициентов приближения между
                сетками. Этот критерий не гарантирует точность оптимального
                решения.
              </p>
            </div>
          )}
        </Section>
        <Section
          title="Приближение решения"
          description="Для каждой переменной строится дробно-рациональная функция от t. Значение цели вычисляется подстановкой приближения."
        >
          <div className="inline-fields">
            <NumberField
              label="Степень числителя"
              value={c.degreeNumerator}
              integer
              min={0}
              max={4}
              onChange={(degreeNumerator) => config({ degreeNumerator })}
            />
            <NumberField
              label="Степень знаменателя"
              value={c.degreeDenominator}
              integer
              min={0}
              max={4}
              onChange={(degreeDenominator) => config({ degreeDenominator })}
            />
          </div>

          <p className="help-text">
            Ограничения при подборе проверяются в расчётных точках.
            Дополнительная проверка между ними показывается в результате.
          </p>
          <details>
            <summary>Настроить критерий приближения</summary>
            <div className="details-body">
              <p className="help-text">
                По умолчанию используется критерий ноутбука: сумма квадратов
                ошибок по переменным. Теория также допускает взвешенную ошибку
                целевой функции.
              </p>
              <div className="inline-fields">
                <NumberField
                  label="Вес ошибки по переменным α₁"
                  value={c.weightX}
                  min={0}
                  onChange={(weightX) => config({ weightX })}
                />
                <NumberField
                  label="Вес ошибки по цели α₂"
                  value={c.weightValue}
                  min={0}
                  onChange={(weightValue) => config({ weightValue })}
                />
              </div>
              <QuadraticLoss />
              <p className="help-text">
                Хотя бы один вес должен быть положительным. Величина критерия
                зависит от единиц измерения.
              </p>
            </div>
          </details>
        </Section>
        <p className="help-text">
          Все числовые поля обязательны. Можно использовать точку или запятую
          как десятичный разделитель, а также запись вида 1e−3.
        </p>
        <details className="model-context">
          <summary>Описание модели и обозначения</summary>
          <div className="details-body">
            <Section
              title="Описание модели"
              description="Названия помогут читать результаты и различать сохранённые варианты."
            >
              <div className="field-grid">
                <label className="field">
                  Название модели
                  <input
                    name="scenario-name"
                    required
                    maxLength={200}
                    value={scenario.name}
                    onChange={(e) => update({ name: e.target.value })}
                  />
                </label>
                <label className="field">
                  Примечание, необязательно
                  <input
                    name="scenario-notes"
                    maxLength={1000}
                    value={scenario.notes}
                    onChange={(e) => update({ notes: e.target.value })}
                  />
                </label>
                <label className="field">
                  Изменяемый параметр
                  <input
                    name="parameter"
                    required
                    maxLength={80}
                    value={scenario.parameter}
                    onChange={(e) => update({ parameter: e.target.value })}
                  />
                </label>
                <label className="field">
                  Единицы параметра
                  <input
                    name="parameter-unit"
                    maxLength={40}
                    value={scenario.parameterUnit}
                    onChange={(e) => update({ parameterUnit: e.target.value })}
                  />
                </label>
                <label className="field">
                  Название результата
                  <input
                    name="value-label"
                    required
                    maxLength={80}
                    value={scenario.valueLabel}
                    onChange={(e) => update({ valueLabel: e.target.value })}
                  />
                </label>
                <label className="field">
                  Единицы результата
                  <input
                    name="value-unit"
                    maxLength={40}
                    value={scenario.valueUnit}
                    onChange={(e) => update({ valueUnit: e.target.value })}
                  />
                </label>
              </div>
            </Section>
          </div>
        </details>
      </fieldset>
    </form>
  );
}
