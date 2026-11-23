import {
  Fragment,
  useState,
  type DetailedHTMLProps,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { Check, Copy } from "lucide-react";

type MathAttributes = DetailedHTMLProps<
  HTMLAttributes<MathMLElement>,
  MathMLElement
>;

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathAttributes & { display?: "block" | "inline" };
      mi: MathAttributes;
      mn: MathAttributes;
      mo: MathAttributes;
      mrow: MathAttributes;
      mfrac: MathAttributes;
      msup: MathAttributes;
      msub: MathAttributes;
      munder: MathAttributes;
      mover: MathAttributes & { accent?: "true" | "false" };
      mtable: MathAttributes;
      mtr: MathAttributes;
      mtd: MathAttributes;
    }
  }
}

export function MathBlock({
  children,
  compact,
}: {
  children: ReactNode;
  compact?: ReactNode;
}) {
  return (
    <div
      className="math-scroll"
      tabIndex={0}
      role="group"
      aria-label="Математическое выражение"
    >
      <math className={compact ? "math-wide" : undefined} display="block">
        {children}
      </math>
      {compact && (
        <math className="math-compact" display="block">
          {compact}
        </math>
      )}
    </div>
  );
}

export function Call({
  name,
  children = <mi>t</mi>,
}: {
  name: ReactNode;
  children?: ReactNode;
}) {
  return (
    <mrow>
      {name}
      <mo>(</mo>
      {children}
      <mo>)</mo>
    </mrow>
  );
}

export function Approx({ name }: { name: string }) {
  return (
    <mover accent="true">
      <mi>{name}</mi>
      <mo>~</mo>
    </mover>
  );
}

export function MathNumber({
  value,
  digits = 7,
}: {
  value: number;
  digits?: number;
}) {
  const [mantissa, exponent] = Number(Math.abs(value).toPrecision(digits))
    .toString()
    .split("e");
  return (
    <mrow>
      {value < 0 && <mo>−</mo>}
      <mn>{mantissa.replace(".", ",")}</mn>
      {exponent !== undefined && (
        <>
          <mo>×</mo>
          <msup>
            <mn>10</mn>
            <mn>{exponent.replace("+", "").replace("-", "−")}</mn>
          </msup>
        </>
      )}
    </mrow>
  );
}

export function Polynomial({
  coefficients,
  symbol = "t",
  digits,
}: {
  coefficients: number[];
  symbol?: string;
  digits?: number;
}) {
  const terms = coefficients
    .map((value, power) => ({ value, power }))
    .filter(({ value }) => value !== 0)
    .reverse();
  return (
    <mrow>
      {terms.length === 0 ? (
        <mn>0</mn>
      ) : (
        terms.map(({ value, power }, index) => (
          <Fragment key={power}>
            {value < 0 ? <mo>−</mo> : index > 0 ? <mo>+</mo> : null}
            {(power === 0 || Math.abs(value) !== 1) && (
              <MathNumber value={Math.abs(value)} digits={digits} />
            )}
            {power === 1 && <mi>{symbol}</mi>}
            {power > 1 && (
              <msup>
                <mi>{symbol}</mi>
                <mn>{power}</mn>
              </msup>
            )}
          </Fragment>
        ))
      )}
    </mrow>
  );
}

export function RationalExpression({
  numerator,
  denominator,
  symbol = "t",
}: {
  numerator: number[];
  denominator: number[];
  symbol?: string;
}) {
  const top = <Polynomial coefficients={numerator} symbol={symbol} />;
  return denominator[0] === 1 &&
    denominator.slice(1).every((value) => value === 0) ? (
    top
  ) : (
    <mfrac>
      {top}
      <Polynomial coefficients={denominator} symbol={symbol} />
    </mfrac>
  );
}

function polynomialText(coefficients: number[], symbol: string) {
  return (
    coefficients
      .reduceRight<string[]>((terms, value, power) => {
        if (value === 0) return terms;
        const absolute = Math.abs(value);
        const factor =
          power === 0
            ? String(absolute)
            : `${absolute === 1 ? "" : absolute + "*"}${symbol}${power > 1 ? "^" + power : ""}`;
        terms.push(
          (value < 0
            ? terms.length
              ? " - "
              : "-"
            : terms.length
              ? " + "
              : "") + factor,
        );
        return terms;
      }, [])
      .join("") || "0"
  );
}

export function FractionCard({
  title,
  label,
  numerator,
  denominator,
  symbol = "t",
  children,
}: {
  title: string;
  label: ReactNode;
  numerator: number[];
  denominator: number[];
  symbol?: string;
  children?: ReactNode;
}) {
  const [copyFeedback, setCopyFeedback] = useState<{
    text: string;
    status: "done" | "failed";
  }>();
  const text = `(${polynomialText(numerator, symbol)})/(${polynomialText(denominator, symbol)})`;
  const copyStatus = copyFeedback?.text === text ? copyFeedback.status : "idle";
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback({ text, status: "done" });
    } catch {
      setCopyFeedback({ text, status: "failed" });
    }
  }
  return (
    <div className="math-card">
      <div className="math-card-heading">
        <span>{title}</span>
        <button
          className="math-copy"
          type="button"
          onClick={() => void copy()}
          aria-label={`Копировать выражение · ${title}`}
          title="Копировать без округления"
        >
          {copyStatus === "done" ? (
            <Check size={16} aria-hidden="true" />
          ) : (
            <Copy size={16} aria-hidden="true" />
          )}
          {copyStatus === "done" ? "Скопировано" : "Копировать"}
        </button>
      </div>
      <MathBlock>
        <mrow>
          {label}
          <mo>=</mo>
          <RationalExpression
            numerator={numerator}
            denominator={denominator}
            symbol={symbol}
          />
        </mrow>
      </MathBlock>
      {copyStatus !== "idle" && (
        <span className="math-copy-status" role="status">
          {copyStatus === "done"
            ? "Выражение скопировано"
            : "Копирование недоступно. Выделите выражение ниже."}
        </span>
      )}
      {copyStatus === "failed" && (
        <code className="math-copy-text">{text}</code>
      )}
      {children}
    </div>
  );
}
