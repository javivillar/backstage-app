/**
 * The BPMN model of a business process (docs/business-map.md, "Process models"): a BPMN 2.0 file drawn with any
 * modelling tool, kept next to the process in refresquito-services so a new installation loads it and every change
 * is a pull request:
 *
 *   catalog/business-map/<customer>/bpmn/<process>.bpmn
 *
 * The model is attached to the process it is imported for: the identifier inside the file does not have to match.
 * It is a picture of how the process is done; it is not deployed to the process engine from here.
 */

export class BpmnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BpmnError';
  }
}

const NAME = /^[a-z0-9]([-a-z0-9.]{0,61}[a-z0-9])?$/;
export const MAX_BPMN_BYTES = 2 * 1024 * 1024;
const BPMN_NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';

export const bpmnPath = (namespace: string, process: string) => `catalog/business-map/${namespace}/bpmn/${process}.bpmn`;

/** namespace and process as names, or what is wrong. */
export function readTarget(namespace: unknown, process: unknown): { namespace: string; process: string } {
  const ns = typeof namespace === 'string' ? namespace.trim() : '';
  const p = typeof process === 'string' ? process.trim() : '';
  if (!NAME.test(ns) || !NAME.test(p)) throw new BpmnError('namespace and process are names: lowercase letters, digits and "-".');
  return { namespace: ns, process: p };
}

export type BpmnSummary = { name?: string; id?: string; tasks: number; lanes: string[] };

const attr = (tag: string | undefined, name: string): string | undefined => (tag === undefined ? undefined : new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag)?.slice(2).find(v => v !== undefined));
const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');

/**
 * What a BPMN 2.0 file says of itself, or why it is not one: the definitions of the BPMN namespace with at least one
 * process and its diagram (without the diagram there is nothing to draw). Not a full validation: the viewer of the
 * console draws it and says what it could not.
 */
export function readBpmn(xml: unknown): { xml: string; summary: BpmnSummary } {
  if (typeof xml !== 'string' || !xml.trim()) throw new BpmnError('The file is empty.');
  if (Buffer.byteLength(xml, 'utf8') > MAX_BPMN_BYTES) throw new BpmnError(`The file is larger than ${MAX_BPMN_BYTES / 1024 / 1024} MB.`);
  // without the byte order mark some tools write first
  const text = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new BpmnError('The file declares a DOCTYPE or entities: export it again as plain BPMN 2.0 XML.');
  const root = /<([A-Za-z_][\w.-]*:)?definitions\b[^>]*>/.exec(text);
  if (!root || !text.includes(BPMN_NS)) throw new BpmnError('The file is not BPMN 2.0: it has no <definitions> of the BPMN namespace. Export it from the modelling tool as BPMN 2.0 XML.');
  const prefix = root[1] ?? '';
  const tag = (local: string) => new RegExp(`<${prefix}${local}\\b[^>]*>`, 'g');
  const processes = text.match(tag('process')) ?? [];
  if (!processes.length) throw new BpmnError('The file has no process.');
  if (!/<([A-Za-z_][\w.-]*:)?BPMNDiagram\b/.test(text)) throw new BpmnError('The file has no diagram (BPMNDiagram): there is nothing to draw. Save it from a modelling tool, not as a bare process definition.');
  const participant = (text.match(tag('participant')) ?? [])[0];
  const name = (participant && attr(participant, 'name')) || attr(processes[0], 'name');
  const tasks = (text.match(new RegExp(`<${prefix}(userTask|serviceTask|task|manualTask|sendTask|receiveTask|scriptTask|businessRuleTask|callActivity|subProcess)\\b`, 'g')) ?? []).length;
  const lanes = (text.match(tag('lane')) ?? []).map(l => attr(l, 'name')).filter((n): n is string => !!n).map(unescape);
  return { xml: text, summary: { name: name ? unescape(name) : undefined, id: attr(processes[0], 'id'), tasks, lanes } };
}

/** The title and the text of the pull request that adds or replaces the model of a process. */
export function bpmnPull(target: { namespace: string; process: string }, title: string, summary: BpmnSummary, o: { by: string; fileName?: string; replaces: boolean }): { title: string; body: string } {
  const path = bpmnPath(target.namespace, target.process);
  return {
    title: `business map: BPMN model of ${title} (${target.namespace})`,
    body: [
      `${o.replaces ? 'Replaces' : 'Adds'} the BPMN model of the business process **${title}** of ${target.namespace}, imported from the console by ${o.by}${o.fileName ? ` from \`${o.fileName}\`` : ''}.`,
      '',
      `- File: \`${path}\``,
      `- ${summary.tasks} step(s)${summary.lanes.length ? `, lanes: ${summary.lanes.join(', ')}` : ', no lanes'}`,
      ...(summary.name ? [`- The file names its process "${summary.name}"`] : []),
      '',
      'Once merged, the page of the process shows the model. It is a picture of how the process is done: nothing is deployed to the process engine.',
    ].join('\n'),
  };
}
