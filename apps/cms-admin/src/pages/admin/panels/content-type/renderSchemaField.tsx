/* eslint-disable react-refresh/only-export-components */
import { ChevronRight } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useFormContext } from "react-hook-form";

import { BooleanInput, FormField, MediaInput, NumberInput, TextInput } from "@/components/form";
import { RepeatableComponentField } from "@/components/form/inputs/RepeatableComponentField";
import { cn } from "@/lib/utils";
import type { FieldDefinition } from "@/types/cms";

const RichTextInput = lazy(() =>
  import("@/components/form/inputs/RichTextInput").then((mod) => ({
    default: mod.RichTextInput,
  })),
);

const JsonInput = lazy(() =>
  import("@/components/form/inputs/JsonInput").then((mod) => ({
    default: mod.JsonInput,
  })),
);

function primitiveInput(field: FieldDefinition, id: string): React.ReactElement<Record<string, unknown>> {
  switch (field.type) {
    case "number":
      return <NumberInput id={id} aria-label={field.name} />;
    case "boolean":
      return <BooleanInput id={id} aria-label={field.name} />;
    default:
      return <TextInput id={id} aria-label={field.name} placeholder={field.name} />;
  }
}

function toFieldId(fieldName: string): string {
  return fieldName.replace(/[^a-zA-Z0-9_-]/g, "-");
}

function widthToColSpan(width: string | undefined): string {
  switch (width) {
    case "50%":
      return "md:col-span-3";
    case "1/3":
      return "md:col-span-2";
    default:
      return "md:col-span-6";
  }
}

const depthStyles = [
  { border: "border-indigo-300 dark:border-indigo-700", bg: "bg-indigo-50/50 dark:bg-indigo-950/20", legend: "text-indigo-700 dark:text-indigo-300" },
  { border: "border-violet-300 dark:border-violet-700", bg: "bg-violet-50/50 dark:bg-violet-950/20", legend: "text-violet-700 dark:text-violet-300" },
  { border: "border-amber-300 dark:border-amber-700", bg: "bg-amber-50/50 dark:bg-amber-950/20", legend: "text-amber-700 dark:text-amber-300" },
] as const;

function findFirstTextFieldName(fields: FieldDefinition[]): string | undefined {
  return fields.find((fld) => fld.type === "text")?.name;
}

function resolveHeaderFieldName(fields: FieldDefinition[]): string | undefined {
  const flagged = fields.filter((fld) => fld.header);
  const latest = flagged[flagged.length - 1];
  if (latest && latest.type === "text") return latest.name;
  return findFirstTextFieldName(fields);
}

function formatHintText(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.length > 60 ? trimmed.slice(0, 60) + "..." : trimmed;
}

interface CollapsibleFieldsetProps {
  fieldKey: string;
  label: string;
  depth: number;
  fieldName: string;
  fields: FieldDefinition[];
  children: React.ReactNode;
}

function CollapsibleFieldset({ fieldKey, label, depth, fieldName, fields, children }: CollapsibleFieldsetProps) {
  const [expanded, setExpanded] = useState(() => depth < 1);
  const { watch } = useFormContext();
  const style = depthStyles[depth % depthStyles.length];

  const headerFieldName = resolveHeaderFieldName(fields);
  const rawValue = headerFieldName ? watch(`${fieldName}.${headerFieldName}`) : undefined;
  const hintText = formatHintText(rawValue);

  return (
    <fieldset key={fieldKey} aria-label={label} className={`md:col-span-6 rounded-md border p-4 ${style.border} ${style.bg}`}>
      <legend className={`px-1 text-sm font-medium ${style.legend}`}>
        <button type="button" className="flex items-center gap-1" onClick={() => setExpanded((prev) => !prev)} aria-expanded={expanded}>
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-200", expanded && "rotate-90")} />
          <span>{label}</span>
          {hintText && (
            <span className="text-muted-foreground ml-1 truncate text-xs font-normal">
              {"— "}
              {hintText}
            </span>
          )}
        </button>
      </legend>
      {expanded && <div className="grid grid-cols-1 md:grid-cols-6 gap-4">{children}</div>}
    </fieldset>
  );
}

function renderField(field: FieldDefinition, prefix: string, keyPrefix: string, depth: number, _index: number): React.ReactNode {
  const fieldName = prefix + field.name;
  const fieldKey = `${keyPrefix}${field.name}`;

  if (field.type === "component") {
    const childKeyPrefix = `${fieldKey}_`;
    if (field.repeatable) {
      return (
        <RepeatableComponentField
          key={fieldKey}
          name={fieldName}
          label={field.name}
          depth={depth}
          keyPrefix={childKeyPrefix}
          fields={field.fields ?? []}
          renderField={(child: FieldDefinition, childPrefix: string, childDepth: number, childIndex: number) =>
            renderField(child, childPrefix, childKeyPrefix, childDepth, childIndex)
          }
        />
      );
    }
    const childPrefix = fieldName + ".";
    return (
      <CollapsibleFieldset key={fieldKey} fieldKey={fieldKey} label={field.name} depth={depth} fieldName={fieldName} fields={field.fields ?? []}>
        {(field.fields ?? []).map((child, childIndex) => renderField(child, childPrefix, childKeyPrefix, depth + 1, childIndex))}
      </CollapsibleFieldset>
    );
  }

  const colSpan = widthToColSpan(field.width);

  if (field.type === "json") {
    return (
      <div key={fieldKey} className={colSpan}>
        <label className="mb-1 block text-sm font-medium">{field.name}</label>
        <Suspense fallback={<div className="bg-muted h-48 animate-pulse rounded-md" />}>
          <JsonInput name={fieldName} aria-label={field.name} />
        </Suspense>
      </div>
    );
  }

  if (field.type === "richtext") {
    return (
      <div key={fieldKey} className={colSpan}>
        <label className="mb-1 block text-sm font-medium">{field.name}</label>
        <Suspense fallback={<div className="bg-muted h-48 animate-pulse rounded-md" />}>
          <RichTextInput name={fieldName} />
        </Suspense>
      </div>
    );
  }

  if (field.type === "media") {
    return (
      <div key={fieldKey} className={colSpan}>
        <label className="mb-1 block text-sm font-medium">{field.name}</label>
        {/* No per-field extension allowlist — the API accepts PNG/JPEG only, enforced server-side on upload */}
        <MediaInput name={fieldName} aria-label={field.name} />
      </div>
    );
  }

  const fieldId = toFieldId(fieldName);
  return (
    <div key={fieldKey} className={colSpan}>
      <label htmlFor={fieldId} className="mb-1 block text-sm font-medium">
        {field.name}
      </label>
      <FormField name={fieldName}>{primitiveInput(field, fieldId)}</FormField>
    </div>
  );
}

export function renderSchemaField(field: FieldDefinition, prefix: string, keyPrefix: string, index: number): React.ReactNode {
  return renderField(field, prefix, keyPrefix, 0, index);
}
