import { setIcon } from 'obsidian';

export function el<K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const node = parent.ownerDocument.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  parent.append(node); return node;
}
export function icon(parent: HTMLElement, name: string, cls = ''): HTMLElement {
  const node = el(parent, 'span', `ill-icon ${cls}`); node.setAttribute('aria-hidden', 'true'); setIcon(node, name); return node;
}
export function button(parent: HTMLElement, text: string, action: () => void, cls = '', symbol?: string): HTMLButtonElement {
  const node = el(parent, 'button', `ill-btn ${cls}`); node.type = 'button';
  if (symbol) icon(node, symbol);
  el(node, 'span', '', text); node.addEventListener('click', action); return node;
}
export function iconButton(parent: HTMLElement, name: string, label: string, action: () => void): HTMLButtonElement {
  const node = button(parent, '', action, 'ill-icon-btn', name); node.setAttribute('aria-label', label); node.title = label; return node;
}
let fieldIndex = 0;
export function field(parent: HTMLElement, label: string, hint = ''): HTMLElement {
  const group = el(parent, 'div', 'ill-field');
  const title = el(group, 'label', 'ill-label', label); const id = `ill-field-${++fieldIndex}`; title.htmlFor = id; group.dataset.fieldId = id;
  if (hint) el(group, 'span', 'ill-hint', hint);
  return group;
}
export function input(parent: HTMLElement, label: string, value = '', type = 'text', placeholder = ''): HTMLInputElement {
  const group = field(parent, label); const node = el(group, 'input', 'ill-input'); node.id = group.dataset.fieldId!; node.type = type; node.value = value; node.placeholder = placeholder; return node;
}
export function textarea(parent: HTMLElement, label: string, value = '', placeholder = ''): HTMLTextAreaElement {
  const group = field(parent, label); const node = el(group, 'textarea', 'ill-input'); node.id = group.dataset.fieldId!; node.rows = 3; node.value = value; node.placeholder = placeholder; return node;
}
export function select(parent: HTMLElement, label: string, options: readonly (string | [string, string])[], value = ''): HTMLSelectElement {
  const group = field(parent, label); const node = el(group, 'select', 'ill-input'); node.id = group.dataset.fieldId!;
  fillOptions(node, options, value); return node;
}
export function fillOptions(node: HTMLSelectElement, options: readonly (string | [string, string])[], value = ''): void {
  node.replaceChildren(); for (const option of options) { const [val, label] = typeof option === 'string' ? [option, option] : option; const item = el(node, 'option', '', label); item.value = val; }
  if ([...node.options].some(option => option.value === value)) node.value = value;
}
export function emptyState(parent: HTMLElement, title: string, description: string, symbol = 'notebook-pen'): HTMLElement {
  const node = el(parent, 'div', 'ill-empty'); icon(node, symbol); el(node, 'h3', '', title); el(node, 'p', '', description); return node;
}
export function shortPath(path: string): string { return path.split('/').pop()?.replace(/\.md$/, '') || path; }
