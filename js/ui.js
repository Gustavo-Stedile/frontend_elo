// Utilitários de DOM e componentes genéricos (diálogos, toasts).

const PROPS_DIRETAS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden', 'textContent']);

/** Cria elementos sem innerHTML (evita XSS com conteúdo vindo de usuários). */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (PROPS_DIRETAS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export function clear(el) {
  el.replaceChildren();
  return el;
}

export const PERMISSOES = {
  VER_CANAL: 'Ver canais',
  LER_HISTORICO: 'Ler histórico',
  ENVIAR_MENSAGENS: 'Enviar mensagens',
  GERENCIAR_MENSAGENS: 'Gerenciar mensagens',
  GERENCIAR_CANAIS: 'Gerenciar canais',
  GERENCIAR_CARGOS: 'Gerenciar cargos',
  GERENCIAR_MEMBROS: 'Gerenciar membros',
  GERENCIAR_GREMIO: 'Gerenciar grêmio',
  ADMINISTRADOR: 'Administrador',
};

export function initials(nome) {
  const partes = String(nome || '?').trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  const a = partes[0][0];
  const b = partes.length > 1 ? partes[partes.length - 1][0] : '';
  return (a + b).toUpperCase();
}

// Cor estável por id, para avatares.
const PALETA = ['#3d52ff', '#0f9d8a', '#d9480f', '#9c36b5', '#1c7ed6', '#c2255c', '#5c7c00', '#e8890c'];
export function colorFor(id) {
  return PALETA[Math.abs(Number(id) || 0) % PALETA.length];
}

export function formatTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const hoje = new Date();
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === hoje.toDateString()) return `Hoje às ${hora}`;
  const ontem = new Date(hoje);
  ontem.setDate(hoje.getDate() - 1);
  if (d.toDateString() === ontem.toDateString()) return `Ontem às ${hora}`;
  return `${d.toLocaleDateString('pt-BR')} ${hora}`;
}

export function formatDia(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
}

// ---------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------
export function toast(mensagem, tipo = 'info') {
  const area = document.getElementById('toasts');
  const el = h('div', { class: `toast ${tipo}`, role: tipo === 'error' ? 'alert' : 'status' }, mensagem);
  area.append(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3500);
}

// ---------------------------------------------------------------------
// Diálogos
// ---------------------------------------------------------------------

/** Abre um <dialog> com título e conteúdo livre. Devolve { dialog, close }. */
export function openModal(titulo, conteudo, { largo = false } = {}) {
  const dialog = h('dialog', { class: `modal${largo ? ' largo' : ''}` });
  const fechar = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Fechar', onclick: () => dialog.close() }, '×');
  dialog.append(h('header', { class: 'modal-head' }, h('h2', {}, titulo), fechar), conteudo);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // clique no backdrop
  });
  document.body.append(dialog);
  dialog.showModal();
  return { dialog, close: () => dialog.close() };
}

function campo(f) {
  const id = `f-${f.name}-${Math.random().toString(36).slice(2, 7)}`;
  let input;
  if (f.type === 'textarea') {
    input = h('textarea', { id, name: f.name, rows: 3, maxlength: f.max, placeholder: f.placeholder, value: f.value ?? '' });
  } else if (f.type === 'select') {
    input = h('select', { id, name: f.name }, f.options.map((o) => h('option', { value: o.value }, o.label)));
    if (f.value !== undefined) input.value = f.value;
  } else if (f.type === 'checks') {
    const marcados = new Set(f.value || []);
    input = h(
      'div',
      { class: 'checks', 'data-name': f.name },
      f.options.map((o) =>
        h('label', { class: 'check' }, h('input', { type: 'checkbox', value: o.value, checked: marcados.has(o.value) }), o.label)
      )
    );
    return h('div', { class: 'field' }, h('span', { class: 'field-label' }, f.label), input);
  } else {
    input = h('input', {
      id,
      name: f.name,
      type: f.type || 'text',
      value: f.value ?? '',
      placeholder: f.placeholder,
      minlength: f.min && f.type !== 'number' ? f.min : undefined,
      maxlength: f.max && f.type !== 'number' ? f.max : undefined,
      min: f.type === 'number' ? f.min : undefined,
      max: f.type === 'number' ? f.max : undefined,
      autocomplete: f.autocomplete || 'off',
    });
  }
  if (f.required) input.required = true;
  return h('div', { class: 'field' }, h('label', { for: id }, f.label), input);
}

function lerValores(form, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'checks') {
      out[f.name] = [...form.querySelectorAll(`[data-name="${f.name}"] input:checked`)].map((i) => i.value);
      continue;
    }
    const el = form.elements[f.name];
    let v = el.value;
    if (f.type === 'number') v = v === '' ? null : Number(v);
    else if (f.type !== 'password') v = v.trim();
    out[f.name] = v;
  }
  return out;
}

/**
 * Formulário em diálogo. `onSubmit(valores)` pode lançar erro: a mensagem
 * aparece no próprio diálogo. Resolve `true` se salvou, `false` se cancelou.
 */
export function formDialog({ titulo, texto, fields = [], enviar = 'Salvar', perigo = false, onSubmit }) {
  return new Promise((resolve) => {
    let ok = false;
    const erro = h('p', { class: 'form-error', role: 'alert', hidden: true });
    const botao = h('button', { type: 'submit', class: `btn ${perigo ? 'danger' : 'primary'}` }, enviar);
    const form = h(
      'form',
      {
        class: 'form',
        novalidate: false,
        onsubmit: async (e) => {
          e.preventDefault();
          erro.hidden = true;
          botao.disabled = true;
          try {
            await onSubmit(lerValores(form, fields));
            ok = true;
            modal.close();
          } catch (err) {
            erro.textContent = err.message || String(err);
            erro.hidden = false;
          } finally {
            botao.disabled = false;
          }
        },
      },
      texto ? h('p', { class: 'muted' }, texto) : null,
      fields.map(campo),
      erro,
      h(
        'div',
        { class: 'form-actions' },
        h('button', { type: 'button', class: 'btn ghost', onclick: () => modal.close() }, 'Cancelar'),
        botao
      )
    );
    const modal = openModal(titulo, form);
    modal.dialog.addEventListener('close', () => resolve(ok));
    const primeiro = form.querySelector('input:not([type=checkbox]), textarea, select');
    if (primeiro) primeiro.focus();
  });
}

export const confirmar = (titulo, texto, enviar = 'Confirmar') =>
  formDialog({ titulo, texto, enviar, perigo: true, onSubmit: async () => {} });
