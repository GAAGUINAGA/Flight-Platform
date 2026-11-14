import 'vitest';

interface DomMatchers<R = unknown> {
  toBeInTheDocument(): R;
  toHaveTextContent(expected: string | RegExp): R;
  toHaveAttribute(name: string, value?: string): R;
  toHaveValue(value: string): R;
  toHaveFocus(): R;
  toBeChecked(): R;
  toBeDisabled(): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends DomMatchers<T> {}
}
