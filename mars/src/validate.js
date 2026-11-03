'use strict';

// 最小 JSON Schema（draft-07 子集）校验器：无第三方依赖。
// 覆盖：type/required/properties/additionalProperties/items/enum/const/pattern/
//       minLength/maxLength/minimum/maximum/minItems/maxItems/uniqueItems/
//       format(date-time)/oneOf。不支持的：$ref/$defs（本仓库契约未使用）。
function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value, type) {
  const actual = typeOf(value);
  if (type === 'integer') return actual === 'number' && Number.isInteger(value);
  if (type === 'number') return actual === 'number';
  return actual === type;
}

function validate(value, schema, pointer = '$') {
  const errors = [];
  const push = (message) => errors.push({ path: pointer, message });

  if (!schema || typeof schema !== 'object') return { valid: true, errors };

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(t => matchesType(value, t))) {
      push(`expected type ${types.join('|')}, got ${typeOf(value)}`);
      return { valid: false, errors };
    }
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) {
    const passed = schema.oneOf.filter(sub => validate(value, sub, pointer).valid).length;
    if (passed !== 1) push('oneOf requires exactly one matching schema');
  }
  if (schema.const !== undefined && value !== schema.const) push(`expected const ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) push(`expected one of ${schema.enum.join(',')}`);
  if (typeof value === 'string' && schema.format === 'date-time') {
    const ok = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
    if (!ok) push('format date-time not met');
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) push(`minLength ${schema.minLength} not met`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) push(`maxLength ${schema.maxLength} exceeded`);
    if (schema.pattern !== undefined && !(new RegExp(schema.pattern).test(value))) push(`pattern ${schema.pattern} not met`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) push(`minimum ${schema.minimum} not met`);
    if (schema.maximum !== undefined && value > schema.maximum) push(`maximum ${schema.maximum} exceeded`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) push(`minItems ${schema.minItems} not met`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) push(`maxItems ${schema.maxItems} exceeded`);
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) { push('uniqueItems violated'); break; }
        seen.add(key);
      }
    }
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, i) => {
      const sub = validate(item, schema.items, `${pointer}[${i}]`);
      errors.push(...sub.errors);
    });
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {};
    for (const key of schema.required || []) {
      if (!(key in value)) push(`missing required property "${key}"`);
    }
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) {
        const child = validate(value[key], sub, `${pointer}.${key}`);
        errors.push(...child.errors);
      }
    }
    if (schema.additionalProperties !== undefined) {
      for (const key of Object.keys(value)) {
        if (key in props) continue;
        if (schema.additionalProperties === false) push(`additional property "${key}" not allowed`);
        else if (typeof schema.additionalProperties === 'object') {
          const child = validate(value[key], schema.additionalProperties, `${pointer}.${key}`);
          errors.push(...child.errors);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validate };
