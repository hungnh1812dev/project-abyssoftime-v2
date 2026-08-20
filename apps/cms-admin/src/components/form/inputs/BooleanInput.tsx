import { type Control, Controller } from "react-hook-form";

import { Switch } from "@/components/ui/switch";

interface BooleanInputProps {
  id?: string;
  name?: string;
  control?: Control;
  "aria-label"?: string;
}

export function BooleanInput({ id, name, control, "aria-label": ariaLabel }: BooleanInputProps) {
  return (
    <Controller
      name={name ?? ""}
      control={control}
      defaultValue={false}
      render={({ field }) => <Switch id={id} checked={field.value as boolean} onCheckedChange={field.onChange} aria-label={ariaLabel} />}
    />
  );
}
