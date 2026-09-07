// Deterministic serialisation. Two implementations must agree byte for byte or
// nothing signed by one verifies against the other.
//
//   undefined fields are dropped
//   object keys are sorted
//   arrays keep their order
//   no whitespace

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
