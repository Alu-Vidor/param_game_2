import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import type {
  CalculationConfig,
  ProductionData,
  QuadraticData,
} from "../engine/types";
import { resizeMatrix, resizeVector, type Scenario } from "../lib/workspace";

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
        aria-invalid={error ? true : undefined}
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
    <div className="dimension-control">
      <span>{label}</span>
      <button
        type="button"
        className="button quiet icon"
        aria-label={`Уменьшить: ${label}`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={16} />
      </button>
      <output aria-label={label}>{value}</output>
      <button
        type="button"
        className="button quiet icon"
        aria-label={`Увеличить: ${label}`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

function Matrix({
  name,
  values,
  rowNames,
  columnNames,
  onChange,
}: {
  name: string;
  values: number[][];
  rowNames: string[];
  columnNames: string[];
  onChange: (next: number[][]) => void;
}) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label={name}>
      <table className="input-table matrix-grid">
        <caption>{name}</caption>
        <thead>
          <tr>
            <th scope="col">Строка / столбец</th>
            {columnNames.map((label, i) => (
              <th scope="col" key={i}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {values.map((row, i) => (
            <tr key={i}>
              <th scope="row">{rowNames[i]}</th>
              {row.map((v, j) => (
                <td key={j}>
                  <NumericCell
                    value={v}
                    label={`${name}: ${rowNames[i]}, ${columnNames[j]}`}
                    onChange={(next) =>
                      onChange(
                        values.map((r, ri) =>
                          ri === i
                            ? r.map((x, ci) => (ci === j ? next : x))
                            : r,
                        ),
                      )
                    }
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Editor({ scenario, onChange, busy, onRun }: Props) {
  const c = scenario.config,
    p = c.production,
    q = c.quadratic;
  const production = c.kind === "production";
  const n = production ? p.M.length : q.A.length;
  const m = production ? p.R.length : q.K.length;
  const varNames = Array.from(
    { length: n },
    (_, i) =>
      scenario.variableNames[i] ||
      `${production ? "Продукт" : "Переменная"} ${i + 1}`,
  );
  const resourceNames = Array.from(
    { length: production ? m : p.R.length },
    (_, i) => scenario.resourceNames[i] || `Ресурс ${i + 1}`,
  );
  const update = (next: Partial<Scenario>) =>
    onChange({ ...scenario, ...next, updatedAt: new Date().toISOString() });
  const config = (next: Partial<CalculationConfig>) =>
    update({ config: { ...c, ...next } });
  const prod = (next: Partial<ProductionData>) =>
    config({ production: { ...p, ...next } });
  const quad = (next: Partial<QuadraticData>) =>
    config({ quadratic: { ...q, ...next } });
  function prodVector(key: keyof ProductionData, i: number, value: number) {
    const current = p[key];
    if (Array.isArray(current))
      prod({
        [key]: (current as number[]).map((x, j) => (i === j ? value : x)),
      });
  }
  function quadVector(
    key: "b0" | "b1" | "l0" | "l1",
    i: number,
    value: number,
  ) {
    quad({ [key]: q[key].map((x, j) => (i === j ? value : x)) });
  }
  function nameAt(
    key: "variableNames" | "resourceNames",
    i: number,
    name: string,
  ) {
    const current = key === "variableNames" ? varNames : resourceNames;
    update({ [key]: current.map((x, j) => (i === j ? name : x)) });
  }
  function resizeProduction(nextN: number, nextM: number) {
    update({
      variableNames: Array.from(
        { length: nextN },
        (_, i) => scenario.variableNames[i] ?? `Продукт ${i + 1}`,
      ),
      resourceNames: Array.from(
        { length: nextM },
        (_, i) => scenario.resourceNames[i] ?? `Ресурс ${i + 1}`,
      ),
      config: {
        ...c,
        production: {
          ...p,
          M: resizeMatrix(p.M, nextN, nextN, 0.5),
          H: resizeMatrix(p.H, nextM, nextM, 0.1),
          R: resizeMatrix(p.R, nextM, nextN),
          p0: resizeVector(p.p0, nextN, 20),
          p1: resizeVector(p.p1, nextN),
          k: resizeVector(p.k, nextN),
          capacity0: resizeVector(p.capacity0, nextN, 10),
          capacity1: resizeVector(p.capacity1, nextN),
          resourceLimits: resizeVector(p.resourceLimits, nextM, 10),
          r0: resizeVector(p.r0, nextM),
          r1: resizeVector(p.r1, nextM),
        },
      },
    });
  }
  function resizeQuadratic(nextN: number, nextM: number) {
    update({
      variableNames: Array.from(
        { length: nextN },
        (_, i) => scenario.variableNames[i] ?? `Переменная ${i + 1}`,
      ),
      config: {
        ...c,
        quadratic: {
          ...q,
          A: resizeMatrix(q.A, nextN, nextN, -1),
          b0: resizeVector(q.b0, nextN),
          b1: resizeVector(q.b1, nextN),
          K: resizeMatrix(q.K, nextM, nextN),
          l0: resizeVector(q.l0, nextM),
          l1: resizeVector(q.l1, nextM),
        },
      },
    });
  }
  return (
    <form
      id="model-form"
      className="editor"
      aria-label="Исходные данные"
      onSubmit={(event) => {
        event.preventDefault();
        onRun?.();
      }}
    >
      <fieldset disabled={busy} className="editor-fields">
        <legend className="visually-hidden">Параметры модели</legend>
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
                    placeholder="Например, дни"
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

        {production ? (
          <>
            <Section
              title="Продукты и выпуск"
              description="Цена и верхняя граница выпуска меняются по правилу: начальное значение + изменение × t."
              actions={
                <Dimension
                  label="Продукты"
                  value={n}
                  min={1}
                  max={6}
                  onChange={(next) => resizeProduction(next, m)}
                />
              }
            >
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Параметры продуктов"
              >
                <table className="input-table">
                  <caption className="visually-hidden">
                    Цены, затраты и мощности по продуктам
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Продукт</th>
                      <th scope="col">Цена p₀</th>
                      <th scope="col">Изменение p₁</th>
                      <th scope="col">Затраты k</th>
                      <th scope="col">Выпуск, не более x̄₀</th>
                      <th scope="col">Изменение x̄₁</th>
                    </tr>
                  </thead>
                  <tbody>
                    {varNames.map((name, i) => (
                      <tr key={i}>
                        <th scope="row">
                          <input
                            name={`product-${i}`}
                            className="name-input"
                            aria-label={`Название продукта ${i + 1}`}
                            required
                            maxLength={80}
                            value={scenario.variableNames[i] ?? name}
                            onChange={(e) =>
                              nameAt("variableNames", i, e.target.value)
                            }
                          />
                        </th>
                        {(
                          ["p0", "p1", "k", "capacity0", "capacity1"] as const
                        ).map((key, j) => (
                          <td key={key}>
                            <NumericCell
                              value={p[key][i]}
                              label={`${name}: ${["начальная цена", "изменение цены", "затраты на единицу", "начальная мощность", "изменение мощности"][j]}`}
                              onChange={(value) => prodVector(key, i, value)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help-text">
                Объёмы выпуска неотрицательны. Дробный объём разрешён: задача не
                является целочисленной.
              </p>
            </Section>

            <Section
              title="Ресурсы и ограничения"
              description="Укажите расход ресурса на единицу каждого продукта, доступный запас и коэффициенты стоимости."
              actions={
                <Dimension
                  label="Ресурсы"
                  value={m}
                  min={1}
                  max={10}
                  onChange={(next) => resizeProduction(n, next)}
                />
              }
            >
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Ресурсы производства"
              >
                <table className="input-table">
                  <caption className="visually-hidden">
                    Матрица расходов ресурсов R и доступные запасы
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Ресурс</th>
                      {varNames.map((name, i) => (
                        <th scope="col" key={i}>
                          Расход: {name}
                        </th>
                      ))}
                      <th scope="col">Запас R̄</th>
                      <th scope="col">Стоимость r₀</th>
                      <th scope="col">Изменение r₁</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resourceNames.map((name, i) => (
                      <tr key={i}>
                        <th scope="row">
                          <input
                            name={`resource-${i}`}
                            className="name-input"
                            aria-label={`Название ресурса ${i + 1}`}
                            required
                            maxLength={80}
                            value={scenario.resourceNames[i] ?? name}
                            onChange={(e) =>
                              nameAt("resourceNames", i, e.target.value)
                            }
                          />
                        </th>
                        {varNames.map((productName, j) => (
                          <td key={j}>
                            <NumericCell
                              value={p.R[i][j]}
                              label={`${name}: расход на ${productName}`}
                              onChange={(value) =>
                                prod({
                                  R: p.R.map((row, ri) =>
                                    ri === i
                                      ? row.map((x, ci) =>
                                          ci === j ? value : x,
                                        )
                                      : row,
                                  ),
                                })
                              }
                            />
                          </td>
                        ))}
                        {(["resourceLimits", "r0", "r1"] as const).map(
                          (key, j) => (
                            <td key={key}>
                              <NumericCell
                                value={p[key][i]}
                                label={`${name}: ${["доступный запас", "начальная стоимость", "изменение стоимости"][j]}`}
                                onChange={(value) => prodVector(key, i, value)}
                              />
                            </td>
                          ),
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help-text">
                Для каждого ресурса суммарный расход не должен превышать запас.
                Стоимость задаётся как r₀ + r₁ × t.
              </p>
            </Section>

            <Section
              title="Квадратичная часть модели"
              description="Матрицы M и H задают нелинейную часть целевой функции, как в исходном примере."
            >
              <p className="formula-inline">A = −M + RᵀHR</p>
              <details>
                <summary>Изменить матрицы M и H</summary>
                <div className="details-body">
                  <Matrix
                    name="Матрица M"
                    values={p.M}
                    rowNames={varNames}
                    columnNames={varNames}
                    onChange={(M) => prod({ M })}
                  />
                  <Matrix
                    name="Матрица H"
                    values={p.H}
                    rowNames={resourceNames}
                    columnNames={resourceNames}
                    onChange={(H) => prod({ H })}
                  />
                  <p className="help-text">
                    Максимум определяется для вогнутой квадратичной функции.
                    Вычислительный модуль проверит это условие перед расчётом.
                  </p>
                </div>
              </details>
              <div className="inline-fields">
                <NumberField
                  label="Постоянная часть v₀"
                  value={p.v0}
                  onChange={(v0) => prod({ v0 })}
                />
                <NumberField
                  label="Изменение v₁"
                  value={p.v1}
                  onChange={(v1) => prod({ v1 })}
                />
              </div>
              <p className="help-text">
                Свободный член результата: v(t) = v₀ + v₁ × t.
              </p>
            </Section>
          </>
        ) : (
          <>
            <Section
              title="Переменные и целевая функция"
              description="Программа максимизирует xᵀAx + b(t)ᵀx + c(t), где b(t) = b₀ + b₁t. Все переменные неотрицательны."
              actions={
                <Dimension
                  label="Переменные"
                  value={n}
                  min={1}
                  max={6}
                  onChange={(next) => resizeQuadratic(next, m)}
                />
              }
            >
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Переменные и линейные коэффициенты"
              >
                <table className="input-table">
                  <caption className="visually-hidden">
                    Коэффициенты b по переменным
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Переменная</th>
                      <th scope="col">Начальный коэффициент b₀</th>
                      <th scope="col">Изменение b₁</th>
                    </tr>
                  </thead>
                  <tbody>
                    {varNames.map((name, i) => (
                      <tr key={i}>
                        <th scope="row">
                          <input
                            name={`variable-${i}`}
                            className="name-input"
                            aria-label={`Название переменной ${i + 1}`}
                            required
                            maxLength={80}
                            value={scenario.variableNames[i] ?? name}
                            onChange={(e) =>
                              nameAt("variableNames", i, e.target.value)
                            }
                          />
                        </th>
                        <td>
                          <NumericCell
                            value={q.b0[i]}
                            label={`${name}: b₀`}
                            onChange={(value) => quadVector("b0", i, value)}
                          />
                        </td>
                        <td>
                          <NumericCell
                            value={q.b1[i]}
                            label={`${name}: b₁`}
                            onChange={(value) => quadVector("b1", i, value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Matrix
                name="Матрица A"
                values={q.A}
                rowNames={varNames}
                columnNames={varNames}
                onChange={(A) => quad({ A })}
              />
              <div className="inline-fields">
                <NumberField
                  label="Свободный член c₀"
                  value={q.c0}
                  onChange={(c0) => quad({ c0 })}
                />
                <NumberField
                  label="Изменение c₁"
                  value={q.c1}
                  onChange={(c1) => quad({ c1 })}
                />
              </div>
              <p className="help-text">
                c(t) = c₀ + c₁ × t. Для корректной задачи максимизации
                симметричная часть A должна быть отрицательно полуопределённой.
              </p>
            </Section>
            <Section
              title="Линейные ограничения"
              description="Каждая строка задаёт сумму коэффициентов × переменные ≤ l₀ + l₁ × t."
              actions={
                <Dimension
                  label="Ограничения"
                  value={m}
                  min={1}
                  max={15}
                  onChange={(next) => resizeQuadratic(n, next)}
                />
              }
            >
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Матрица ограничений K"
              >
                <table className="input-table">
                  <caption className="visually-hidden">Kx ≤ l(t)</caption>
                  <thead>
                    <tr>
                      <th scope="col">Ограничение</th>
                      {varNames.map((name, i) => (
                        <th scope="col" key={i}>
                          {name}
                        </th>
                      ))}
                      <th scope="col">Правая часть l₀</th>
                      <th scope="col">Изменение l₁</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.K.map((row, i) => (
                      <tr key={i}>
                        <th scope="row">Ограничение {i + 1}</th>
                        {row.map((v, j) => (
                          <td key={j}>
                            <NumericCell
                              value={v}
                              label={`Ограничение ${i + 1}: коэффициент ${varNames[j]}`}
                              onChange={(value) =>
                                quad({
                                  K: q.K.map((r, ri) =>
                                    ri === i
                                      ? r.map((x, ci) => (ci === j ? value : x))
                                      : r,
                                  ),
                                })
                              }
                            />
                          </td>
                        ))}
                        <td>
                          <NumericCell
                            value={q.l0[i]}
                            label={`Ограничение ${i + 1}: l₀`}
                            onChange={(value) => quadVector("l0", i, value)}
                          />
                        </td>
                        <td>
                          <NumericCell
                            value={q.l1[i]}
                            label={`Ограничение ${i + 1}: l₁`}
                            onChange={(value) => quadVector("l1", i, value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="help-text">
                Условия x ≥ 0 уже учтены. Добавлять их отдельными строками не
                обязательно.
              </p>
            </Section>
          </>
        )}

        <Section
          title="Диапазон параметра"
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
                плана.
              </p>
            </div>
          )}
        </Section>
        <Section
          title="Приближение решения"
          description="Для каждой переменной строится дробно-рациональная функция от t. Значение цели вычисляется подстановкой этого плана."
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
          <label className="check-field">
            <input
              type="checkbox"
              name="enforce-feasibility"
              checked={c.enforceFeasibility}
              onChange={(e) => config({ enforceFeasibility: e.target.checked })}
            />
            Соблюдать ограничения при подборе приближения
          </label>
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
              <p className="formula-inline">
                H(D) = α₁ ∑ ‖x − x̃‖² + α₂ ∑ (f(x, t) − f(x̃, t))²
              </p>
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
      </fieldset>
    </form>
  );
}
