import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  CheckCheck,
  CircleHelp,
  Copy,
  Download,
  FileInput,
  FlaskConical,
  FolderOpen,
  GitBranch,
  Layers3,
  LoaderCircle,
  Play,
  Plus,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type {
  CalculationMessage,
  CalculationRequest,
  CalculationResult,
  ProblemKind,
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

type View = "models" | "editor" | "results" | "method";
type Detail = "charts" | "table" | "formulas";
function route() {
  const q = new URLSearchParams(location.search);
  return {
    view: (["models", "editor", "results", "method"].includes(
      q.get("view") || "",
    )
      ? q.get("view")
      : "editor") as View,
    id: q.get("model"),
    detail: (["charts", "table", "formulas"].includes(q.get("detail") || "")
      ? q.get("detail")
      : "charts") as Detail,
  };
}
function formulaSize(s: Scenario) {
  return s.config.kind === "production"
    ? {
        n: s.config.production.M.length,
        m: s.config.production.resourceLimits.length,
      }
    : { n: s.config.quadratic.A.length, m: s.config.quadratic.K.length };
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

  function navigate(
    nextView: View,
    id = current?.id,
    detail = locationState.detail,
  ) {
    const q = new URLSearchParams({ view: nextView });
    if (id) q.set("model", id);
    if (nextView === "results") q.set("detail", detail);
    history.pushState(null, "", `${location.pathname}?${q}`);
    setLocationState({ view: nextView, id: id || null, detail });
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
  function create(kind: ProblemKind) {
    if (!hasSpace()) return;
    const next = createScenario(kind);
    setScenarios((all) => [next, ...all]);
    navigate("editor", next.id);
    setNotice("Добавлен исходный пример. Измените данные под свою задачу.");
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
    setBusy(true);
    setProgress({ stage: "Подготавливаем расчёт", progress: 0 });
    const job = {
      id: crypto.randomUUID(),
      scenarioId: current.id,
      fingerprint: fingerprint(current),
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
            navigate("results", active.scenarioId, "charts");
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
        config: structuredClone(current.config),
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
            aria-label="План — модели"
          >
            <span className="brand-symbol">
              <Layers3 size={23} />
            </span>
            <span>План</span>
            <span className="brand-description">Оптимизация решений</span>
          </button>
          <nav aria-label="Основная навигация">
            <button
              className={`nav-button ${view === "models" ? "active" : ""}`}
              onClick={() => navigate("models")}
            >
              <FolderOpen size={17} />
              <span>Модели</span>
            </button>
            <button
              className={`nav-button ${view === "method" ? "active" : ""}`}
              onClick={() => navigate("method")}
            >
              <CircleHelp size={17} />
              <span>О методе</span>
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
                      "planning-storage-backup.json",
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
          <div className="notice error" role="alert">
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
                  Модели и сценарии
                </h1>
                <p>
                  Меняйте условия и находите план для каждого значения
                  параметра.
                </p>
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
                  onClick={() => create("production")}
                >
                  <Plus size={17} />
                  Производственная модель
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
                              onClick={() =>
                                navigate(
                                  isCurrent(s) ? "results" : "editor",
                                  s.id,
                                )
                              }
                            >
                              {s.name}
                            </button>
                            <span className="table-secondary">
                              {formulaSize(s).n} переменных, {formulaSize(s).m}{" "}
                              {s.config.kind === "production"
                                ? "ресурсов"
                                : "ограничений"}
                            </span>
                          </th>
                          <td>
                            {s.config.kind === "production"
                              ? "Производственный план"
                              : "Квадратичная модель"}
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
                <p>
                  Начните с производственного примера или импортируйте
                  сохранённый JSON.
                </p>
                <button
                  className="button primary"
                  onClick={() => create("production")}
                >
                  Создать модель
                </button>
              </section>
            )}
            <div className="alternative-model">
              <div>
                <h2>Уже есть матрицы задачи?</h2>
                <p>
                  Задайте квадратичную функцию и линейные ограничения напрямую.
                </p>
              </div>
              <button
                className="button quiet"
                onClick={() => create("quadratic")}
              >
                <Plus size={17} />
                Общая модель
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
                {current.config.kind === "production"
                  ? "Производственная модель"
                  : "Квадратичная модель"}
              </span>
            </div>
            <div className="page-heading">
              <div>
                <div className="heading-with-status">
                  <h1 ref={title} tabIndex={-1}>
                    {view === "method" ? "Метод и точность" : current.name}
                  </h1>
                  {actual && (
                    <span className="status ready">
                      <CheckCheck size={15} />
                      Рассчитана
                    </span>
                  )}
                </div>
                <p>
                  {view === "method"
                    ? "Что оптимизирует программа и как проверить результат."
                    : current.config.kind === "production"
                      ? "Найдите объёмы выпуска, которые дают наибольшую прибыль."
                      : "Найдите максимум квадратичной функции при заданных ограничениях."}
                </p>
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
            <div className="workspace-navigation">
              <nav aria-label="Разделы модели">
                {(
                  [
                    ["editor", "Исходные данные", SlidersHorizontal],
                    ["results", "План и динамика", GitBranch],
                    ["method", "Метод и точность", FlaskConical],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    className={view === key ? "active" : ""}
                    aria-current={view === key ? "page" : undefined}
                    onClick={() => navigate(key)}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                ))}
              </nav>
              <button
                className="button primary calculate-button"
                disabled={busy}
                onClick={run}
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
                      : "Рассчитать план"}
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
            {view === "editor" && (
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
                      <dt>
                        {current.config.kind === "production"
                          ? "Продукты"
                          : "Переменные"}
                      </dt>
                      <dd>{size.n}</dd>
                    </div>
                    <div>
                      <dt>
                        {current.config.kind === "production"
                          ? "Ресурсы"
                          : "Ограничения"}
                      </dt>
                      <dd>{size.m}</dd>
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
                  <div className="inspector-explanation">
                    <h3>От данных к плану</h3>
                    <p>
                      Программа найдёт оптимальные значения в узлах диапазона и
                      построит непрерывное приближение между ними.
                    </p>
                    <p>
                      Параметр <i>t</i> меняет цены, затраты или ограничения по
                      заданным коэффициентам.
                    </p>
                  </div>
                  <div className="source-note">
                    <Check size={16} />
                    <span>
                      Настройте данные под свою задачу. Для проверки других
                      условий создайте копию модели.
                    </span>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => navigate("method")}
                  >
                    Разобраться в методе
                    <ArrowUpRight size={15} />
                  </button>
                </aside>
              </div>
            )}
            {view === "results" &&
              (actual ? (
                <Results
                  scenario={current}
                  detail={locationState.detail}
                  onDetailChange={(d) => navigate("results", current.id, d)}
                />
              ) : (
                <section className="empty-state">
                  <GitBranch size={36} />
                  <h2>
                    {result
                      ? "Обновите расчёт после изменения данных"
                      : "План появится после расчёта"}
                  </h2>
                  <p>
                    Задайте исходные данные и нажмите «Рассчитать план». Здесь
                    появятся решение, загрузка ресурсов и динамика по параметру.
                  </p>
                  <button
                    className="button quiet"
                    onClick={() => navigate("editor")}
                  >
                    Проверить исходные данные
                  </button>
                </section>
              ))}
            {view === "method" && (
              <Method result={actual ? result : undefined} scenario={current} />
            )}
          </>
        ) : (
          <section className="empty-state">
            <h1 ref={title} tabIndex={-1}>
              Создайте первую модель
            </h1>
            <button
              className="button primary"
              onClick={() => create("production")}
            >
              Производственная модель
            </button>
          </section>
        )}
        <footer className="app-footer">
          <span>План</span>
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

function Method({
  result: r,
  scenario: s,
}: {
  result?: CalculationResult;
  scenario: Scenario;
}) {
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
            функцию при линейных ограничениях и неотрицательных переменных.
          </p>
          <div className="equation">
            max f(x, t) = xᵀAx + b(t)ᵀx + c(t)
            <br />
            <span>Kx ≤ l(t), x ≥ 0</span>
          </div>
          <p>
            Матрицы A и K постоянны. Векторы b(t), l(t) и свободный член c(t)
            заданы линейно по параметру. Проверка вогнутости функции позволяет
            трактовать найденный оптимум как глобальный с учётом численных
            допусков.
          </p>
          {s.config.kind === "production" && (
            <details>
              <summary>
                Как производственные данные превращаются в задачу
              </summary>
              <div className="equation">
                A = −M + RᵀHR
                <br />
                b(t) = p(t) − k − Rᵀr(t)
                <br />
                c(t) = v(t)
                <br />K = [R; I; −I]
                <br />
                l(t) = [лимиты ресурсов; мощности(t); 0]
              </div>
              <p>
                Цена и мощность каждого продукта, стоимость каждого ресурса и
                свободный член задаются как начальное значение плюс изменение на
                единицу t.
              </p>
            </details>
          )}
        </section>
        <section className="section">
          <h2>Непрерывное приближение</h2>
          <p>
            Значения переменных приближаются дробно-рациональными функциями.
            Значение цели получается подстановкой приближённого плана в исходную
            функцию.
          </p>
          <div className="equation">
            x̃ᵢ(t) = (a₀ + a₁t + … + aₚtᵖ) / (1 + d₁t + … + dqtq)
          </div>
          <p>
            По умолчанию минимизируется сумма квадратов ошибок по переменным,
            как в ноутбуке. В расширенных настройках доступен взвешенный
            критерий из теории с дополнительной ошибкой по целевой функции.
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
            плана. Если предел числа точек достигнут раньше критерия, результат
            отмечается как несошедшийся.
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
            <p>Оптимальный план для выбранного узла параметра.</p>
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
