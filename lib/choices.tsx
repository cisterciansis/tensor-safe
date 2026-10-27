'use client';
import { Children, isValidElement, type ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// Shared select adapter keeps native-looking form call sites on the accessible primitive.
export function Choice({
  children,
  value,
  onChange,
  disabled,
  'aria-label': label,
}: {
  children: ReactNode;
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const options = Children.toArray(children).flatMap((child) =>
    isValidElement<{ value?: string; disabled?: boolean; children: ReactNode }>(
      child,
    )
      ? [
          {
            value:
              child.props.value ??
              (typeof child.props.children === 'string'
                ? child.props.children
                : ''),
            label: child.props.children,
            disabled: child.props.disabled,
          },
        ]
      : [],
  );
  return (
    <Select
      value={value || null}
      onValueChange={(v) => onChange({ target: { value: v ?? '' } })}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="choice-trigger">
        <SelectValue>
          {options.find((o) => o.value === value)?.label ?? 'Select…'}
        </SelectValue>
      </SelectTrigger>
      {/* Drop below the trigger like an iOS menu instead of covering it. */}
      <SelectContent alignItemWithTrigger={false} align="start">
        {options
          .filter((o) => o.value !== '')
          .map((o) => (
            <SelectItem key={o.value} value={o.value} disabled={o.disabled}>
              {o.label}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  );
}
