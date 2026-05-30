import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomId(prefix: string, size = 12): string {
  const bytes = randomBytes(size);
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}_${out}`;
}

export const newRunId = () => randomId('run');
export const newAppId = () => randomId('app');
export const newScreenId = () => randomId('sc');
export const newScreenStateId = () => randomId('st');
export const newPageStateId = () => randomId('ps');
export const newEdgeId = () => randomId('edge');
export const newEventId = () => randomId('ev');
