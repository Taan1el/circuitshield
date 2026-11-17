import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CONFIG_RULES } from '../../../shared/validation.js';

export interface FieldMeta {
  key: string;
  label: string;
  unit: string;
  help: string;
}

interface SettingsFieldsProps {
  /** Prefix that keeps ids unique when several forms are on the page. */
  idPrefix?: string;
  fields: FieldMeta[];
  values: Record<string, number>;
  /** Called with the complete set of values each time every field is valid. */
  onValid: (values: Record<string, number>) => void;
  disabled?: boolean;
  /** Called when the fields become valid or invalid, so a form can hold back its save button. */
  onStatus?: (valid: boolean) => void;
}

function toDraft(values: Record<string, number>, fields: FieldMeta[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, String(values[field.key] ?? '')]));
}

/** The message for one field's text, or null when it is fine. */
export function fieldProblem(key: string, text: string): string | null {
  const rule = CONFIG_RULES.find((candidate) => candidate.key === key);
  if (text.trim() === '') return 'Enter a number.';
  const value = Number(text);
  if (!Number.isFinite(value)) return 'Enter a number.';
  if (!rule) return null;
  if (rule.integer && !Number.isInteger(value)) return `Use a whole number between ${rule.min} and ${rule.max}.`;
  if (value < rule.min || value > rule.max) return `Use a number between ${rule.min} and ${rule.max}.`;
  return null;
}

/**
 * Number fields for breaker settings. Typing never loses what was entered:
 * a value is passed up only when every field is valid, and anything wrong
 * is explained under its own field while the last valid values stay in use.
 */
export const SettingsFields: React.FC<SettingsFieldsProps> = ({ idPrefix, fields, values, onValid, disabled, onStatus }) => {
  const autoId = useId().replace(/:/g, '');
  const prefix = idPrefix ?? autoId;
  const [draft, setDraft] = useState(() => toDraft(values, fields));
  const committed = useRef(JSON.stringify(values));

  // Take new values from outside, for example from another tab or a loaded workspace.
  useEffect(() => {
    const incoming = JSON.stringify(values);
    if (incoming !== committed.current) {
      committed.current = incoming;
      setDraft(toDraft(values, fields));
    }
  }, [values, fields]);

  const problems = useMemo(() => {
    const out: Record<string, string> = {};
    for (const field of fields) {
      const problem = fieldProblem(field.key, draft[field.key] ?? '');
      if (problem) out[field.key] = problem;
    }
    if (!out.minCallsThreshold && !out.slidingWindowSize && 'minCallsThreshold' in draft && 'slidingWindowSize' in draft) {
      if (Number(draft.minCallsThreshold) > Number(draft.slidingWindowSize)) {
        out.minCallsThreshold = `Use at most the sliding window (${draft.slidingWindowSize}); the window could never hold enough calls.`;
      }
    }
    return out;
  }, [draft, fields]);

  const valid = Object.keys(problems).length === 0;
  useEffect(() => { onStatus?.(valid); }, [valid, onStatus]);

  const edit = (key: string, text: string) => {
    const next = { ...draft, [key]: text };
    setDraft(next);
    const clean = fields.every((field) => !fieldProblem(field.key, next[field.key] ?? ''));
    const crossProblem = 'minCallsThreshold' in next && 'slidingWindowSize' in next && Number(next.minCallsThreshold) > Number(next.slidingWindowSize);
    if (!clean || crossProblem) return;
    const out: Record<string, number> = { ...values };
    for (const field of fields) out[field.key] = Number(next[field.key]);
    committed.current = JSON.stringify(out);
    onValid(out);
  };

  return (
    <div className="settings-grid">
      {fields.map((field) => {
        const id = `${prefix}-${field.key}`;
        const problem = problems[field.key];
        return (
          <div className="field" key={field.key}>
            <div className="field-row">
              <label className="field-label" htmlFor={id}>{field.label}</label>
              <span className="field-unit">{field.unit}</span>
            </div>
            <input
              id={id}
              className="number-input"
              type="number"
              inputMode="decimal"
              step="any"
              value={draft[field.key] ?? ''}
              disabled={disabled}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-help ${id}-problem` : `${id}-help`}
              onChange={(event) => edit(field.key, event.target.value)}
            />
            <span id={`${id}-help`} className="field-help">{field.help}</span>
            <span id={`${id}-problem`} className="field-problem" role={problem ? 'alert' : undefined}>
              {problem ?? ''}
            </span>
          </div>
        );
      })}
    </div>
  );
};
