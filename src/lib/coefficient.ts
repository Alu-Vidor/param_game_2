/** Polynomial coefficients are stored in ascending order: [constant, t, t², …]. */
const MAX_DEGREE = 12;
const MAX_INPUT_LENGTH = 2000;

type Token =
  | { kind: "number"; value: number }
  | { kind: "t" | "+" | "-" | "*" | "/" | "^" | "(" | ")" | "end" };

function normalize(values: number[]): number[] {
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(
      "Слишком большие числа в формуле. Уменьшите коэффициенты или степень.",
    );
  }
  while (values.length > 1 && values[values.length - 1] === 0) values.pop();
  if (values.length > MAX_DEGREE + 1) {
    throw new Error(
      `Максимальная поддерживаемая степень многочлена — ${MAX_DEGREE}.`,
    );
  }
  return values.length
    ? values.map((value) => (Object.is(value, -0) ? 0 : value))
    : [0];
}

function add(left: number[], right: number[], sign = 1): number[] {
  return normalize(
    Array.from(
      { length: Math.max(left.length, right.length) },
      (_, i) => (left[i] ?? 0) + sign * (right[i] ?? 0),
    ),
  );
}

function multiply(left: number[], right: number[]): number[] {
  const product = Array(left.length + right.length - 1).fill(0) as number[];
  left.forEach((a, i) =>
    right.forEach((b, j) => {
      product[i + j] += a * b;
    }),
  );
  return normalize(product);
}

function tokenize(input: string): Token[] {
  if (!input.trim()) throw new Error("Введите число или многочлен от t.");
  if (input.length > MAX_INPUT_LENGTH)
    throw new Error("Слишком длинная формула. Сократите её.");
  const source = input
    .replace(/[−–—]/g, "-")
    .replace(/[·×]/g, "*")
    .replace(/\*\*/g, "^");
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index++;
      continue;
    }
    const number = /^(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?/.exec(
      source.slice(index),
    );
    if (number) {
      const value = Number(number[0].replace(",", "."));
      if (!Number.isFinite(value))
        throw new Error("Коэффициенты должны быть конечными числами.");
      tokens.push({ kind: "number", value });
      index += number[0].length;
      continue;
    }
    if ("t+-*/^()".includes(char)) {
      tokens.push({ kind: char as Exclude<Token["kind"], "number" | "end"> });
      index++;
      continue;
    }
    throw new Error(
      `Недопустимый символ «${char}». Используйте числа, t, +, −, *, /, ^ и скобки.`,
    );
  }
  tokens.push({ kind: "end" });
  return tokens;
}

/** Parse arithmetic into a polynomial without evaluating JavaScript or Python. */
function parsePolynomial(input: string): number[] {
  const tokens = tokenize(input);
  let cursor = 0;
  let depth = 0;
  const peek = () => tokens[cursor].kind;

  function expression(): number[] {
    let value = product();
    while (peek() === "+" || peek() === "-") {
      const sign = tokens[cursor++].kind === "+" ? 1 : -1;
      value = add(value, product(), sign);
    }
    return value;
  }

  function product(): number[] {
    let value = unary();
    while (
      peek() === "*" ||
      peek() === "/" ||
      peek() === "t" ||
      peek() === "("
    ) {
      const operator = peek();
      if (operator === "*" || operator === "/") cursor++;
      const right = unary();
      if (operator === "/") {
        if (right.length !== 1)
          throw new Error("Делить можно только на постоянное число.");
        if (right[0] === 0) throw new Error("Деление на ноль недопустимо.");
        value = normalize(value.map((coefficient) => coefficient / right[0]));
      } else {
        value = multiply(value, right);
      }
    }
    return value;
  }

  function unary(): number[] {
    if (++depth > 100)
      throw new Error("Слишком много вложенных операций или скобок.");
    let value: number[];
    if (peek() === "+") {
      cursor++;
      value = unary();
    } else if (peek() === "-") {
      cursor++;
      value = unary().map((coefficient) => -coefficient);
    } else value = power();
    depth--;
    return value;
  }

  function power(): number[] {
    let value = primary();
    if (peek() === "^") {
      cursor++;
      const exponent = unary();
      if (
        exponent.length !== 1 ||
        !Number.isInteger(exponent[0]) ||
        exponent[0] < 0 ||
        exponent[0] > MAX_DEGREE
      ) {
        throw new Error(
          `Степень должна быть целым числом от 0 до ${MAX_DEGREE}.`,
        );
      }
      const base = value;
      value = [1];
      for (let i = 0; i < exponent[0]; i++) value = multiply(value, base);
    }
    return value;
  }

  function primary(): number[] {
    const token = tokens[cursor];
    if (token.kind === "number") {
      cursor++;
      return [token.value];
    }
    if (token.kind === "t") {
      cursor++;
      return [0, 1];
    }
    if (token.kind === "(") {
      cursor++;
      const value = expression();
      if (peek() !== ")") throw new Error("Не хватает закрывающей скобки «)».");
      cursor++;
      return value;
    }
    throw new Error(
      "Некорректная формула. После знака операции укажите число, t или выражение в скобках.",
    );
  }

  const result = expression();
  if (peek() !== "end") {
    throw new Error(
      peek() === ")"
        ? "Лишняя закрывающая скобка «)»."
        : "Между числами нужен знак операции.",
    );
  }
  return normalize(result);
}

export type Coefficient = { numerator: number[]; denominator: number[] };

function grouped(source: string) {
  if (!source.startsWith("(") || !source.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")") depth--;
    if (depth === 0) return i === source.length - 1;
  }
  return false;
}

export function parseCoefficient(input: string): Coefficient {
  let source = input.trim();
  if (source.length > MAX_INPUT_LENGTH)
    throw new Error("Сократите формулу до 2000 символов.");
  while (grouped(source)) source = source.slice(1, -1).trim();
  try {
    return { numerator: parsePolynomial(source), denominator: [1] };
  } catch (error) {
    let depth = 0;
    let slash = -1;
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "(") depth++;
      if (source[i] === ")") depth--;
      if (source[i] === "/" && depth === 0) {
        if (slash !== -1) throw error;
        slash = i;
      }
    }
    if (slash < 0) throw error;
    const left = source.slice(0, slash).trim();
    const right = source.slice(slash + 1).trim();
    if (
      !(
        grouped(left) ||
        /^[+−-]?(?:t|(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)$/i.test(left)
      ) ||
      !(grouped(right) || right === "t")
    )
      throw new Error("Запишите дробь как (числитель)/(знаменатель).");
    const numerator = parsePolynomial(left);
    const denominator = parsePolynomial(right);
    if (denominator.every((value) => value === 0))
      throw new Error("Знаменатель тождественно равен нулю.");
    return { numerator, denominator };
  }
}

type Fields<T> = { A: T[][]; b: T[]; c: T; K: T[][]; l: T[] };
export type CoefficientExpressions = Fields<string>;
export type CoefficientFunctions = Fields<Coefficient>;

export function compileExpressions(
  expressions: CoefficientExpressions,
): CoefficientFunctions {
  const parse = (value: string, name: string) => {
    try {
      return parseCoefficient(value);
    } catch (error) {
      throw new Error(
        name +
          " · " +
          (error instanceof Error ? error.message : "Некорректная формула."),
      );
    }
  };
  return {
    A: expressions.A.map((row, i) =>
      row.map((value, j) => parse(value, `A[${i + 1}, ${j + 1}]`)),
    ),
    b: expressions.b.map((value, i) => parse(value, `b[${i + 1}]`)),
    c: parse(expressions.c, "c(t)"),
    K: expressions.K.map((row, i) =>
      row.map((value, j) => parse(value, `K[${i + 1}, ${j + 1}]`)),
    ),
    l: expressions.l.map((value, i) => parse(value, `l[${i + 1}]`)),
  };
}
