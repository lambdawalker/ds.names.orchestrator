import { expect, it } from 'vitest';
import { parseNames, parseCommand } from '../src/cli.js';
it('accepts string and contextual name inputs, preserves distinctions and validates the command', () => {
  expect(parseNames('["John",{"name":"Juan","language":"Spanish"}]')).toEqual([{ name: 'John' }, { name: 'Juan', language: 'Spanish' }]);
  expect(parseCommand(['run', '--names', 'names.json', '--config', 'config.json'])).toEqual({ command: 'run', names: 'names.json', config: 'config.json', retryStopped: false });
  expect(() => parseNames('[""]')).toThrow(); expect(() => parseNames('{}')).toThrow();
  expect(() => parseCommand(['run', '--surprise'])).toThrow();
});
