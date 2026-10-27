import { NativeSelect, NativeSelectOption } from '#/components/ui/native-select';
import { Field, FieldLabel } from '#/components/ui/field';
import type { SqlDialect } from '#/query/dialect';

export function FormulaModeSelect({
  dialect,
  native,
  onChange,
}: {
  dialect: SqlDialect;
  native: boolean;
  onChange: (native: boolean) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor="formula-language">Formula language</FieldLabel>
      <NativeSelect
        id="formula-language"
        value={native ? 'native' : 'legacy'}
        onChange={(event) => onChange(event.target.value === 'native')}
      >
        <NativeSelectOption value="legacy">Portable formula</NativeSelectOption>
        <NativeSelectOption value="native">{dialect} SQL</NativeSelectOption>
      </NativeSelect>
      {native ? (
        <p className="text-sm text-muted-foreground">
          Use {'{{canonical_field_name}}'} references. Validated by {dialect}.
        </p>
      ) : null}
    </Field>
  );
}
