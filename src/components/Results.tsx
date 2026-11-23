import {
  Approx,
  Call,
  FractionCard,
  MathBlock,
  MathNumber,
} from "./MathNotation";
import { QuadraticObjective } from "./QuadraticNotation";
import { useEffect, useId, useState } from "react";
import { Download, Info } from "lucide-react";
import type { Scenario } from "../lib/workspace";
import { download, number } from "../lib/workspace";
import type { RationalFit } from "../engine/types";
import LineChart from "./LineChart";

interface Props {
  scenario: Scenario;
}

function csvCell(value: string | number | null) {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function Formula({
  fit,
  name,
  index,
  symbol,
}: {
  fit: RationalFit;
  name: string;
  index: number;
  symbol: string;
}) {
  return (
    <FractionCard
      title={name}
      label={
        <Call
          name={
            <msub>
              <Approx name="x" />
              <mn>{index + 1}</mn>
            </msub>
          }
        />
      }
      numerator={fit.numerator}
      denominator={fit.denominator}
      symbol={symbol}
    >
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
    </FractionCard>
  );
}

export default function Results({ scenario }: Props) {
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
          Заполните исходные данные и нажмите «Рассчитать». Здесь появятся
          значения переменных, результат и загрузка ограничений.
        </p>
      </section>
    );
  const pointIndex = Math.min(index, result.samples.length - 1);
  const chosen = result.samples[pointIndex];
  const variableNames = chosen.x.map(
    (_, i) => scenario.variableNames[i] || `Переменная ${i + 1}`,
  );
  const restrictions = result.canonical.K.map((row, i) => {
    const used =
      chosen.constraintLeft?.[i] ??
      row.reduce(
        (total, coefficient, j) => total + coefficient * chosen.x[j],
        0,
      );
    const limit =
      chosen.constraintRight?.[i] ??
      result.canonical.l0[i] + result.canonical.l1[i] * chosen.t;
    const slack = chosen.slack[i] ?? limit - used;
    const label = "Строка K: " + (i + 1);
    return {
      label,
      used,
      limit,
      slack,
      active: Math.abs(slack) < 1e-6,
      violated: slack < -1e-6,
    };
  });
  const nonnegative = scenario.config.nonnegative !== false;
  const limits = [
    ...restrictions,
    ...(nonnegative
      ? chosen.x.map((value, i) => ({
          label: variableNames[i] + " ≥ 0",
          used: -value,
          limit: 0,
          slack: value,
          active: Math.abs(value) < 1e-6,
          violated: value < -1e-6,
        }))
      : []),
  ];
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
      ...limits.map((row) => `Остаток: ${row.label}`),
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
      ...(nonnegative ? p.x : []),
    ]);
    download(
      "\uFEFF" +
        [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n"),
      "qp-results.csv",
      "text/csv;charset=utf-8",
    );
  }
  const tableId = `${id}-table`;
  const restrictionTable = (rows: typeof restrictions) => (
    <div
      className="table-scroll"
      role="region"
      tabIndex={0}
      aria-label={`Ограничения при ${scenario.parameter} = ${number(chosen.t)}`}
    >
      <table className="data-table constraint-table">
        <caption className="visually-hidden">
          Остатки ограничений для выбранного численного решения
        </caption>
        <thead>
          <tr>
            <th scope="col">Ограничение</th>
            <th scope="col">Левая часть</th>
            <th scope="col">Правая часть</th>
            <th scope="col">Остаток</th>
            <th scope="col">Состояние</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <th scope="row">{row.label}</th>
              <td className="num">{number(row.used)}</td>
              <td className="num">{number(row.limit)}</td>
              <td className="num">{number(row.slack)}</td>
              <td>
                {row.violated
                  ? "Нарушено"
                  : row.active
                    ? "Активно"
                    : "Выполнено"}
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
          <h2>Ограничения</h2>
          <p>
            Остаток равен правой части минус левая. Нулевой остаток означает
            активное ограничение.
          </p>
        </div>
        {limits.length ? (
          restrictionTable(limits)
        ) : (
          <p>Переменные свободны. Строк матрицы K нет.</p>
        )}
      </section>
      <section className="section analysis-section">
        <div className="analysis-toolbar">
          <button type="button" className="button quiet" onClick={csv}>
            <Download size={17} aria-hidden="true" />
            <span>Скачать CSV</span>
          </button>
        </div>
        <details className="result-disclosure">
          <summary>Графики</summary>
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
        </details>
        <details className="result-disclosure">
          <summary>Таблица решений</summary>
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
        </details>
        <details className="result-disclosure">
          <summary>Формулы</summary>
          <div className="formula-content">
            <div className="section-heading">
              <h2>Рациональное приближение решения</h2>
              <p>
                Коэффициенты показаны с округлением. Копирование сохраняет
                полную точность выражения.
              </p>
            </div>
            {result.argumentCenter !== undefined && (
              <MathBlock>
                <mrow>
                  <mi>s</mi>
                  <mo>=</mo>
                  <mi>t</mi>
                  <mo>−</mo>
                  <mo>(</mo>
                  <MathNumber value={result.argumentCenter} digits={17} />
                  <mo>)</mo>
                </mrow>
              </MathBlock>
            )}
            <div className="math-card-grid">
              {result.fits.map((fit, i) => (
                <Formula
                  key={i}
                  fit={fit}
                  name={variableNames[i]}
                  index={i}
                  symbol={result.argumentCenter === undefined ? "t" : "s"}
                />
              ))}
            </div>
            <div className="formula-item">
              <h3>Приближение результата</h3>
              <QuadraticObjective approximate />
              <p className="help-text">
                Результат вычисляется подстановкой приближённого вектора в
                исходную целевую функцию.
              </p>
            </div>
          </div>
        </details>
        <p className="notice result-caution">
          <Info size={18} aria-hidden="true" />
          <span>
            Приближение проверяется в расчётных точках и на дополнительной
            сетке. Гарантия между узлами требует отдельной проверки всего
            интервала.
          </span>
        </p>
      </section>
    </div>
  );
}
