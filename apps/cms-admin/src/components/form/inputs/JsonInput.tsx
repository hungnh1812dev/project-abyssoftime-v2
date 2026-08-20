import { json } from "@codemirror/lang-json";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { useState } from "react";
import { type Control, Controller } from "react-hook-form";

interface JsonInputProps {
  name?: string;
  control?: Control;
  "aria-label"?: string;
}

function serialize(value: unknown): string {
  if (value == null) return "";
  return JSON.stringify(value, null, 2);
}

function InnerJsonInput({
  field,
  ariaLabel,
}: {
  field: { value: unknown; onChange: (value: unknown) => void };
  ariaLabel?: string;
}) {
  const [rawValue, setRawValue] = useState(serialize(field.value));
  const [syntaxError, setSyntaxError] = useState<string | null>(null);
  const [editCount, setEditCount] = useState(0);
  const [syncedAt, setSyncedAt] = useState(0);

  const [prevSerialized, setPrevSerialized] = useState(() => serialize(field.value));
  const currentSerialized = serialize(field.value);

  if (currentSerialized !== prevSerialized) {
    setPrevSerialized(currentSerialized);
    if (editCount === syncedAt) {
      setRawValue(currentSerialized);
    }
    setSyncedAt(editCount);
  }

  return (
    <div>
      <div data-testid="json-editor-wrapper" className="border-input min-h-[15em] max-h-112.5 overflow-auto rounded-md border">
        <CodeMirror
          value={rawValue}
          extensions={ariaLabel ? [json(), EditorView.contentAttributes.of({ "aria-label": ariaLabel })] : [json()]}
          minHeight="15em"
          maxHeight="450px"
          onChange={(val) => {
            setRawValue(val);
            setEditCount((count) => count + 1);
            if (val.trim() === "") {
              setSyntaxError(null);
              field.onChange(null);
              return;
            }
            try {
              const parsed = JSON.parse(val);
              setSyntaxError(null);
              field.onChange(parsed);
            } catch {
              setSyntaxError("Invalid JSON");
              field.onChange(undefined);
            }
          }}
        />
      </div>
      {syntaxError && <p role="alert">{syntaxError}</p>}
    </div>
  );
}

export function JsonInput({ name, control, "aria-label": ariaLabel }: JsonInputProps) {
  return (
    <Controller
      name={name ?? ""}
      control={control}
      defaultValue={null}
      rules={{
        validate: (value) => value !== undefined || "Invalid JSON",
      }}
      render={({ field }) => <InnerJsonInput field={field} ariaLabel={ariaLabel} />}
    />
  );
}
