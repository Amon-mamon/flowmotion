import { FLOW_COPY } from "@/features/flows/copy";
import type { JsonValue } from "@/features/flows/schemas";

const isBranch = (value: JsonValue): value is JsonValue[] | { [key: string]: JsonValue } =>
  value !== null && typeof value === "object";

function entriesOf(value: JsonValue[] | { [key: string]: JsonValue }): [string, JsonValue][] {
  return Array.isArray(value) ? value.map((item, index) => [String(index), item]) : Object.entries(value);
}

/** A scalar as plain text. Strings are shown as they are; nothing is parsed or linked. */
function Scalar({ value }: { value: string | number | boolean | null }) {
  return (
    <span className="break-words whitespace-pre-wrap text-foreground" data-param-value="">
      {value === null ? "null" : String(value)}
    </span>
  );
}

function Branch({ value }: { value: JsonValue[] | { [key: string]: JsonValue } }) {
  const entries = entriesOf(value);
  if (entries.length === 0) {
    return <span className="text-muted-foreground">{Array.isArray(value) ? "[]" : "{}"}</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {entries.map(([key, child]) => (
        <li key={key} className="min-w-0">
          <span className="text-muted-foreground" data-param-key="">
            {key}
          </span>
          {isBranch(child) && entriesOf(child).length > 0 ? (
            <div className="mt-1 ml-1 border-l border-border pl-3">
              <Branch value={child} />
            </div>
          ) : (
            <>
              <span className="text-muted-foreground">: </span>
              {isBranch(child) ? <Branch value={child} /> : <Scalar value={child} />}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Read-only key and value tree of a node's parameters, in the mono font (design.md). */
export function ParamTree({ params }: { params: Record<string, JsonValue> }) {
  if (Object.keys(params).length === 0) {
    return <p className="text-sm text-muted-foreground">{FLOW_COPY.noParameters}</p>;
  }
  return (
    <div className="rounded-lg border border-border bg-background p-3 font-mono text-xs" data-testid="param-tree">
      <Branch value={params} />
    </div>
  );
}
