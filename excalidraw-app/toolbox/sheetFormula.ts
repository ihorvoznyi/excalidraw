export type SheetValue = number | string | boolean | null;

export type NumberFormat = {
  type: "number" | "currency" | "financial";
  currency?: string;
  decimals?: number;
};

/** what a cell shows when it has no value yet: `#DIV/0!`, `Loading...` */
export class SheetError extends Error {}

const fail = (message: string): never => {
  throw new SheetError(message);
};

export const columnName = (index: number): string =>
  (index >= 26 ? columnName(Math.floor(index / 26) - 1) : "") +
  String.fromCharCode(65 + (index % 26));

const columnIndex = (name: string) =>
  [...name].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;

// -----------------------------------------------------------------------------
// exchange rates, updated daily: https://github.com/fawazahmed0/exchange-api
// -----------------------------------------------------------------------------

const rates = new Map<string, Record<string, number> | null | undefined>();
const ratesListeners = new Set<() => void>();
let ratesVersion = 0;

export const subscribeToRates = (listener: () => void) => {
  ratesListeners.add(listener);
  return () => {
    ratesListeners.delete(listener);
  };
};

export const getRatesVersion = () => ratesVersion;

const setRates = (base: string, table: Record<string, number> | null) => {
  rates.set(base, table);
  ratesVersion++;
  ratesListeners.forEach((listener) => listener());
};

const getRate = (from: string, to: string) => {
  if (!rates.has(from)) {
    rates.set(from, undefined);
    fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from}.min.json`,
    )
      .then((response) => response.json())
      .then((json) => setRates(from, json[from] ?? null))
      .catch(() => setRates(from, null));
  }
  const table = rates.get(from);
  return table === undefined ? fail("Loading...") : table?.[to] ?? fail("#N/A");
};

// -----------------------------------------------------------------------------
// values
// -----------------------------------------------------------------------------

type Thunk = () => SheetValue | SheetValue[];

const scalar = (value: SheetValue | SheetValue[]) =>
  Array.isArray(value) ? fail("#VALUE!") : value;

const toNumber = (value: SheetValue | SheetValue[]) => {
  const single = scalar(value);
  const number = Number(single);
  return Number.isNaN(number) ? fail("#VALUE!") : number;
};

const GENERAL = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 10,
  useGrouping: false,
});

const toText = (value: SheetValue) =>
  typeof value === "number"
    ? GENERAL.format(value)
    : typeof value === "boolean"
    ? String(value).toUpperCase()
    : value ?? "";

/** empty equals 0 and "", numbers sort before text */
const compare = (a: SheetValue, b: SheetValue) => {
  const x = a ?? (typeof b === "string" ? "" : 0);
  const y = b ?? (typeof a === "string" ? "" : 0);
  if (typeof x === "string" && typeof y === "string") {
    return x.toLowerCase().localeCompare(y.toLowerCase());
  }
  if (typeof x === "string" || typeof y === "string") {
    return typeof x === "string" ? 1 : -1;
  }
  return Number(x) - Number(y);
};

export const formatValue = (
  value: SheetValue | SheetError,
  format?: NumberFormat,
) => {
  if (value instanceof SheetError) {
    return value.message;
  }
  if (typeof value !== "number" || !format) {
    return toText(value);
  }
  const digits = format.decimals ?? 2;
  const fractions = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  };
  if (format.type === "currency") {
    return new Intl.NumberFormat("en-US", {
      ...fractions,
      style: "currency",
      currency: format.currency ?? "USD",
      currencyDisplay: "narrowSymbol",
    }).format(value);
  }
  const text = new Intl.NumberFormat("en-US", fractions).format(
    Math.abs(value),
  );
  return value >= 0
    ? text
    : format.type === "financial"
    ? `(${text})`
    : `-${text}`;
};

// -----------------------------------------------------------------------------
// functions and operators
// -----------------------------------------------------------------------------

const numbersIn = (args: Thunk[]) =>
  args
    .flatMap((arg) => arg())
    .filter((value): value is number => typeof value === "number");

const sum = (numbers: number[]) => numbers.reduce((a, b) => a + b, 0);

const FUNCTIONS: Record<string, (args: Thunk[]) => SheetValue> = {
  SUM: (args) => sum(numbersIn(args)),
  AVERAGE: (args) => {
    const numbers = numbersIn(args);
    return numbers.length ? sum(numbers) / numbers.length : fail("#DIV/0!");
  },
  MIN: (args) => {
    const numbers = numbersIn(args);
    return numbers.length ? Math.min(...numbers) : 0;
  },
  MAX: (args) => {
    const numbers = numbersIn(args);
    return numbers.length ? Math.max(...numbers) : 0;
  },
  COUNT: (args) => numbersIn(args).length,
  ABS: ([x]) => Math.abs(toNumber(x())),
  SQRT: ([x]) => {
    const number = toNumber(x());
    return number < 0 ? fail("#NUM!") : Math.sqrt(number);
  },
  POWER: ([x, y]) => toNumber(x()) ** toNumber(y()),
  MOD: ([x, y]) => {
    const [number, divisor] = [toNumber(x()), toNumber(y())];
    return divisor === 0
      ? fail("#DIV/0!")
      : number - divisor * Math.floor(number / divisor);
  },
  // half away from zero, through the exponent to not round 2.345's float error
  ROUND: ([x, places]) => {
    const number = toNumber(x());
    const digits = places ? toNumber(places()) : 0;
    return (
      Math.sign(number) *
      Number(
        `${Math.round(Number(`${Math.abs(number)}e${digits}`))}e${-digits}`,
      )
    );
  },
  IF: ([condition, then, otherwise]) => {
    const test = scalar(condition());
    if (typeof test === "string") {
      return fail("#VALUE!");
    }
    return test ? scalar(then()) : otherwise ? scalar(otherwise()) : false;
  },
  // only the current rate of a currency pair, not stocks or history
  GOOGLEFINANCE: (args) => {
    const pair = args.length === 1 && scalar(args[0]());
    const match = /^currency:([a-z]{3})([a-z]{3})$/i.exec(String(pair));
    return match
      ? getRate(match[1].toLowerCase(), match[2].toLowerCase())
      : fail("#N/A");
  },
};

const BINARY: Record<
  string,
  [number, (a: SheetValue, b: SheetValue) => SheetValue]
> = {
  "=": [1, (a, b) => compare(a, b) === 0],
  "<>": [1, (a, b) => compare(a, b) !== 0],
  "<": [1, (a, b) => compare(a, b) < 0],
  ">": [1, (a, b) => compare(a, b) > 0],
  "<=": [1, (a, b) => compare(a, b) <= 0],
  ">=": [1, (a, b) => compare(a, b) >= 0],
  "&": [2, (a, b) => toText(a) + toText(b)],
  "+": [3, (a, b) => toNumber(a) + toNumber(b)],
  "-": [3, (a, b) => toNumber(a) - toNumber(b)],
  "*": [4, (a, b) => toNumber(a) * toNumber(b)],
  "/": [
    4,
    (a, b) => (toNumber(b) === 0 ? fail("#DIV/0!") : toNumber(a) / toNumber(b)),
  ],
  "^": [5, (a, b) => toNumber(a) ** toNumber(b)],
};

// -----------------------------------------------------------------------------
// parsing
// -----------------------------------------------------------------------------

const TOKEN =
  /\s*(?:(?<number>\d+\.?\d*(?:e[-+]?\d+)?|\.\d+)|"(?<text>(?:[^"]|"")*)"|(?<range>\$?[a-z]+\$?\d+(?::\$?[a-z]+\$?\d+)?)(?![\w(])|(?<name>[a-z_][\w.]*)|(?<op><>|<=|>=|[-+*/^&=<>(),%]))/iy;

const REFERENCE = /^([A-Z]+)(\d+)$/;

const expandReference = (reference: string) => {
  const [start, end = start] = reference
    .replaceAll("$", "")
    .toUpperCase()
    .split(":")
    .map((id) => REFERENCE.exec(id)!);
  const ids: string[] = [];
  const columns = [columnIndex(start[1]), columnIndex(end[1])];
  const rows = [Number(start[2]), Number(end[2])];
  for (let r = Math.min(...rows); r <= Math.max(...rows); r++) {
    for (let c = Math.min(...columns); c <= Math.max(...columns); c++) {
      ids.push(`${columnName(c)}${r}`);
    }
  }
  return ids;
};

const compile = (source: string, cell: (id: string) => SheetValue): Thunk => {
  const tokens: Record<string, string | undefined>[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.trimEnd().length) {
    tokens.push(TOKEN.exec(source)?.groups ?? fail("#ERROR!"));
  }

  let position = 0;
  const accept = (op: string) => {
    const accepted = tokens[position]?.op === op;
    position += accepted ? 1 : 0;
    return accepted;
  };

  const primary = (): Thunk => {
    const token = tokens[position++] ?? fail("#ERROR!");
    if (token.number) {
      const number = Number(token.number);
      return () => number;
    }
    if (token.text !== undefined) {
      const text = token.text.replaceAll('""', '"');
      return () => text;
    }
    if (token.range) {
      const ids = expandReference(token.range);
      return token.range.includes(":")
        ? () => ids.map(cell)
        : () => cell(ids[0]);
    }
    if (token.name) {
      const name = token.name.toUpperCase();
      if (!accept("(")) {
        return name === "TRUE" || name === "FALSE"
          ? () => name === "TRUE"
          : () => fail("#NAME?");
      }
      const args: Thunk[] = [];
      if (!accept(")")) {
        do {
          args.push(expression());
        } while (accept(","));
        if (!accept(")")) {
          fail("#ERROR!");
        }
      }
      return () => (FUNCTIONS[name] ?? (() => fail("#NAME?")))(args);
    }
    if (token.op === "(") {
      const inner = expression();
      return accept(")") ? inner : fail("#ERROR!");
    }
    if (token.op === "-") {
      const inner = primary();
      return () => -toNumber(inner());
    }
    return token.op === "+" ? primary() : fail("#ERROR!");
  };

  const percent = () => {
    let node = primary();
    while (accept("%")) {
      const inner = node;
      node = () => toNumber(inner()) / 100;
    }
    return node;
  };

  const expression = (minPrecedence = 1): Thunk => {
    let left = percent();
    for (;;) {
      const operator = BINARY[tokens[position]?.op ?? ""];
      if (!operator || operator[0] < minPrecedence) {
        return left;
      }
      position++;
      const [a, b] = [left, expression(operator[0] + 1)];
      left = () => operator[1](scalar(a()), scalar(b()));
    }
  };

  const root = expression();
  return position < tokens.length ? fail("#ERROR!") : root;
};

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * Reads the cells of one state of a sheet, each computed once: a value, or
 * the error it shows.
 */
export const createEvaluator = (getRaw: (id: string) => string | undefined) => {
  const results = new Map<string, SheetValue | SheetError>();

  const cell = (id: string) => {
    const value = evaluate(id);
    return value instanceof SheetError ? fail(value.message) : value;
  };

  const compute = (raw = ""): SheetValue => {
    if (raw.length > 1 && raw.startsWith("=")) {
      return scalar(compile(raw.slice(1), cell)());
    }
    // "1,234.50" as Google Sheets copies it
    const number = raw.replace(/,(?=\d{3}(?!\d))/g, "");
    return !raw ? null : NUMBER.test(number) ? Number(number) : raw;
  };

  const evaluate = (id: string) => {
    if (!results.has(id)) {
      // what a formula reading itself gets back
      results.set(id, new SheetError("#REF!"));
      try {
        results.set(id, compute(getRaw(id)));
      } catch (error) {
        results.set(
          id,
          error instanceof SheetError ? error : new SheetError("#ERROR!"),
        );
      }
    }
    return results.get(id)!;
  };

  return evaluate;
};
