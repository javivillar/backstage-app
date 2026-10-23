/**
 * The conversation comes back from the browser on every turn (the backend keeps no state): check its shape and
 * size before it goes to a model.
 */
import type { Message, Part } from './model/types';

export const MAX_MESSAGES = 200;
export const MAX_QUESTION_CHARS = 8000;

function isPart(p: any): p is Part {
  if (!p || typeof p !== 'object') return false;
  switch (p.type) {
    case 'text':
      return typeof p.text === 'string';
    case 'tool_call':
      return typeof p.id === 'string' && typeof p.name === 'string' && !!p.input && typeof p.input === 'object';
    case 'tool_result':
      return typeof p.id === 'string' && typeof p.content === 'string';
    case 'opaque':
      return typeof p.provider === 'string';
    default:
      return false;
  }
}

export function parseHistory(raw: unknown): Message[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error('messages: not a list');
  if (raw.length > MAX_MESSAGES) throw new Error(`messages: more than ${MAX_MESSAGES}; start a new conversation`);
  return raw.map((m: any, i) => {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || !Array.isArray(m.parts) || !m.parts.every(isPart)) {
      throw new Error(`messages[${i}]: not a message`);
    }
    return { role: m.role, parts: m.parts } as Message;
  });
}
