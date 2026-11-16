import { useEffect, useId, useState } from "react";
import { Download, Info } from "lucide-react";
import type { Scenario } from "../lib/workspace";
import { download, number } from "../lib/workspace";
import type { RationalFit } from "../engine/types";
import LineChart from "./LineChart";

export type ResultDetail = "charts" | "table" | "formulas";
interface Props {
  scenario: Scenario;
  detail: ResultDetail;
  onDetailChange: (detail: ResultDetail) => void;
}

function csvCell(value: string | number | null) {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function polynomial(coefficients: number[]) {
  const terms: string[] = [];
  for (let i = coefficients.length - 1; i >= 0; i--) {
    const value = coefficients[i];
    if (value === 0) continue;
    const coefficient = Number(Math.abs(value).toPrecision(8)).toString();
    const power = i === 0 ? "" : i === 1 ? "t" : `t^${i}`;
    const body = `${power && Math.abs(value) === 1 ? "" : coefficient}${power && Math.abs(value) !== 1 ? " × " : ""}${power}`;
    terms.push(`${value < 0 ? "− " : terms.length ? "+ " : ""}${body}`);
  }
  return terms.join(" ") || "0";
}

function Formula({
  fit,
  name,
  index,
}: {
  fit: RationalFit;
  name: string;
  index: number;
}) {
  return (
    <div className="formula-item">
      <h3>{name}</h3>
      <div
        className="formula-expression"
        role="math"
        aria-label={`Приближение x${index + 1}: (${polynomial(fit.numerator)}) / (${polynomial(fit.denominator)})`}
      >
        <span>
          x̃<sub>{index + 1}</sub>(t) ={" "}
        </span>
        <span className="fraction">
          <span>{polynomial(fit.numerator)}</span>
          <span>{polynomial(fit.denominator)}</span>
        </span>
      </div>
      <details>
        <summary>Коэффициенты без округления</summary>
        <dl className="coefficient-list">
          <dt>Числитель, от свободного члена</dt>
          <dd>
            <code>{fit.numerator.join("; ")}</code>
          </dd>
          <dt>Знаменатель, от свободного члена</dt>
          <dd>
            <code>{fit.denominator.join("; ")}</code>
          </dd>
        </dl>
      </details>
    </div>
  );
}

export default function Results({ scenario, detail, onDetailChange }: Props) {
  const [index, setIndex] = useState(0);
  const id = useId();
  const result = scenario.snapshot?.result;
  useEffect(() => {
    setIndex(result ? Math.floor((result.samples.length - 1) / 2) : 0);
  }, [result]);
  if (!result?.samples.length)
    return (
      <section className="section result-empty">
        <h2>Сначала рассчитайте модель</h2>
        <p>
          Заполните исходные данные и нажмите «Рассчитать план». Здесь появятся
          значения переменных, результат и загрузка ограничений.
        </p>
      </section>
    );
  const pointIndex = Math.min(index, result.samples.length - 1);
  const chosen = result.samples[pointIndex];
  const variableNames = chosen.x.map(
    (_, i) => scenario.variableNames[i] || `Переменная ${i + 1}`,
  );
  const isProduction = scenario.config.kind === "production";
  const resources = scenario.config.production.R.length;
  const n = chosen.x.length;
  const restrictions = result.canonical.K.map((row, i) => {
    const used = row.reduce(
      (total, coefficient, j) => total + coefficient * chosen.x[j],
      0,
    );
    const limit = result.canonical.l0[i] + result.canonical.l1[i] * chosen.t;
    const slack = chosen.slack[i] ?? limit - used;
    const label = !isProduction
      ? `Ограничение ${i + 1}`
      : i < resources
        ? scenario.resourceNames[i] || `Ресурс ${i + 1}`
        : i < resources + n
          ? `Мощность: ${variableNames[i - resources]}`
          : `Неотрицательность: ${variableNames[i - resources - n]}`;
    return {
      label,
      used,
      limit,
      slack,
      active: Math.abs(slack) < 1e-6,
      violated: slack < -1e-6,
    };
  });
  function csv() {
    const header = [
      scenario.parameter,
      `${scenario.valueLabel}, численное решение (${scenario.valueUnit})`,
      `${scenario.valueLabel}, приближение (${scenario.valueUnit})`,
      "Абсолютная ошибка результата",
      ...variableNames.flatMap((name) => [
        `${name}, численное решение`,
        `${name}, приближение`,
        `${name}, абсолютная ошибка`,
      ]),
      ...restrictions.map((row) => `Запас: ${row.label}`),
    ];
    const rows = result!.samples.map((p) => [
      p.t,
      p.value,
      p.valueApprox,
      p.valueApprox === null ? null : Math.abs(p.value - p.valueApprox),
      ...p.x.flatMap((value, i) => [
        value,
        p.xApprox?.[i] ?? null,
        p.xApprox ? Math.abs(value - p.xApprox[i]) : null,
      ]),
      ...p.slack,
    ]);
    download(
      "\uFEFF" +
        [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n"),
      "planning-results.csv",
      "text/csv;charset=utf-8",
    );
  }
  const tableId = `${id}-table`;
  const restrictionTable = (rows: typeof restrictions, suffix: string) => (
    <div
      className="table-scroll"
      role="region"
      tabIndex={0}
      aria-label={`Ограничения при ${scenario.parameter} = ${number(chosen.t)}`}
    >
      <table className="data-table constraint-table">
        <caption className="visually-hidden">
          Использование ограничений для выбранного численного решения
        </caption>
        <thead>
          <tr>
            <th scope="col">Ограничение</th>
            <th scope="col">Использовано</th>
            <th scope="col">Доступно</th>
            <th scope="col">Запас</th>
            <th scope="col">Состояние</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${suffix}-${i}`}>
              <th scope="row">{row.label}</th>
              <td className="num">{number(row.used)}</td>
              <td className="num">{number(row.limit)}</td>
              <td className="num">{number(row.slack)}</td>
              <td>
                {row.violated
                  ? "Нарушено"
                  : row.active
                    ? "Использовано полностью"
                    : "Есть запас"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="results">
      <section
        className="section parameter-section"
        aria-labelledby={`${id}-parameter`}
      >
        <div className="section-heading">
          <h2 id={`${id}-parameter`}>
            {scenario.parameter} = {number(chosen.t)} {scenario.parameterUnit}
          </h2>
          <p>Выберите точку, для которой рассчитано численное решение.</p>
        </div>
        <div className="parameter-selector">
          <label className="field">
            <span>
              {scenario.parameter}
              {scenario.parameterUnit ? `, ${scenario.parameterUnit}` : ""}
            </span>
            <select
              value={pointIndex}
              onChange={(e) => setIndex(Number(e.target.value))}
            >
              {result.samples.map((p, i) => (
                <option key={i} value={i}>
                  {number(p.t, 8)}
                </option>
              ))}
            </select>
          </label>
          <div className="parameter-slider">
            <label htmlFor={`${id}-range`} className="visually-hidden">
              Выбор расчётной точки
            </label>
            <input
              id={`${id}-range`}
              type="range"
              min={0}
              max={result.samples.length - 1}
              step={1}
              value={pointIndex}
              aria-valuetext={`${scenario.parameter}: ${number(chosen.t)} ${scenario.parameterUnit}`}
              onChange={(e) => setIndex(Number(e.target.value))}
            />
            <div className="range-limits">
              <span>{number(result.samples[0].t)}</span>
              <span>{number(result.samples.at(-1)!.t)}</span>
            </div>
          </div>
        </div>
        <div className="result-overview">
          <div className="result-value">
            <span>{scenario.valueLabel}</span>
            <strong className="num">
              {number(chosen.value, 4)} <small>{scenario.valueUnit}</small>
            </strong>
            <p className="help-text">Максимум по численному решению</p>
          </div>
          <dl className="result-plan">
            {variableNames.map((name, i) => (
              <div key={i}>
                <dt>{name}</dt>
                <dd className="num">{number(chosen.x[i], 5)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
      <section className="section constraints-section">
        <div className="section-heading">
          <h2>
            {isProduction ? "Ресурсы и мощности" : "Выполнение ограничений"}
          </h2>
          <p>
            Запас равен доступному объёму минус использованный. Нулевой запас
            означает активное ограничение.
          </p>
        </div>
        {restrictionTable(
          isProduction ? restrictions.slice(0, resources + n) : restrictions,
          "main",
        )}
        {isProduction && (
          <details className="bound-details">
            <summary>Проверка неотрицательности переменных</summary>
            {restrictionTable(restrictions.slice(resources + n), "bounds")}
          </details>
        )}
      </section>
      <section className="section analysis-section">
        <div className="analysis-toolbar">
          <nav className="detail-tabs" aria-label="Представление результатов">
            {(
              [
                ["charts", "Динамика"],
                ["table", "Таблица"],
                ["formulas", "Формулы"],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-current={detail === key ? "page" : undefined}
                className={detail === key ? "active" : ""}
                onClick={() => onDetailChange(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <button type="button" className="button quiet" onClick={csv}>
            <Download size={17} aria-hidden="true" />
            <span>Скачать CSV</span>
          </button>
        </div>
        {detail === "charts" && (
          <div className="chart-content">
            <div className="chart-legend">
              <span>
                <i className="legend-sample" />
                Численное решение
              </span>
              <span>
                <i className="legend-fit" />
                Приближение
              </span>
            </div>
            <LineChart
              title={`Как меняется ${scenario.valueLabel.toLocaleLowerCase()}`}
              samples={result.samples.map((p) => ({ t: p.t, value: p.value }))}
              curve={result.curve.map((p) => ({
                t: p.t,
                value: p.denominatorSafe ? p.valueApprox : null,
              }))}
              selectedT={chosen.t}
              parameter={scenario.parameter}
              unit={scenario.valueUnit}
            />
            <div className="variable-charts">
              {variableNames.map((name, i) => (
                <LineChart
                  key={i}
                  title={name}
                  samples={result.samples.map((p) => ({
                    t: p.t,
                    value: p.x[i],
                  }))}
                  curve={result.curve.map((p) => ({
                    t: p.t,
                    value: p.denominatorSafe ? (p.xApprox?.[i] ?? null) : null,
                  }))}
                  selectedT={chosen.t}
                  parameter={scenario.parameter}
                />
              ))}
            </div>
            <p className="help-text">
              Шкалы графиков подобраны по данным. Точки показывают решение
              задачи для выбранной сетки, линии показывают рациональное
              приближение между ними.
            </p>
          </div>
        )}
        {detail === "table" && (
          <div className="table-content">
            <div className="section-heading">
              <h2 id={tableId}>Результаты в расчётных точках</h2>
              <p>
                {result.samples.length} точек. Ошибка: абсолютная разница между
                численным решением и приближением.
              </p>
            </div>
            <div
              className="table-scroll"
              role="region"
              tabIndex={0}
              aria-labelledby={tableId}
            >
              <table className="data-table result-data">
                <thead>
                  <tr>
                    <th scope="col">{scenario.parameter}</th>
                    <th scope="col">{scenario.valueLabel}</th>
                    <th scope="col">Приближение результата</th>
                    <th scope="col">Ошибка результата</th>
                    {variableNames.flatMap((name, i) => [
                      <th scope="col" key={`x${i}`}>
                        {name}
                      </th>,
                      <th scope="col" key={`a${i}`}>
                        Приближение: {name}
                      </th>,
                      <th scope="col" key={`e${i}`}>
                        Ошибка: {name}
                      </th>,
                    ])}
                  </tr>
                </thead>
                <tbody>
                  {result.samples.map((p, pi) => (
                    <tr
                      key={pi}
                      className={pi === pointIndex ? "selected-row" : undefined}
                    >
                      <th scope="row" className="num">
                        {number(p.t, 6)}
                      </th>
                      <td className="num">{number(p.value, 6)}</td>
                      <td className="num">{number(p.valueApprox, 6)}</td>
                      <td className="num">
                        {number(
                          p.valueApprox === null
                            ? null
                            : Math.abs(p.value - p.valueApprox),
                          8,
                        )}
                      </td>
                      {p.x.flatMap((value, i) => [
                        <td className="num" key={`x${i}`}>
                          {number(value, 6)}
                        </td>,
                        <td className="num" key={`a${i}`}>
                          {number(p.xApprox?.[i], 6)}
                        </td>,
                        <td className="num" key={`e${i}`}>
                          {number(
                            p.xApprox ? Math.abs(value - p.xApprox[i]) : null,
                            8,
                          )}
                        </td>,
                      ])}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {detail === "formulas" && (
          <div className="formula-content">
            <div className="section-heading">
              <h2>Рациональное приближение плана</h2>
              <p>
                Коэффициенты подобраны по расчётным точкам. В формулах
                используется t, ваш параметр «{scenario.parameter}».
              </p>
            </div>
            {result.fits.map((fit, i) => (
              <Formula key={i} fit={fit} name={variableNames[i]} index={i} />
            ))}
            <div className="formula-item">
              <h3>Приближение результата</h3>
              <p className="formula-expression">
                f̃(t) = x̃(t)ᵀ A x̃(t) + b(t)ᵀ x̃(t) + c(t)
              </p>
              <p className="help-text">
                Результат вычисляется подстановкой приближённого плана в
                исходную целевую функцию.
              </p>
            </div>
          </div>
        )}
        <p className="notice result-caution">
          <Info size={18} aria-hidden="true" />
          <span>
            Приближение проверяется в расчётных точках и на дополнительной
            сетке. Проверка сетки не гарантирует выполнение ограничений при
            каждом значении параметра. Для решения используйте численный план и
            раздел «Метод и точность».
          </span>
        </p>
      </section>
    </div>
  );
}
