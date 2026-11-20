import {
  compileExpressions,
  type CoefficientFunctions,
} from "./lib/coefficient";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  Download,
  FileInput,
  FolderOpen,
  GitBranch,
  Layers3,
  LoaderCircle,
  Play,
  Plus,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  CalculationMessage,
  CalculationRequest,
  CalculationResult,
} from "./engine/types";
import Editor from "./components/Editor";
import Results from "./components/Results";
import {
  createScenario,
  download,
  exportScenario,
  fingerprint,
  isCurrent,
  loadWorkspace,
  number,
  parseScenario,
  scientific,
  STORAGE_KEY,
  type Scenario,
} from "./lib/workspace";

type View = "models" | "editor";
function route() {
  const q = new URLSearchParams(location.search);
  return {
    view: (q.get("view") === "models" ? "models" : "editor") as View,
    id: q.get("model"),
  };
}
function formulaSize(s: Scenario) {
  return { n: s.config.quadratic.A.length, m: s.config.quadratic.K.length };
}

export default function App() {
  const [initial] = useState(loadWorkspace);
  const [scenarios, setScenarios] = useState(initial.scenarios);
  const [locationState, setLocationState] = useState(route);
  const [storageError, setStorageError] = useState(initial.warning || "");
  const [canSave, setCanSave] = useState(!initial.warning);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ stage: "", progress: 0 });
  const [deleteId, setDeleteId] = useState<string>();
  const worker = useRef<Worker | null>(null);
  const request = useRef<{
    id: string;
    scenarioId: string;
    fingerprint: string;
  } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const current =
    scenarios.find((s) => s.id === locationState.id) || scenarios[0];
  const view = locationState.view;
  const size = current ? formulaSize(current) : { n: 0, m: 0 };

  useEffect(() => {
    const listener = () => setLocationState(route());
    window.addEventListener("popstate", listener);
    return () => window.removeEventListener("popstate", listener);
  }, []);
  useEffect(() => {
    if (!canSave) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
        setStorageError("");
      } catch {
        setStorageError(
          "Не удалось сохранить данные в браузере. Экспортируйте модель в JSON, чтобы не потерять изменения.",
        );
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [scenarios, canSave]);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
    title.current?.focus({ preventScroll: true });
  }, [view, current?.id]);
  useEffect(() => () => worker.current?.terminate(), []);

  function navigate(nextView: View, id = current?.id) {
    const q = new URLSearchParams({ view: nextView });
    if (id) q.set("model", id);
    history.pushState(null, "", location.pathname + "?" + q);
    setLocationState({ view: nextView, id: id || null });
    setError("");
  }
  function update(next: Scenario) {
    setScenarios((all) =>
      all.map((s) =>
        s.id === next.id ? { ...next, updatedAt: new Date().toISOString() } : s,
      ),
    );
    setError("");
    setNotice("");
  }
  function hasSpace() {
    if (scenarios.length < 30) return true;
    setError(
      "В пространстве уже 30 моделей. Экспортируйте и удалите ненужную модель перед добавлением новой.",
    );
    return false;
  }
  function create(preset: Parameters<typeof createScenario>[0]) {
    if (!hasSpace()) return;
    const next = createScenario(preset);
    setScenarios((all) => [next, ...all]);
    navigate("editor", next.id);
  }
  function duplicate(s: Scenario) {
    if (!hasSpace()) return;
    const next = {
      ...structuredClone(s),
      id: crypto.randomUUID(),
      name: `${s.name.slice(0, 190)} (копия)`,
      updatedAt: new Date().toISOString(),
    };
    setScenarios((all) => [next, ...all]);
    navigate("editor", next.id);
    setNotice("Копия создана. Можно проверить другие условия.");
  }
  async function importFile(file?: File) {
    if (!file || !hasSpace()) return;
    try {
      if (file.size > 8 * 1024 * 1024)
        throw new Error("Файл слишком большой. Максимальный размер — 8 МБ.");
      const data = JSON.parse(await file.text());
      const next = parseScenario(data.scenario ?? data);
      next.id = crypto.randomUUID();
      next.updatedAt = new Date().toISOString();
      setScenarios((all) => [next, ...all]);
      navigate("editor", next.id);
      setNotice("Модель импортирована. Проверьте данные перед расчётом.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать JSON.");
    } finally {
      if (importInput.current) importInput.current.value = "";
    }
  }
  function cancel() {
    worker.current?.terminate();
    worker.current = null;
    request.current = null;
    setBusy(false);
    setNotice("Расчёт остановлен. Исходные данные сохранены.");
  }
  function run() {
    if (!current || busy) return;
    const form = document.getElementById(
      "model-form",
    ) as HTMLFormElement | null;
    if (form && !form.reportValidity()) return;
    setError("");
    setNotice("");
    let coefficientFunctions: CoefficientFunctions | undefined;
    try {
      if (
        current.config.coefficientMode === "rational" &&
        current.config.expressions
      )
        coefficientFunctions = compileExpressions(current.config.expressions);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Проверьте формулы коэффициентов.",
      );
      return;
    }
    setBusy(true);
    setProgress({ stage: "Подготавливаем расчёт", progress: 0 });
    const calculation = { ...current.config, enforceFeasibility: true };
    if (!current.config.enforceFeasibility)
      update({ ...current, config: calculation });
    const job = {
      id: crypto.randomUUID(),
      scenarioId: current.id,
      fingerprint: fingerprint({ ...current, config: calculation }),
    };
    request.current = job;
    try {
      if (!worker.current) {
        worker.current = new Worker(
          new URL("./engine/calculation.worker.ts", import.meta.url),
          { type: "module" },
        );
        worker.current.onmessage = (
          event: MessageEvent<CalculationMessage>,
        ) => {
          const message = event.data;
          const active = request.current;
          if (!active || message.id !== active.id) return;
          if (message.type === "progress")
            setProgress({ stage: message.stage, progress: message.progress });
          if (message.type === "error") {
            setError(message.message);
            requestAnimationFrame(() =>
              document
                .getElementById("qp-calculation-error")
                ?.scrollIntoView({ block: "center" }),
            );
            setBusy(false);
            request.current = null;
          }
          if (message.type === "result") {
            setScenarios((all) =>
              all.map((s) =>
                s.id === active.scenarioId
                  ? {
                      ...s,
                      snapshot: {
                        result: message.result,
                        fingerprint: active.fingerprint,
                        calculatedAt: new Date().toISOString(),
                      },
                    }
                  : s,
              ),
            );
            setBusy(false);
            request.current = null;
            requestAnimationFrame(() =>
              document
                .getElementById("qp-result")
                ?.scrollIntoView({ block: "start" }),
            );
          }
        };
        worker.current.onerror = () => {
          setError(
            "Вычислительный модуль остановился. Повторите расчёт или уменьшите число точек.",
          );
          setBusy(false);
          worker.current?.terminate();
          worker.current = null;
          request.current = null;
        };
      }
      worker.current.postMessage({
        id: job.id,
        config: structuredClone(calculation),
        coefficientFunctions,
      } satisfies CalculationRequest);
    } catch {
      setBusy(false);
      request.current = null;
      setError("Не удалось запустить расчёт. Обновите страницу и повторите.");
    }
  }
  const result = current?.snapshot?.result;
  const actual = !!current && isCurrent(current);

  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <header className="app-header">
        <div className="container header-inner">
          <button
            className="brand"
            onClick={() => navigate("models")}
            aria-label="Квадратичное программирование — модели"
          >
            <span className="brand-symbol">
              <Layers3 size={23} />
            </span>
            <span>Квадратичное программирование</span>
          </button>
          <nav aria-label="Основная навигация">
            <button
              className={`nav-button ${view === "models" ? "active" : ""}`}
              onClick={() => navigate("models")}
            >
              <FolderOpen size={17} />
              <span>Модели</span>
            </button>
            <a
              className="nav-button github-link"
              href="https://github.com/Alu-Vidor/param_game_2"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
              <ArrowUpRight size={15} />
            </a>
          </nav>
        </div>
      </header>
      <main id="main" className="container app-main">
        {storageError && (
          <div className="notice warning" role="alert">
            <p>{storageError}</p>
            {!canSave && (
              <div className="button-row">
                <button
                  className="button quiet"
                  onClick={() =>
                    download(
                      localStorage.getItem(STORAGE_KEY) || "",
                      "qp-storage-backup.json",
                      "application/json",
                    )
                  }
                >
                  Скачать резервную копию
                </button>
                <button
                  className="button quiet"
                  onClick={() => {
                    setCanSave(true);
                    setStorageError("");
                  }}
                >
                  Сохранить новое пространство
                </button>
              </div>
            )}
          </div>
        )}
        {error && (
          <div id="qp-calculation-error" className="notice error" role="alert">
            <strong>Не удалось завершить действие</strong>
            <p>{error}</p>
            <button
              className="icon-button"
              aria-label="Закрыть сообщение об ошибке"
              onClick={() => setError("")}
            >
              <X size={18} />
            </button>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <p>{notice}</p>
            <button
              className="icon-button"
              aria-label="Закрыть уведомление"
              onClick={() => setNotice("")}
            >
              <X size={18} />
            </button>
          </div>
        )}
        <input
          ref={importInput}
          className="visually-hidden"
          type="file"
          accept=".json,application/json"
          aria-label="Импорт модели JSON"
          tabIndex={-1}
          onChange={(e) => void importFile(e.target.files?.[0])}
        />
        {view === "models" ? (
          <>
            <div className="page-heading">
              <div>
                <h1 ref={title} tabIndex={-1}>
                  Задачи
                </h1>
                <p>Параметрические задачи квадратичного программирования.</p>
              </div>
              <div className="button-row">
                <button
                  className="button quiet"
                  onClick={() => importInput.current?.click()}
                >
                  <FileInput size={17} />
                  Импорт JSON
                </button>
                <button
                  className="button primary"
                  onClick={() => create("quadratic")}
                >
                  <Plus size={17} />
                  Новая задача
                </button>
              </div>
            </div>
            {scenarios.length ? (
              <section className="section library-section">
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Сохранённые модели"
                  tabIndex={0}
                >
                  <table className="data-table models-table">
                    <thead>
                      <tr>
                        <th scope="col">Название</th>
                        <th scope="col">Задача</th>
                        <th scope="col">Результат</th>
                        <th scope="col">Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((s) => (
                        <tr key={s.id}>
                          <th scope="row">
                            <button
                              className="model-name"
                              onClick={() => navigate("editor", s.id)}
                            >
                              {s.name}
                            </button>
                            <span className="table-secondary">
                              n = {formulaSize(s).n}, m = {formulaSize(s).m}
                            </span>
                          </th>
                          <td>
                            Вогнутая квадратичная задача
                            <span className="table-secondary">
                              {s.parameter}: {number(s.config.tStart)} до{" "}
                              {number(s.config.tEnd)}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`status ${isCurrent(s) ? "ready" : ""}`}
                            >
                              {isCurrent(s) ? (
                                <Check size={14} />
                              ) : (
                                <Square size={12} />
                              )}{" "}
                              {isCurrent(s)
                                ? "Рассчитана"
                                : s.snapshot
                                  ? "Условия изменены"
                                  : "Нужен расчёт"}
                            </span>
                          </td>
                          <td>
                            <div className="button-row">
                              <button
                                className="icon-button"
                                onClick={() => duplicate(s)}
                                aria-label={`Создать копию ${s.name}`}
                              >
                                <Copy size={17} />
                              </button>
                              <button
                                className="icon-button"
                                onClick={() => exportScenario(s)}
                                aria-label={`Экспортировать ${s.name}`}
                              >
                                <Download size={17} />
                              </button>
                              {deleteId === s.id ? (
                                <>
                                  <button
                                    className="button danger"
                                    onClick={() => {
                                      setScenarios((all) =>
                                        all.filter((x) => x.id !== s.id),
                                      );
                                      setDeleteId(undefined);
                                    }}
                                  >
                                    Удалить
                                  </button>
                                  <button
                                    className="button quiet"
                                    onClick={() => setDeleteId(undefined)}
                                  >
                                    Отмена
                                  </button>
                                </>
                              ) : (
                                <button
                                  className="icon-button"
                                  onClick={() => setDeleteId(s.id)}
                                  aria-label={`Удалить ${s.name}`}
                                >
                                  <Trash2 size={17} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : (
              <section className="empty-state">
                <FolderOpen size={32} />
                <h2>Здесь будут ваши модели</h2>
                <p>Создайте задачу или импортируйте сохранённый JSON.</p>
                <button
                  className="button primary"
                  onClick={() => create("quadratic")}
                >
                  Создать модель
                </button>
              </section>
            )}
            <div className="alternative-model">
              <div>
                <h2>Пример из ноутбука</h2>
                <p>Две переменные и пять строк K, плюс неотрицательность.</p>
              </div>
              <button
                className="button quiet"
                onClick={() => create("example")}
              >
                <Plus size={17} />
                Открыть пример
              </button>
            </div>
          </>
        ) : current ? (
          <>
            <div className="model-breadcrumb">
              <button onClick={() => navigate("models")}>
                <ArrowLeft size={15} />
                Все модели
              </button>
              <span>
                n = {size.n} · m = {size.m}
                {current.config.nonnegative !== false && " · x ≥ 0"}
              </span>
            </div>
            <div className="page-heading">
              <div>
                <div className="heading-with-status">
                  <h1 ref={title} tabIndex={-1}>
                    {current.name}
                  </h1>
                  {actual && (
                    <span className="status ready">
                      <CheckCheck size={15} />
                      Рассчитана
                    </span>
                  )}
                </div>
              </div>
              <div className="button-row">
                <button
                  className="button quiet icon-on-mobile"
                  onClick={() => duplicate(current)}
                  aria-label="Создать копию модели"
                >
                  <Copy size={17} />
                  <span>Копия</span>
                </button>
                <button
                  className="button quiet icon-on-mobile"
                  onClick={() => exportScenario(current)}
                  aria-label="Экспортировать модель JSON"
                >
                  <Download size={17} />
                  <span>Экспорт</span>
                </button>
              </div>
            </div>
            <div className="editor-layout">
              <Editor
                key={current.id}
                scenario={current}
                onChange={update}
                busy={busy}
                onRun={run}
              />
              <aside className="model-inspector">
                <h2>Ваша модель</h2>
                <dl>
                  <div>
                    <dt>Переменные n</dt>
                    <dd>{size.n}</dd>
                  </div>
                  <div>
                    <dt>Строки матрицы K</dt>
                    <dd>{size.m}</dd>
                  </div>
                  <div>
                    <dt>Границы xᵢ ≥ 0</dt>
                    <dd>{current.config.nonnegative === false ? 0 : size.n}</dd>
                  </div>
                  <div>
                    <dt>Всего неравенств</dt>
                    <dd>
                      {size.m +
                        (current.config.nonnegative === false ? 0 : size.n)}
                    </dd>
                  </div>
                  <div>
                    <dt>Диапазон параметра</dt>
                    <dd>
                      {number(current.config.tStart)} до{" "}
                      {number(current.config.tEnd)}
                    </dd>
                  </div>
                  <div>
                    <dt>Расчётные точки</dt>
                    <dd>
                      {current.config.sampling === "adaptive"
                        ? `до ${current.config.maxPoints}`
                        : current.config.points}
                    </dd>
                  </div>
                </dl>
              </aside>
            </div>
            <div className="workspace-navigation">
              <button
                className="button primary calculate-button"
                disabled={busy}
                type="submit"
                form="model-form"
              >
                {busy ? (
                  <LoaderCircle className="spinner" size={17} />
                ) : (
                  <Play size={16} />
                )}
                <span>
                  {busy
                    ? "Выполняется расчёт"
                    : actual
                      ? "Пересчитать"
                      : "Рассчитать"}
                </span>
              </button>
            </div>
            {busy && (
              <div className="calculation-progress" role="status">
                <div>
                  <LoaderCircle size={20} className="spinner" />
                  <span>{progress.stage}</span>
                  <button className="button quiet" onClick={cancel}>
                    <Square size={13} />
                    Остановить
                  </button>
                </div>
                <progress
                  max={1}
                  value={progress.progress}
                  aria-label="Ход расчёта"
                />
                <p>
                  Первый запуск загружает вычислительный модуль. Расчёт
                  выполняется на вашем устройстве.
                </p>
              </div>
            )}
            <section id="qp-result">
              {actual ? (
                <Results key={current.id} scenario={current} />
              ) : (
                <div className="empty-state">
                  <GitBranch size={32} />
                  <h2>{result ? "Исходные данные изменились" : "Результат"}</h2>
                  <p>
                    Нажмите «Рассчитать», чтобы получить оптимум в узлах сетки.
                  </p>
                </div>
              )}
            </section>
            <details className="section result-disclosure method-disclosure">
              <summary>Метод и диагностика</summary>
              <Method result={actual ? result : undefined} />
            </details>
          </>
        ) : (
          <section className="empty-state">
            <h1 ref={title} tabIndex={-1}>
              Создайте первую модель
            </h1>
            <button
              className="button primary"
              onClick={() => create("quadratic")}
            >
              Новая задача
            </button>
          </section>
        )}
        <footer className="app-footer">
          <span>Квадратичное программирование</span>
          <span>
            Данные сохраняются в этом браузере. Для переноса используйте JSON.
          </span>
          <button onClick={() => importInput.current?.click()}>
            Импорт модели
          </button>
        </footer>
      </main>
    </>
  );
}

function Method({ result: r }: { result?: CalculationResult }) {
  const d = r?.diagnostics;
  return (
    <div className="method-layout">
      <div>
        {d && (
          <section className="section">
            <div className="section-heading">
              <h2>Проверка текущего расчёта</h2>
              <p>
                Оценивайте точность приближения отдельно от численного оптимума.
              </p>
            </div>
            <dl className="diagnostic-list">
              <div>
                <dt>Условия оптимальности Куна и Таккера</dt>
                <dd>
                  {d.allKkt
                    ? "Выполнены во всех узлах"
                    : "Есть узлы, требующие проверки"}
                </dd>
              </div>
              <div>
                <dt>Максимальная ошибка переменных в узлах</dt>
                <dd>{scientific(d.maxXError)}</dd>
              </div>
              <div>
                <dt>Максимальная ошибка целевой функции в узлах</dt>
                <dd>{scientific(d.maxValueError)}</dd>
              </div>
              <div>
                <dt>Нарушение ограничений приближением в узлах</dt>
                <dd>{scientific(d.maxSampleViolation)}</dd>
              </div>
              <div>
                <dt>Нарушение ограничений на проверочной сетке</dt>
                <dd>{scientific(d.maxCurveViolation)}</dd>
              </div>
              <div>
                <dt>Знаменатели на всём интервале</dt>
                <dd>
                  {d.denominatorSafe
                    ? "Полюсов не найдено"
                    : "Обнаружен полюс или близкий к нулю знаменатель"}
                </dd>
              </div>
              <div>
                <dt>Подбор коэффициентов</dt>
                <dd>
                  {d.fitSuccess ? "Завершён" : "Завершён с предупреждением"}
                </dd>
              </div>
              <div>
                <dt>Расчётных точек</dt>
                <dd>{d.pointsUsed}</dd>
              </div>
            </dl>
            {d.warnings.map((w, i) => (
              <p key={i} className="notice warning">
                {w}
              </p>
            ))}
          </section>
        )}
        <section className="section">
          <h2>Задача оптимизации</h2>
          <p>
            Для каждого значения параметра <i>t</i> программа максимизирует
            функцию при линейных по x ограничениях. Границы x ≥ 0 можно включить
            отдельно.
          </p>
          <div className="equation">
            max f(x, t) = xᵀA(t)x + b(t)ᵀx + c(t)
            <br />
            <span>K(t)x ≤ l(t)</span>
          </div>
          <p>
            Коэффициенты A(t), b(t), c(t), K(t) и l(t) задаются как отношения
            многочленов.
          </p>
          <p>
            На каждом узле проверяется, что симметричная часть A(t) отрицательно
            полуопределённа. Условия Куна — Таккера проверяются с численным
            допуском. Теоретическая постановка предполагает ограниченность
            допустимого множества, а вогнутость на всём интервале отдельно не
            проверяется.
          </p>
        </section>
        <section className="section">
          <h2>Непрерывное приближение</h2>
          <p>
            Значения переменных приближаются дробно-рациональными функциями.
            Значение цели получается подстановкой приближения в исходную
            функцию.
          </p>
          <div className="equation">
            x̃ᵢ(t) = (a₀ + a₁t + … + aₚtᵖ) / (1 + d₁t + … + dqtq)
          </div>
          <p>
            Минимизируется взвешенная сумма квадратов ошибок вектора решения и
            целевой функции. Веса нормируются до суммы 1, ограничения
            проверяются при подборе в каждом узле.
          </p>
          <p className="notice">
            Ограничения при подборе проверяются в расчётных узлах.
            Дополнительная плотная сетка помогает обнаружить нарушения между
            ними, но не доказывает допустимость во всех точках интервала.
          </p>
        </section>
        <section className="section">
          <h2>Автоматический выбор числа точек</h2>
          <p>
            Программа увеличивает выборку и сравнивает коэффициенты двух
            последовательных приближений. Критерий остановки: максимальное
            изменение коэффициента меньше ε.
          </p>
          <p>
            Стабильность коэффициентов сама по себе не гарантирует точность
            приближения. Если предел числа точек достигнут раньше критерия,
            результат отмечается как несошедшийся.
          </p>
          {r && r.convergence.length > 1 && (
            <>
              <p className="convergence-status">
                {d?.converged
                  ? "Критерий стабильности достигнут."
                  : "Критерий стабильности не достигнут."}
              </p>
              <div
                className="table-scroll"
                role="region"
                aria-label="История подбора числа точек"
                tabIndex={0}
              >
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Точек</th>
                      <th scope="col">Изменение коэффициентов</th>
                      <th scope="col">Критерий ошибки</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.convergence.map((row) => (
                      <tr key={row.points}>
                        <th scope="row">{row.points}</th>
                        <td>
                          {row.coefficientChange === null
                            ? "Первая выборка"
                            : scientific(row.coefficientChange)}
                        </td>
                        <td>{scientific(row.loss)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
      <aside className="method-aside">
        <h2>Как читать результат</h2>
        <ol>
          <li>
            <strong>Численное решение</strong>
            <p>Оптимальный вектор для выбранного узла параметра.</p>
          </li>
          <li>
            <strong>Приближение</strong>
            <p>
              Удобная непрерывная формула. Сверяйте её ошибки и допустимость.
            </p>
          </li>
          <li>
            <strong>Ограничения</strong>
            <p>Нулевой остаток означает, что ограничение активно.</p>
          </li>
        </ol>
        <a
          href="https://github.com/Alu-Vidor/param_game_2/blob/main/docs/math.md"
          target="_blank"
          rel="noreferrer"
        >
          Формулы и проверка реализации
          <ArrowUpRight size={15} />
        </a>
      </aside>
    </div>
  );
}
