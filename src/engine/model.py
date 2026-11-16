"""Parametric concave quadratic programming and rational approximation.

The objective and constraints follow the supplied notebook. Numerical adapters
fix its stationary-point, gradient and convergence-reporting errors; see
docs/math.md. No user text is executed as Python.
"""

import json
import time
import warnings

import numpy as np
from scipy.optimize import linprog, minimize, nnls


class CalculationTimeout(Exception):
    pass


def _finite(value, name):
    if isinstance(value, (bool, str)):
        raise ValueError(f"{name}: введите конечное число.")
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{name}: введите конечное число.") from None
    if not np.isfinite(result):
        raise ValueError(f"{name}: введите конечное число.")
    if abs(result) > 1e12:
        raise ValueError(f"{name}: модуль значения не должен превышать 10¹².")
    return result


def _integer(value, name, minimum, maximum):
    result = _finite(value, name)
    if not result.is_integer() or not minimum <= result <= maximum:
        raise ValueError(f"{name}: допустимо целое число от {minimum} до {maximum}.")
    return int(result)


def _array(value, name, shape=None):
    try:
        result = np.asarray(value, dtype=float)
    except (TypeError, ValueError, OverflowError):
        raise ValueError(f"{name}: проверьте размерность и числовые коэффициенты.") from None
    if shape is not None and result.shape != tuple(shape):
        raise ValueError(f"{name}: ожидается размерность {' × '.join(map(str, shape))}.")
    if not np.all(np.isfinite(result)):
        raise ValueError(f"{name}: все коэффициенты должны быть конечными числами.")
    if result.size and np.max(np.abs(result)) > 1e12:
        raise ValueError(f"{name}: модуль коэффициентов не должен превышать 10¹².")
    return result


def canonical_problem(config):
    """Return the supplied problem as A,b0,b1,c0,c1,K,l0,l1 arrays."""
    kind = config.get("kind")
    if kind == "quadratic":
        data = config.get("quadratic", {})
        A = _array(data.get("A"), "Матрица A")
        if A.ndim != 2 or A.shape[0] != A.shape[1] or not 1 <= A.shape[0] <= 6:
            raise ValueError("Матрица A должна быть квадратной: от 1 до 6 переменных.")
        n = A.shape[0]
        K = _array(data.get("K"), "Матрица K")
        if K.ndim != 2 or K.shape[1] != n or not 1 <= K.shape[0] <= 15:
            raise ValueError("Матрица K: от 1 до 15 ограничений, по коэффициенту на переменную.")
        m = K.shape[0]
        problem = {
            "A": A, "K": K,
            "b0": _array(data.get("b0"), "Вектор b₀", (n,)),
            "b1": _array(data.get("b1"), "Вектор b₁", (n,)),
            "c0": _finite(data.get("c0"), "Коэффициент c₀"),
            "c1": _finite(data.get("c1"), "Коэффициент c₁"),
            "l0": _array(data.get("l0"), "Вектор l₀", (m,)),
            "l1": _array(data.get("l1"), "Вектор l₁", (m,)),
        }
    elif kind == "production":
        data = config.get("production", {})
        R = _array(data.get("R"), "Матрица расхода ресурсов R")
        if R.ndim != 2 or not 1 <= R.shape[0] <= 15 or not 1 <= R.shape[1] <= 6:
            raise ValueError("Матрица R: от 1 до 15 ресурсов и от 1 до 6 продуктов.")
        m, n = R.shape
        M = _array(data.get("M"), "Матрица M", (n, n))
        H = _array(data.get("H"), "Матрица H", (m, m))
        k = _array(data.get("k"), "Постоянные затраты k", (n,))
        p0 = _array(data.get("p0"), "Цена p₀", (n,))
        p1 = _array(data.get("p1"), "Цена p₁", (n,))
        r0 = _array(data.get("r0"), "Стоимость ресурса r₀", (m,))
        r1 = _array(data.get("r1"), "Стоимость ресурса r₁", (m,))
        problem = {
            "A": -M + R.T @ H @ R,
            "b0": p0 - k - R.T @ r0,
            "b1": p1 - R.T @ r1,
            "c0": _finite(data.get("v0"), "Свободный член v₀"),
            "c1": _finite(data.get("v1"), "Свободный член v₁"),
            "K": np.vstack((R, np.eye(n), -np.eye(n))),
            "l0": np.concatenate((
                _array(data.get("resourceLimits"), "Запас ресурсов", (m,)),
                _array(data.get("capacity0"), "Мощность x̄₀", (n,)),
                np.zeros(n),
            )),
            "l1": np.concatenate((
                np.zeros(m),
                _array(data.get("capacity1"), "Мощность x̄₁", (n,)),
                np.zeros(n),
            )),
        }
    else:
        raise ValueError("Выберите производственную или общую квадратичную модель.")
    # The skew-symmetric part contributes exactly zero to x.T @ A @ x.
    problem["A"] = (problem["A"] + problem["A"].T) / 2
    for name, value in problem.items():
        if not np.all(np.isfinite(value)):
            raise ValueError(f"{name}: коэффициенты модели привели к переполнению.")
    eigenvalues = np.linalg.eigvalsh(problem["A"])
    max_eigenvalue = float(eigenvalues[-1])
    # A large negative eigenvalue must never mask a resolved positive one.
    # Reject positive values conservatively, including numerically ambiguous
    # matrices, rather than advertise a global maximum of a nonconcave form.
    if max_eigenvalue > 0:
        raise ValueError("Целевая функция не вогнута: симметричная часть A имеет положительное собственное значение. Для этой модели глобальный максимум методом из приложения не подтверждается.")
    return problem, max_eigenvalue


def _settings(config):
    start = _finite(config.get("tStart"), "Начало диапазона")
    end = _finite(config.get("tEnd"), "Конец диапазона")
    if start >= end or max(abs(start), abs(end)) > 1e9:
        raise ValueError("Начало диапазона должно быть меньше конца; модуль t — не более 10⁹.")
    points = _integer(config.get("points"), "Число точек", 2, 501)
    p = _integer(config.get("degreeNumerator"), "Степень числителя", 0, 4)
    q = _integer(config.get("degreeDenominator"), "Степень знаменателя", 0, 4)
    sampling = config.get("sampling")
    if sampling not in ("fixed", "adaptive"):
        raise ValueError("Выберите фиксированную сетку или подбор числа точек.")
    maximum = _integer(config.get("maxPoints"), "Максимум точек", 2, 501)
    step = _integer(config.get("pointStep"), "Прибавление точек", 1, 499)
    tolerance = _finite(config.get("coefficientTolerance"), "Точность коэффициентов")
    if tolerance <= 0:
        raise ValueError("Точность коэффициентов должна быть положительной.")
    wx = _finite(config.get("weightX"), "Вес ошибки плана")
    wf = _finite(config.get("weightValue"), "Вес ошибки целевой функции")
    if min(wx, wf) < 0 or max(wx, wf) <= 0:
        raise ValueError("Веса неотрицательны; хотя бы один вес должен быть положительным.")
    if not isinstance(config.get("enforceFeasibility"), bool):
        raise ValueError("Укажите, учитывать ли ограничения при аппроксимации.")
    if sampling == "adaptive" and maximum <= points:
        raise ValueError("Для подбора максимум точек должен быть больше начального числа.")
    counts = [points]
    if sampling == "adaptive":
        counts = list(range(points, maximum + 1, step))
        if counts[-1] != maximum:
            counts.append(maximum)
    return start, end, counts, p, q, tolerance, wx, wf


def _value(problem, x, t):
    return float(x @ problem["A"] @ x + (problem["b0"] + t * problem["b1"]) @ x + problem["c0"] + t * problem["c1"])


def _primal_tolerance(left, right, relative=1e-9, absolute=1e-9):
    """Each inequality keeps its own scale; unrelated rows cannot relax it."""
    return absolute + relative * np.maximum(np.abs(left), np.abs(right))


def _is_feasible(problem, x, t):
    left = np.concatenate((problem["K"] @ x, -x))
    right = np.concatenate((problem["l0"] + t * problem["l1"], np.zeros(len(x))))
    return bool(np.all(left - right <= _primal_tolerance(left, right)))


def _scaled_inequalities(problem, t):
    K = problem["K"]
    row_scale = np.max(np.abs(K), axis=1)
    row_scale = np.where(row_scale > 0, row_scale, 1.0)
    return K / row_scale[:, None], (problem["l0"] + t * problem["l1"]) / row_scale


def kkt_diagnostics(problem, x, t):
    """KKT certificate for Kx <= l and every x >= 0 bound."""
    n = len(x)
    l = problem["l0"] + t * problem["l1"]
    C = np.vstack((problem["K"], -np.eye(n)))
    right = np.concatenate((l, np.zeros(n)))
    left = C @ x
    slack = right - left
    b = problem["b0"] + t * problem["b1"]
    gradient = 2 * problem["A"] @ x + b
    primal_tolerance = _primal_tolerance(left, right)
    row_scale = np.max(np.abs(C), axis=1)
    active = (np.abs(slack) <= 10 * primal_tolerance) & (row_scale > 0)
    multiplier = np.zeros(len(right))
    if np.any(active):
        try:
            # Normalize the NNLS system and its RHS independently. Tiny
            # objective coefficients are meaningful, not an absolute zero.
            gradient_scale = float(np.max(np.abs(gradient)))
            if gradient_scale > 0:
                normal = C[active] / row_scale[active, None]
                multiplier[active] = nnls(normal.T, gradient / gradient_scale, maxiter=1000)[0] * gradient_scale / row_scale[active]
        except (RuntimeError, ValueError):
            # No certificate is a failed check, never an assertion of success.
            pass
    stationarity_residual = np.abs(gradient - C.T @ multiplier)
    stationarity = float(np.max(stationarity_residual))
    # Roundoff is tied to the terms in each component of the derivative,
    # without a floor of 1 or a global maximum across unrelated variables.
    derivative_terms = 2 * np.abs(problem["A"]) @ np.abs(x) + np.abs(b)
    stationarity_tolerance = 1e-8 * np.abs(gradient) + 64 * np.finfo(float).eps * derivative_terms
    complementarity = np.abs(multiplier * slack)
    violation = max(0.0, float(np.max(-slack)))
    ok = (np.all(-slack <= primal_tolerance)
          and np.all(stationarity_residual <= stationarity_tolerance)
          and np.all(complementarity <= 1e-8 * (1 + np.abs(multiplier))))
    return {
        "slack": (l - problem["K"] @ x).tolist(),
        "maxViolation": violation, "stationarity": stationarity, "kkt": bool(ok),
    }


def solve_qp(problem, t, previous=None):
    A, K = problem["A"], problem["K"]
    b = problem["b0"] + t * problem["b1"]
    l = problem["l0"] + t * problem["l1"]
    n = len(b)
    normal_K, normal_l = _scaled_inequalities(problem, t)
    eigenvalues = np.linalg.eigvalsh(A)
    needs_gap_check = eigenvalues[-1] >= -1e-10 * max(float(np.max(np.abs(eigenvalues))), np.finfo(float).tiny)

    def certified(x, check):
        if not check["kkt"]:
            return False
        if not needs_gap_check:
            return True
        # On semidefinite or severely ill-conditioned forms, a small residual
        # can hide a large objective gap in a flat direction. The supporting
        # hyperplane of a concave function supplies an independent upper bound.
        gradient = 2 * A @ x + b
        gradient_scale = float(np.max(np.abs(gradient)))
        if gradient_scale == 0:
            return True
        oracle = linprog(-gradient / gradient_scale, A_ub=normal_K, b_ub=normal_l,
                         bounds=[(0, None)] * n, method="highs")
        if not oracle.success:
            return False
        gap = float(gradient @ (oracle.x - x))
        variation = max(1.0, abs(float(x @ A @ x)), abs(float(b @ x)))
        return bool(gap <= 1e-8 * variation)

    if not np.any(A):
        objective_scale = max(float(np.max(np.abs(b))), np.finfo(float).tiny)
        linear = linprog(-b / objective_scale, A_ub=normal_K, b_ub=normal_l,
                         bounds=[(0, None)] * n, method="highs")
        if not linear.success:
            detail = "целевая функция не ограничена сверху" if linear.status == 3 else "ограничения несовместны"
            raise ValueError(f"При t={t:.8g} {detail}; допустимый оптимальный план не найден.")
        x = np.maximum(linear.x, 0)
        check = kkt_diagnostics(problem, x, t)
        if certified(x, check):
            return x, _value(problem, x, t), check
        raise ValueError(f"При t={t:.8g} решение не подтверждено: измените масштаб коэффициентов.")
    # A feasible stationary point is a global maximizer of a concave function.
    try:
        stationary = np.linalg.solve(2 * A, -b)
    except np.linalg.LinAlgError:
        stationary = np.linalg.lstsq(2 * A, -b, rcond=None)[0]
    stationary_check = kkt_diagnostics(problem, stationary, t)
    if certified(stationary, stationary_check):
        x = np.maximum(stationary, 0)
        return x, _value(problem, x, t), kkt_diagnostics(problem, x, t)

    def feasible(x):
        return _is_feasible(problem, x, t)

    starts = []
    if previous is not None and feasible(previous):
        starts.append(np.maximum(previous, 0))
    if feasible(np.zeros(n)):
        starts.append(np.zeros(n))
    else:
        lp = linprog(np.zeros(n), A_ub=normal_K, b_ub=normal_l, bounds=[(0, None)] * n, method="highs")
        if not lp.success:
            raise ValueError(f"При t={t:.8g} ограничения несовместны: допустимый план не найден.")
        starts.append(lp.x)
    starts.append(np.maximum(stationary, 0))
    objective_scale = max(float(np.max(np.abs(A))), float(np.max(np.abs(b))), np.finfo(float).tiny)
    for initial in starts[:3]:
        result = minimize(
            lambda x: -(x @ A @ x + b @ x) / objective_scale, initial,
            jac=lambda x: -(2 * A @ x + b) / objective_scale,
            constraints={"type": "ineq", "fun": lambda x: normal_l - normal_K @ x, "jac": lambda x: -normal_K},
            bounds=[(0, None)] * n, method="SLSQP",
            options={"maxiter": 1000, "ftol": 1e-11},
        )
        if not np.all(np.isfinite(result.x)):
            continue
        x = np.maximum(result.x, 0)
        check = kkt_diagnostics(problem, x, t)
        value = _value(problem, x, t)
        if certified(x, check):
            return x, value, check
    raise ValueError(f"При t={t:.8g} не удалось подтвердить решение. Проверьте ограничения, ограниченность задачи и масштаб коэффициентов.")


def denominator_roots(fits, start, end):
    roots = []
    argument_scale = max(1.0, abs(start), abs(end))
    for fit in fits:
        den = np.asarray(fit["denominator"], dtype=float)
        while len(den) > 1 and den[-1] == 0:
            den = den[:-1]
        den = den * argument_scale**np.arange(len(den))
        if len(den) > 1:
            for root in np.polynomial.polynomial.polyroots(den):
                root *= argument_scale
                if abs(root.imag) <= 1e-7 * (1 + abs(root.real)) and start - 1e-10 <= root.real <= end + 1e-10:
                    roots.append(float(np.clip(root.real, start, end)))
        # Repeated real roots can split into a complex cluster in float
        # arithmetic. Check extrema of the denominator as well as its roots.
        candidates = [start / argument_scale, end / argument_scale]
        if len(den) > 2:
            derivative = np.arange(1, len(den)) * den[1:]
            for critical in np.polynomial.polynomial.polyroots(derivative):
                if abs(critical.imag) <= 1e-7 * (1 + abs(critical.real)):
                    candidates.append(float(critical.real))
        for candidate in candidates:
            t = candidate * argument_scale
            if start - 1e-10 <= t <= end + 1e-10:
                value = np.polynomial.polynomial.polyval(candidate, den)
                magnitude = np.polynomial.polynomial.polyval(abs(candidate), np.abs(den))
                if abs(value) <= 1e-10 * max(1.0, magnitude):
                    roots.append(float(np.clip(t, start, end)))
    return sorted(set(roots))


def evaluate_fits(fits, t):
    values = []
    for fit in fits:
        num = np.asarray(fit["numerator"], dtype=float)
        den = np.asarray(fit["denominator"], dtype=float)
        numerator = np.polynomial.polynomial.polyval(t, num)
        denominator = np.polynomial.polynomial.polyval(t, den)
        scale = np.polynomial.polynomial.polyval(abs(t), np.abs(den))
        if not np.isfinite(denominator) or abs(denominator) <= 1e-10 * max(1.0, scale):
            return None
        value = numerator / denominator
        if not np.isfinite(value) or abs(value) > 1e100:
            return None
        values.append(float(value))
    return np.asarray(values)


def fit_rational(problem, ts, exact, values, p, q, enforce, wx, wf, deadline):
    """Fit the notebook's rational family with an analytic Jacobian.

    u=t/scale only conditions the coefficient search. Returned coefficients are
    in powers of t, with denominator constant exactly one.
    """
    n = exact.shape[1]
    count = p + 1 + q
    scale = max(1.0, float(np.max(np.abs(ts))))
    u = ts / scale
    numerator_basis = np.vander(u, p + 1, increasing=True)
    denominator_basis = np.vander(u, q + 1, increasing=True)[:, 1:]
    bt = problem["b0"][None, :] + ts[:, None] * problem["b1"][None, :]
    ct = problem["c0"] + ts * problem["c1"]
    C = np.vstack((problem["K"], -np.eye(n)))
    right = np.column_stack((problem["l0"][None, :] + ts[:, None] * problem["l1"][None, :], np.zeros((len(ts), n))))
    loss_scale = max(1.0, wx * float(np.sum(exact**2)) + wf * float(np.sum(values**2)))

    def calculate(D, jacobian=False, check_time=True):
        if check_time and time.perf_counter() > deadline:
            raise CalculationTimeout()
        D = np.asarray(D).reshape(n, count)
        num = numerator_basis @ D[:, :p + 1].T
        den = 1 + denominator_basis @ D[:, p + 1:].T
        # A pole is outside the domain of the rational objective. Guard the
        # optimizer against division overflow; final evaluation never clamps.
        safe_den = np.where(np.abs(den) < 1e-12, np.where(den < 0, -1e-12, 1e-12), den)
        prediction = num / safe_den
        if not jacobian:
            return prediction
        J = np.zeros((len(ts), n, n * count))
        for component in range(n):
            start = component * count
            J[:, component, start:start + p + 1] = numerator_basis / safe_den[:, component, None]
            if q:
                J[:, component, start + p + 1:start + count] = -num[:, component, None] * denominator_basis / safe_den[:, component, None]**2
        return prediction, J

    def loss_and_gradient(D, check_time=True):
        x, J = calculate(D, True, check_time)
        error_x = x - exact
        approx_value = np.einsum("ti,ij,tj->t", x, problem["A"], x) + np.sum(bt * x, axis=1) + ct
        error_f = approx_value - values
        loss = wx * np.sum(error_x**2) + wf * np.sum(error_f**2)
        direction = wx * error_x + wf * error_f[:, None] * (2 * x @ problem["A"] + bt)
        gradient = 2 * np.einsum("ti,tij->j", direction, J)
        return float(loss / loss_scale), gradient / loss_scale

    def constraint(D):
        return (right - calculate(D) @ C.T).ravel()

    def fit_feasible(D):
        left = calculate(D) @ C.T
        return bool(np.all(left - right <= _primal_tolerance(left, right)))

    def constraint_jacobian(D):
        _, J = calculate(D, True)
        return -np.einsum("mi,tij->tmj", C, J).reshape(-1, n * count)

    initial = np.zeros((n, count))
    # np.linalg.lstsq returns ascending coefficients because the basis is so.
    initial[:, :p + 1] = np.linalg.lstsq(numerator_basis, exact, rcond=None)[0].T
    starts = [initial.ravel()]
    # Include a denominator-free seed and deterministic rational alternatives.
    for attempt in range(1, 5 if enforce else 6):
        rng = np.random.default_rng(attempt)
        seed = initial.copy()
        if q:
            seed[:, p + 1:] = rng.uniform(-0.1, 0.1, (n, q))
        seed[:, :p + 1] += rng.normal(0, 0.05, (n, p + 1))
        starts.append(seed.ravel())
    best = None
    timed_out = False
    for initial_D in starts:
        try:
            first_loss = loss_and_gradient(initial_D)[0] * loss_scale
            feasible_initial = not enforce or fit_feasible(initial_D)
            if feasible_initial and first_loss <= 1e-14 * max(1.0, float(np.sum(exact**2))):
                best = (first_loss, initial_D.copy(), True)
                break
            if enforce:
                result = minimize(
                    loss_and_gradient, initial_D, jac=True, method="SLSQP",
                    constraints={"type": "ineq", "fun": constraint, "jac": constraint_jacobian},
                    options={"maxiter": 1500, "ftol": 1e-13},
                )
            else:
                result = minimize(loss_and_gradient, initial_D, jac=True, method="BFGS", options={"maxiter": 1500, "gtol": 1e-9})
            raw_loss = float(result.fun * loss_scale)
            good = bool(np.all(np.isfinite(result.x)) and np.isfinite(raw_loss))
            if enforce and good:
                good = fit_feasible(result.x)
            if good and (best is None or (result.success and not best[2]) or (bool(result.success) == best[2] and raw_loss < best[0])):
                best = (raw_loss, result.x.copy(), bool(result.success))
            if best is not None and best[0] <= 1e-14 * max(1.0, float(np.sum(exact**2))):
                break
        except CalculationTimeout:
            timed_out = True
            break
    if best is None:
        # Keep an explicit failed fit, never present an arbitrary initialization
        # as a converged formula. QP results remain useful independently.
        fallback_loss = float(loss_and_gradient(starts[0], False)[0] * loss_scale)
        if not np.isfinite(fallback_loss):
            raise ValueError("Коэффициенты приводят к переполнению при подборе формулы. Уменьшите масштаб данных.")
        best = (fallback_loss, starts[0], False)
    raw_loss, D, success = best
    D = D.reshape(n, count)
    fits = []
    for component in range(n):
        fits.append({
            "numerator": (D[component, :p + 1] / scale**np.arange(p + 1)).tolist(),
            "denominator": np.concatenate(([1.0], D[component, p + 1:] / scale**np.arange(1, q + 1))).tolist(),
        })
    return fits, float(raw_loss), bool(success), timed_out


def _coefficient_vector(fits):
    return np.asarray([v for fit in fits for v in fit["numerator"] + fit["denominator"][1:]])


def run_calculation(config, report_progress=None):
    start_time = time.perf_counter()
    deadline = start_time + 55
    if not isinstance(config, dict):
        raise ValueError("Не удалось прочитать параметры модели.")
    problem, max_eigenvalue = canonical_problem(config)
    start, end, counts, p, q, tolerance, wx, wf = _settings(config)
    messages = []
    convergence = []
    previous_coefficients = None
    previous_fit_success = False
    final = None
    converged = None if config["sampling"] == "fixed" else False

    def progress(stage, fraction):
        if report_progress:
            report_progress(stage, float(np.clip(fraction, 0, 1)))

    for iteration, point_count in enumerate(counts):
        ts = np.linspace(start, end, point_count)
        samples, xs, values = [], [], []
        previous = None
        try:
            for i, t in enumerate(ts):
                if time.perf_counter() > deadline:
                    raise CalculationTimeout()
                x, value, check = solve_qp(problem, float(t), previous)
                samples.append({"t": float(t), "x": x.tolist(), "value": value, **check, "xApprox": None, "valueApprox": None})
                xs.append(x)
                values.append(value)
                previous = x
                if i == 0 or i == point_count - 1 or i % max(1, point_count // 20) == 0:
                    progress(f"Решаем квадратичную задачу: {i + 1} из {point_count}", .18 + .7 * (iteration + .55 * (i + 1) / point_count) / len(counts))
            progress(f"Подбираем рациональные функции: {point_count} точек", .18 + .7 * (iteration + .6) / len(counts))
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                fits, loss, fit_success, timed_out = fit_rational(problem, ts, np.asarray(xs), np.asarray(values), p, q, config["enforceFeasibility"], wx, wf, deadline)
            coefficients = _coefficient_vector(fits)
            change = None if previous_coefficients is None else float(np.max(np.abs(coefficients - previous_coefficients)))
            convergence.append({"points": point_count, "coefficientChange": change, "loss": loss})
            final = samples, fits, loss, fit_success, timed_out
            if converged is not None and change is not None and change < tolerance and fit_success and previous_fit_success:
                converged = True
                break
            previous_coefficients = coefficients
            previous_fit_success = fit_success
            if timed_out:
                messages.append("Лимит времени подбора достигнут. Показан лучший полученный результат; сходимость не подтверждена.")
                break
        except CalculationTimeout:
            if final is None:
                raise ValueError("Расчёт превысил минуту. Уменьшите число точек или степень аппроксимации.") from None
            messages.append("Лимит времени достигнут. Сохранена последняя полностью рассчитанная сетка.")
            break
    samples, fits, loss, fit_success, timed_out = final
    pole_roots = denominator_roots(fits, start, end)
    denominator_safe = not pole_roots
    max_x_error, max_value_error, max_sample_violation = 0.0, 0.0, 0.0
    invalid_sample = False
    for sample in samples:
        approximation = evaluate_fits(fits, sample["t"])
        if approximation is None:
            invalid_sample = True
            denominator_safe = False
            continue
        approximate_value = _value(problem, approximation, sample["t"])
        if not np.isfinite(approximate_value):
            invalid_sample = True
            continue
        sample["xApprox"] = approximation.tolist()
        sample["valueApprox"] = approximate_value
        max_x_error = max(max_x_error, float(np.max(np.abs(approximation - np.asarray(sample["x"])))))
        max_value_error = max(max_value_error, abs(approximate_value - sample["value"]))
        max_sample_violation = max(max_sample_violation, kkt_diagnostics(problem, approximation, sample["t"])["maxViolation"])
    curve_times = set(np.linspace(start, end, max(201, len(samples))).tolist())
    curve_times.update(sample["t"] for sample in samples)
    curve_times.update(pole_roots)
    curve = []
    max_curve_violation = 0.0
    for t in sorted(curve_times):
        x = evaluate_fits(fits, t)
        at_root = any(abs(t - root) <= 1e-10 * max(1.0, abs(end - start)) for root in pole_roots)
        if x is None or at_root:
            curve.append({"t": float(t), "xApprox": None, "valueApprox": None, "feasible": False, "maxViolation": None, "denominatorSafe": False})
            denominator_safe = False
            continue
        violation = max(0.0, float(np.max(problem["K"] @ x - problem["l0"] - t * problem["l1"])), float(np.max(-x)))
        value = _value(problem, x, t)
        if not np.isfinite(value):
            curve.append({"t": float(t), "xApprox": None, "valueApprox": None, "feasible": False, "maxViolation": None, "denominatorSafe": False})
            denominator_safe = False
            continue
        max_curve_violation = max(max_curve_violation, violation)
        curve.append({"t": float(t), "xApprox": x.tolist(), "valueApprox": value, "feasible": _is_feasible(problem, x, t), "maxViolation": violation, "denominatorSafe": True})
    if not all(sample["kkt"] for sample in samples):
        messages.append("Для части численных решений условия Куна — Таккера не подтверждены с заданным допуском.")
    if not fit_success:
        messages.append("Подбор коэффициентов не подтвердил сходимость. Численные решения QP доступны, приближение используйте с учётом ошибок.")
    if not denominator_safe:
        messages.append("Знаменатель приближения обращается в ноль или слишком мал на диапазоне. График разорван в опасных точках.")
    if max_curve_violation > 1e-6:
        messages.append("Приближение нарушает ограничения хотя бы в одной проверенной точке диапазона.")
    if converged is False:
        messages.append("Сходимость коэффициентов по ε не достигнута. Это не равнозначно большой ошибке самого плана.")
    if len(samples) < p + q + 1:
        messages.append("Число точек меньше числа коэффициентов одной функции: формула может быть неоднозначной.")
    fit_message = "Подбор коэффициентов завершён." if fit_success else "Сходимость подбора коэффициентов не подтверждена."
    if invalid_sample:
        fit_message += " В некоторых узлах приближение не определено."
    progress("Расчёт завершён", 1)
    return {
        "samples": samples, "curve": curve, "fits": fits,
        "canonical": {name: value.tolist() if isinstance(value, np.ndarray) else float(value) for name, value in problem.items()},
        "diagnostics": {
            "concave": True, "maxEigenvalue": max_eigenvalue,
            "fitSuccess": bool(fit_success and not invalid_sample), "fitMessage": fit_message,
            "loss": loss, "maxXError": max_x_error, "maxValueError": max_value_error,
            "maxSampleViolation": max_sample_violation, "maxCurveViolation": max_curve_violation,
            "denominatorSafe": denominator_safe, "allKkt": all(s["kkt"] for s in samples),
            "converged": converged, "pointsUsed": len(samples),
            "elapsedSeconds": float(time.perf_counter() - start_time), "warnings": messages,
        },
        "convergence": convergence,
    }
