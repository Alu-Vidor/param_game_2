import { Approx, Call, MathBlock } from "./MathNotation";

export function QuadraticObjective({
  maximize = false,
  approximate = false,
}: {
  maximize?: boolean;
  approximate?: boolean;
}) {
  const argument = (
    <mrow>
      <mi>x</mi>
      <mo>,</mo>
      <mi>t</mi>
    </mrow>
  );
  const x = approximate ? <Call name={<Approx name="x" />} /> : <mi>x</mi>;
  const lhs = (
    <mrow>
      {maximize && (
        <munder>
          <mo>max</mo>
          <mi>x</mi>
        </munder>
      )}
      {approximate ? (
        <Call name={<Approx name="f" />} />
      ) : (
        <Call name={<mi>f</mi>}>{argument}</Call>
      )}
      <mo>=</mo>
    </mrow>
  );
  const quadratic = (
    <mrow>
      <msup>
        {x}
        <mi>𝖳</mi>
      </msup>
      <Call name={<mi>A</mi>} />
      {x}
    </mrow>
  );
  const rest = (
    <mrow>
      <mo>+</mo>
      <msup>
        <Call name={<mi>b</mi>} />
        <mi>𝖳</mi>
      </msup>
      {x}
      <mo>+</mo>
      <Call name={<mi>c</mi>} />
    </mrow>
  );
  return (
    <MathBlock
      compact={
        <mtable className="math-aligned">
          <mtr>
            <mtd>
              <mrow>
                {lhs}
                {quadratic}
              </mrow>
            </mtd>
          </mtr>
          <mtr>
            <mtd>{rest}</mtd>
          </mtr>
        </mtable>
      }
    >
      <mrow>
        {lhs}
        {quadratic}
        {rest}
      </mrow>
    </MathBlock>
  );
}

export function QuadraticConstraint({
  nonnegative = false,
}: {
  nonnegative?: boolean;
}) {
  return (
    <MathBlock>
      <mrow>
        <Call name={<mi>K</mi>} />
        <mi>x</mi>
        <mo>≤</mo>
        <Call name={<mi>l</mi>} />
        {nonnegative && (
          <>
            <mo>,</mo>
            <mi>x</mi>
            <mo>≥</mo>
            <mn>0</mn>
          </>
        )}
      </mrow>
    </MathBlock>
  );
}

export function ApproximationForm() {
  return (
    <MathBlock>
      <mrow>
        <Call
          name={
            <msub>
              <Approx name="x" />
              <mi>i</mi>
            </msub>
          }
        />
        <mo>=</mo>
        <mfrac>
          <mrow>
            <msub>
              <mi>a</mi>
              <mn>0</mn>
            </msub>
            <mo>+</mo>
            <msub>
              <mi>a</mi>
              <mn>1</mn>
            </msub>
            <mi>s</mi>
            <mo>+</mo>
            <mo>⋯</mo>
            <mo>+</mo>
            <msub>
              <mi>a</mi>
              <mi>p</mi>
            </msub>
            <msup>
              <mi>s</mi>
              <mi>p</mi>
            </msup>
          </mrow>
          <mrow>
            <mn>1</mn>
            <mo>+</mo>
            <msub>
              <mi>d</mi>
              <mn>1</mn>
            </msub>
            <mi>s</mi>
            <mo>+</mo>
            <mo>⋯</mo>
            <mo>+</mo>
            <msub>
              <mi>d</mi>
              <mi>q</mi>
            </msub>
            <msup>
              <mi>s</mi>
              <mi>q</mi>
            </msup>
          </mrow>
        </mfrac>
      </mrow>
    </MathBlock>
  );
}

export function QuadraticLoss() {
  return (
    <MathBlock>
      <mrow>
        <Call name={<mi>H</mi>}>
          <mi>D</mi>
        </Call>
        <mo>=</mo>
        <msub>
          <mi>α</mi>
          <mn>1</mn>
        </msub>
        <mo>∑</mo>
        <msup>
          <mrow>
            <mo>‖</mo>
            <mi>x</mi>
            <mo>−</mo>
            <Approx name="x" />
            <mo>‖</mo>
          </mrow>
          <mn>2</mn>
        </msup>
        <mo>+</mo>
        <msub>
          <mi>α</mi>
          <mn>2</mn>
        </msub>
        <mo>∑</mo>
        <msup>
          <mrow>
            <mo>(</mo>
            <Call name={<mi>f</mi>}>
              <mrow>
                <mi>x</mi>
                <mo>,</mo>
                <mi>t</mi>
              </mrow>
            </Call>
            <mo>−</mo>
            <Call name={<mi>f</mi>}>
              <mrow>
                <Approx name="x" />
                <mo>,</mo>
                <mi>t</mi>
              </mrow>
            </Call>
            <mo>)</mo>
          </mrow>
          <mn>2</mn>
        </msup>
      </mrow>
    </MathBlock>
  );
}
