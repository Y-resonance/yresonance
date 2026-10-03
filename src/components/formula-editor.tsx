import { autocompletion, type CompletionContext } from '@codemirror/autocomplete';
import { StreamLanguage, type StringStream } from '@codemirror/language';
import { linter, lintGutter } from '@codemirror/lint';
import type { EditorView } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import {
  CalendarDaysIcon,
  FingerprintIcon,
  HashIcon,
  SearchIcon,
  SigmaIcon,
  SquareFunctionIcon,
  TypeIcon,
} from 'lucide-react';
import { useMemo, useState, useSyncExternalStore, type RefObject } from 'react';
import { Input } from '#/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import type { DatasourceDescription, DatasourceFieldRow } from '#/domain/datasource-fields';
import { validateAggregateFormula } from '#/query/compiler';
import {
  aggregateFormulaFunctions,
  rowFormulaFunctions,
  type FormulaMode,
  type FormulaType,
} from '#/query/formula';
import type { CalculatedFieldRecord, FieldRecord } from '#/query/types';

/** Mirrors the shape returned by the `validate*` API actions so local and remote checks are interchangeable. */
export type FormulaValidation =
  | { valid: true; type: FormulaType; identifiers: string[] }
  | { valid: false; error: { message: string; from: number; to: number } };

const formulaLanguage = StreamLanguage.define({
  token(stream: StringStream) {
    if (stream.eatSpace()) return null;
    if (stream.match(/^(?:and|or|not|true|false|null)\b/iu)) return 'keyword';
    if (stream.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/iu)) return 'number';
    if (stream.match(/^'(?:[^']|'')*'?/u)) return 'string';
    if (stream.match(/^"(?:[^"]|"")*"?/u)) return 'variableName';
    if (stream.match(/^[A-Za-z_][A-Za-z0-9_]*/u)) return 'variableName';
    if (stream.match(/^(?:<=|>=|!=|<>|[+\-*/%=<>])/u)) return 'operator';
    if (stream.match(/^[(),]/u)) return 'punctuation';
    stream.next();
    return 'invalid';
  },
});

/**
 * Searchable list of every field a formula may reference. Clicking one inserts its
 * canonical name at the cursor, which is why the caller owns the editor ref.
 */
export function FormulaFieldList({
  datasource,
  excludedFieldId,
  onInsert,
}: {
  datasource: DatasourceDescription;
  excludedFieldId?: string;
  onInsert: (canonicalName: string) => void;
}) {
  const [search, setSearch] = useState('');
  const fields = useMemo(
    () => formulaEditorFields(datasource, excludedFieldId),
    [datasource, excludedFieldId],
  );
  return (
    <>
      <div className="relative border-b p-3">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-8"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search fields"
          aria-label="Search fields"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {fields
          .filter((item) =>
            `${item.label} ${item.canonicalName}`
              .toLocaleLowerCase('en-US')
              .includes(search.toLocaleLowerCase('en-US')),
          )
          .map((item) => (
            <Tooltip key={item.key}>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                    onClick={() => onInsert(item.canonicalName)}
                  />
                }
              >
                <FieldTypeIcon field={item} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.label}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {item.canonicalName}
                  </span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-72">
                <p>{item.semanticType}</p>
                {item.sampleValues?.length ? (
                  <p className="mt-1 text-xs">
                    Samples: {item.sampleValues.slice(0, 4).map(displayValue).join(', ')}
                  </p>
                ) : null}
                {item.cardinality !== null && item.cardinality !== undefined ? (
                  <p className="text-xs">{item.cardinality.toLocaleString()} distinct values</p>
                ) : null}
              </TooltipContent>
            </Tooltip>
          ))}
      </div>
    </>
  );
}

// ThemeToggle owns the root class outside React. Observe it so an open editor follows toggles.
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
}

function isDarkTheme() {
  return document.documentElement.classList.contains('dark');
}

function serverTheme() {
  return false;
}

/** Code editor for a yresonance formula. `validation` drives the inline error underline. */
export function FormulaInput({
  editorRef,
  datasource,
  mode,
  excludedFieldId,
  value,
  onChange,
  validation,
  height = '18rem',
}: {
  editorRef?: RefObject<ReactCodeMirrorRef | null>;
  datasource: DatasourceDescription;
  mode: FormulaMode;
  excludedFieldId?: string;
  value: string;
  onChange: (value: string) => void;
  validation: FormulaValidation;
  height?: string;
}) {
  const dark = useSyncExternalStore(subscribeToTheme, isDarkTheme, serverTheme);
  const completion = useMemo(
    () => completionSource(datasource, mode, excludedFieldId),
    [datasource, mode, excludedFieldId],
  );
  const extensions = useMemo(
    () => [
      formulaLanguage,
      autocompletion({ override: [completion] }),
      linter(
        () => (validation.valid ? [] : [{ ...validation.error, severity: 'error' as const }]),
        {
          delay: 100,
        },
      ),
      lintGutter(),
    ],
    [completion, validation],
  );
  return (
    <CodeMirror
      ref={editorRef}
      value={value}
      height={height}
      theme={dark ? 'dark' : 'light'}
      extensions={extensions}
      onChange={onChange}
      basicSetup={{ bracketMatching: true, closeBrackets: true, lineNumbers: true }}
      className="overflow-hidden rounded-md border text-sm [&_.cm-activeLine]:bg-muted! [&_.cm-activeLineGutter]:bg-muted! [&_.cm-editor]:bg-card! [&_.cm-editor.cm-focused]:outline-none [&_.cm-gutters]:border-border! [&_.cm-gutters]:bg-card!"
      aria-label="Formula"
    />
  );
}

/** Inserts a field reference at the cursor, quoting the name when it is not a bare identifier. */
export function insertFieldReference(view: EditorView | undefined, canonicalName: string) {
  if (!view) return;
  const value = formulaIdentifier(canonicalName);
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: value },
    selection: { anchor: from + value.length },
  });
  view.focus();
}

export function formulaIdentifier(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/u.test(value) ? value : `"${value.replaceAll('"', '""')}"`;
}

/** Reshapes a datasource description into the records the query compiler validates against. */
export function formulaContext(datasource: DatasourceDescription) {
  const fields: FieldRecord[] = datasource.fields.map((field) => ({
    ...field,
    dataSourceId: datasource.id,
    hidden: false,
    castTo: field.castTo ?? null,
    sampleValues: field.sampleValues ?? null,
    cardinality: field.cardinality ?? null,
  }));
  const calculatedFields: CalculatedFieldRecord[] = datasource.calculatedFields.map((field) => ({
    ...field,
    dataSourceId: datasource.id,
  }));
  return { fields, calculatedFields };
}

/** Aggregate formulas have no name or type to reconcile, so a compile pass is the whole check. */
export function validateAggregateLocally(
  expression: string,
  context: ReturnType<typeof formulaContext>,
): FormulaValidation {
  try {
    if (!expression.trim()) throw new Error('A formula is required.');
    const compiled = validateAggregateFormula(expression, context);
    return { valid: true, type: compiled.type, identifiers: compiled.identifiers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { valid: false, error: errorRange(message, expression) };
  }
}

/**
 * Turns a compiler message into an editor range. Parse errors carry a position; unknown
 * field errors do not, so the field name is located in the source instead.
 */
export function errorRange(message: string, expression: string) {
  const positioned = message.match(/position (\d+)/iu);
  let from = positioned ? Number(positioned[1]) - 1 : 0;
  const unknown = message.match(/Unknown formula field ([^.]+)\./u)?.[1];
  if (!positioned && unknown) {
    const match = expression.toLocaleLowerCase('en-US').indexOf(unknown.toLocaleLowerCase('en-US'));
    if (match >= 0) from = match;
  }
  from = Math.max(0, Math.min(from, expression.length));
  const length = unknown?.length ?? 1;
  return { message, from, to: Math.min(expression.length, from + length) };
}

export function displayValue(value: unknown) {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Raw and calculated fields, sorted by label. A field being edited cannot reference itself. */
export function formulaEditorFields(
  datasource: DatasourceDescription,
  excludedFieldId?: string,
): DatasourceFieldRow[] {
  return [
    ...datasource.fields.map((field) => ({
      ...field,
      key: `raw:${field.id}`,
      origin: 'raw' as const,
      description: field.description ?? '',
      expression: '',
      editable: true,
    })),
    ...datasource.calculatedFields
      .filter((field) => field.id !== excludedFieldId)
      .map((field) => ({
        ...field,
        key: `calculated:${field.id}`,
        origin: 'calculated' as const,
        description: field.description ?? '',
        editable: true,
      })),
  ].sort((left, right) => left.label.localeCompare(right.label));
}

function completionSource(
  datasource: DatasourceDescription,
  mode: FormulaMode,
  excludedFieldId?: string,
) {
  const functions =
    mode === 'aggregate'
      ? [...aggregateFormulaFunctions, ...rowFormulaFunctions]
      : rowFormulaFunctions;
  const options = [
    ...formulaEditorFields(datasource, excludedFieldId).map((field) => ({
      label: field.canonicalName,
      displayLabel: field.label,
      detail: field.semanticType,
      type: 'variable' as const,
      boost: 100,
      apply: formulaIdentifier(field.canonicalName),
    })),
    ...functions.map((name) => ({
      label: name,
      type: 'function' as const,
      apply: `${name}()`,
    })),
  ];
  return (context: CompletionContext) => {
    const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/u);
    if (!context.explicit && !word) return null;
    return { from: word?.from ?? context.pos, options };
  };
}

function FieldTypeIcon({ field }: { field: DatasourceFieldRow }) {
  const Icon =
    field.origin === 'calculated'
      ? SquareFunctionIcon
      : field.semanticType === 'date'
        ? CalendarDaysIcon
        : field.semanticType === 'id'
          ? FingerprintIcon
          : field.semanticType === 'text'
            ? TypeIcon
            : field.role === 'metric'
              ? SigmaIcon
              : HashIcon;
  return <Icon className="size-4 shrink-0 text-muted-foreground" />;
}
