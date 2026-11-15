// Routine view: add, rename, remove, reorder and move the selected person's sessions
// and exercises, and edit targets, rest times and notes.
//
// app.js re-renders the whole view after every store change. The open edit form and the
// session name being edited live in module state (`form`, `nameEdit`) with their draft
// values, so a re-render rebuilds them as they were, including focus and cursor.
import { state, saveSession, saveExercise, saveExercises } from '../store.js';

const KINDS = [['weight', 'Weight'], ['timed', 'Timed'], ['info', 'Info']];
const WEEKS = [['both', 'Both'], ['A', 'A'], ['B', 'B']];

// form: { exerciseId: string|null (null = new), draft, original } ; nameEdit: { sessionId: string|'new', value }
let form = null;
let nameEdit = null;
let lastPersonId = null;

// ---- Helpers ----

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick, label) {
  const b = el('button', className, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

const byPosition = (a, b) => a.position - b.position;
const personSessions = personId =>
  state.sessions.filter(s => s.person_id === personId && !s.archived).sort(byPosition);
const sessionExercises = sessionId =>
  state.exercises.filter(e => e.session_id === sessionId && !e.archived).sort(byPosition);
const nextPosition = rows => rows.reduce((max, r) => Math.max(max, r.position), -1) + 1;

// Swap positions with the neighbour; the lists compared are non-archived siblings only.
function swapPositions(a, b) {
  return [{ ...a, position: b.position }, { ...b, position: a.position }];
}

function moveSession(sessions, index, delta) {
  const other = sessions[index + delta];
  if (!other) return;
  const [a, b] = swapPositions(sessions[index], other);
  saveSession(a);
  saveSession(b);
}

function moveExercise(exercises, index, delta) {
  const other = exercises[index + delta];
  if (!other) return;
  saveExercises(swapPositions(exercises[index], other));
}

// ---- Form draft <-> exercise ----

function draftFrom(exercise, sessionId) {
  if (!exercise) {
    return {
      name: '', kind: 'weight', target: '', target_b: '', minutes: '', seconds: '',
      notes: '', week: 'both', session_id: sessionId,
    };
  }
  const rest = exercise.rest_seconds;
  return {
    name: exercise.name,
    kind: exercise.kind,
    target: exercise.target ?? '',
    target_b: exercise.target_b ?? '',
    minutes: rest ? String(Math.floor(rest / 60)) : '',
    seconds: rest ? String(rest % 60) : '',
    notes: exercise.notes ?? '',
    week: exercise.week || 'both',
    session_id: exercise.session_id,
  };
}

// Returns { rest } or { error, field }.
function parseRest(draft) {
  const m = draft.minutes.trim();
  const s = draft.seconds.trim();
  if (!m && !s) return { rest: null };
  if (!/^\d*$/.test(m) || !/^\d*$/.test(s)) return { error: 'Rest time must be whole numbers.', field: 'minutes' };
  const rest = Number(m || 0) * 60 + Number(s || 0);
  return { rest: rest > 0 ? rest : null }; // 0 means no rest time
}

function openForm(exerciseId, draft) {
  return { exerciseId, draft, original: JSON.stringify(draft), error: null };
}

const formChanged = () => Boolean(form) && JSON.stringify(form.draft) !== form.original;

// Before replacing or closing an open form with unsaved edits, ask.
const mayDiscardForm = () => !formChanged() || confirm('Discard unsaved changes?');

function saveForm() {
  const { draft, exerciseId } = form;
  const name = draft.name.trim();
  if (!name) {
    form.error = { text: 'Give the exercise a name.', field: 'name' };
    return refresh();
  }
  const rest = parseRest(draft);
  if (rest.error) {
    form.error = { text: rest.error, field: rest.field };
    return refresh();
  }
  const existing = exerciseId ? state.exercises.find(e => e.id === exerciseId) : null;
  const movedSession = !existing || existing.session_id !== draft.session_id;
  const siblings = state.exercises.filter(e => e.session_id === draft.session_id && !e.archived);
  const row = {
    ...(existing ?? { id: crypto.randomUUID(), archived: false }),
    session_id: draft.session_id,
    name,
    kind: draft.kind,
    target: draft.target.trim(),
    target_b: draft.target_b.trim() || null,
    rest_seconds: rest.rest,
    notes: draft.notes.trim(),
    week: draft.week,
    position: movedSession ? nextPosition(siblings) : existing.position,
  };
  form = null;
  saveExercise(row);
}

function removeExercise(exercise) {
  if (!confirm(`Remove ${exercise.name}? Past entries are kept.`)) return;
  form = null;
  saveExercise({ ...exercise, archived: true });
}

function removeSession(session) {
  const count = sessionExercises(session.id).length;
  const extra = count ? ` Its ${count} exercise${count === 1 ? '' : 's'} will be hidden too.` : '';
  if (!confirm(`Remove ${session.name}?${extra}`)) return;
  if (form && state.exercises.find(e => e.id === form.exerciseId)?.session_id === session.id) form = null;
  saveSession({ ...session, archived: true });
}

function saveSessionName(personId) {
  const name = nameEdit.value.trim();
  if (!name) {
    nameEdit.error = true;
    return refresh();
  }
  const { sessionId } = nameEdit;
  nameEdit = null;
  if (sessionId === 'new') {
    saveSession({
      id: crypto.randomUUID(), person_id: personId, name, archived: false,
      position: nextPosition(state.sessions.filter(s => s.person_id === personId && !s.archived)),
    });
  } else {
    const session = state.sessions.find(s => s.id === sessionId);
    if (session) saveSession({ ...session, name });
    else refresh();
  }
}

// ---- Rendering ----

let view = null;

function refresh() {
  if (view) render(view.container, view);
}

function textField(label, key, opts = {}) {
  const wrap = el('label', `field${opts.className ? ` ${opts.className}` : ''}`);
  const input = el(opts.multiline ? 'textarea' : 'input', 'input');
  if (!opts.multiline) input.type = 'text';
  if (opts.multiline) input.rows = 3;
  if (opts.mode) input.inputMode = opts.mode;
  if (opts.mode === 'numeric') input.pattern = '[0-9]*';
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.autocomplete = 'off';
  input.dataset.field = key;
  input.value = form.draft[key];
  if (form.error?.field === key) input.setAttribute('aria-invalid', 'true');
  input.addEventListener('input', () => {
    form.draft[key] = input.value;
    input.removeAttribute('aria-invalid');
  });
  wrap.append(el('span', 'field-label', label), input);
  return wrap;
}

function choice(label, key, options) {
  const wrap = el('div', 'field');
  wrap.append(el('span', 'field-label', label));
  const seg = el('div', 'segmented rt-seg');
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', label);
  for (const [value, text] of options) {
    const b = button('seg', text, () => {
      form.draft[key] = value;
      refresh();
    });
    b.dataset.field = `${key}:${value}`;
    b.setAttribute('aria-pressed', String(form.draft[key] === value));
    seg.append(b);
  }
  wrap.append(seg);
  return wrap;
}

function sessionSelect(sessions) {
  const wrap = el('label', 'field');
  const select = el('select', 'input');
  select.dataset.field = 'session_id';
  for (const s of sessions) {
    const o = el('option', '', s.name);
    o.value = s.id;
    select.append(o);
  }
  select.value = form.draft.session_id;
  select.addEventListener('change', () => { form.draft.session_id = select.value; });
  wrap.append(el('span', 'field-label', 'Session'), select);
  return wrap;
}

function renderForm(sessions, exercise) {
  const node = el('form', 'rt-form');
  node.noValidate = true;
  node.addEventListener('submit', e => {
    e.preventDefault();
    saveForm();
  });
  const rest = el('div', 'field');
  const restRow = el('div', 'rt-rest');
  restRow.append(
    textField('Minutes', 'minutes', { mode: 'numeric', placeholder: '0' }),
    textField('Seconds', 'seconds', { mode: 'numeric', placeholder: '0' }),
  );
  rest.append(el('span', 'field-label', 'Rest time (leave blank for none)'), restRow);

  const actions = el('div', 'rt-actions');
  const save = el('button', 'btn btn-primary', 'Save');
  save.type = 'submit';
  actions.append(save, button('btn', 'Cancel', () => { form = null; refresh(); }));
  node.append(
    textField('Name', 'name'),
    choice('Type', 'kind', KINDS),
    textField('Target', 'target', { placeholder: 'e.g. 5×5' }),
    textField('Week B target (optional)', 'target_b'),
    rest,
    textField('Notes', 'notes', { multiline: true }),
    choice('Week', 'week', WEEKS),
    sessionSelect(sessions),
  );
  if (form.error) {
    const err = el('p', 'form-error', form.error.text);
    err.setAttribute('role', 'alert');
    node.append(err);
  }
  node.append(actions);
  if (exercise) {
    node.append(button('btn rt-remove', 'Remove exercise', () => removeExercise(exercise)));
  }
  return node;
}

function iconButton(text, label, onClick, disabled) {
  const b = button('btn btn-icon rt-arrow', text, onClick, label);
  b.disabled = disabled;
  return b;
}

function exerciseRow(exercise, index, list, sessions) {
  const li = el('li', 'rt-ex');
  const open = form?.exerciseId === exercise.id;
  const row = el('div', 'rt-ex-row');
  const main = button('rt-ex-main', '', () => {
    if (!mayDiscardForm()) return;
    form = open ? null : openForm(exercise.id, draftFrom(exercise));
    refresh();
  });
  main.setAttribute('aria-expanded', String(open));
  main.append(el('span', 'rt-ex-name', exercise.name));
  const bits = [exercise.target, exercise.week !== 'both' ? `(week ${exercise.week} only)` : ''].filter(Boolean);
  if (bits.length) main.append(el('span', 'rt-ex-target', bits.join('  ')));
  row.append(
    main,
    iconButton('↑', `Move ${exercise.name} up`, () => moveExercise(list, index, -1), index === 0),
    iconButton('↓', `Move ${exercise.name} down`, () => moveExercise(list, index, 1), index === list.length - 1),
  );
  li.append(row);
  if (open) li.append(renderForm(sessions, exercise));
  return li;
}

function sessionHead(session, index, sessions, personId) {
  const top = el('div', 'rt-session-top');
  if (nameEdit?.sessionId === session.id) {
    top.append(renderNameForm(personId));
    return top;
  }
  const head = el('div', 'rt-session-head');
  head.append(
    el('h2', 'card-title rt-session-name', session.name),
    iconButton('↑', `Move ${session.name} up`, () => moveSession(sessions, index, -1), index === 0),
    iconButton('↓', `Move ${session.name} down`, () => moveSession(sessions, index, 1), index === sessions.length - 1),
  );
  const tools = el('div', 'rt-session-tools');
  tools.append(
    button('btn btn-quiet', 'Rename', () => {
      nameEdit = { sessionId: session.id, value: session.name, fresh: true };
      refresh();
    }, `Rename ${session.name}`),
    button('btn btn-quiet rt-danger', 'Remove', () => removeSession(session), `Remove ${session.name}`),
  );
  top.append(head, tools);
  return top;
}

function renderNameForm(personId) {
  const node = el('form', 'rt-name-form');
  node.noValidate = true;
  const input = el('input', 'input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.dataset.field = 'sessionName';
  input.setAttribute('aria-label', 'Session name');
  input.value = nameEdit.value;
  if (nameEdit.fresh) {
    nameEdit.fresh = false;
    queueMicrotask(() => input.focus());
  }
  if (nameEdit.error) input.setAttribute('aria-invalid', 'true');
  input.addEventListener('input', () => {
    nameEdit.value = input.value;
    nameEdit.error = false;
    input.removeAttribute('aria-invalid');
  });
  const save = el('button', 'btn btn-primary', 'Save');
  save.type = 'submit';
  node.append(input, save, button('btn', 'Cancel', () => { nameEdit = null; refresh(); }));
  node.addEventListener('submit', e => {
    e.preventDefault();
    saveSessionName(personId);
  });
  return node;
}

function sessionCard(session, index, sessions, personId) {
  const card = el('section', 'card rt-session');
  card.append(sessionHead(session, index, sessions, personId));
  const list = sessionExercises(session.id);
  if (list.length) {
    const ul = el('ul', 'rt-list');
    list.forEach((ex, i) => ul.append(exerciseRow(ex, i, list, sessions)));
    card.append(ul);
  } else {
    card.append(el('p', 'rt-empty muted', 'No exercises yet.'));
  }
  const adding = form && form.exerciseId === null && form.draft.session_id === session.id;
  if (adding) {
    const wrap = el('div', 'rt-new');
    wrap.append(renderForm(sessions, null));
    card.append(wrap);
  } else {
    card.append(button('btn btn-block rt-add', '+ Add exercise', () => {
      if (!mayDiscardForm()) return;
      form = openForm(null, draftFrom(null, session.id));
      refresh();
    }));
  }
  return card;
}

function captureFocus(root) {
  const active = document.activeElement;
  if (!active || !root.contains(active) || !active.dataset.field) return null;
  return {
    field: active.dataset.field,
    start: active.selectionStart ?? null,
    end: active.selectionEnd ?? null,
  };
}

function restoreFocus(root, saved) {
  if (!saved) return;
  const target = [...root.querySelectorAll('[data-field]')].find(n => n.dataset.field === saved.field);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (saved.start !== null) {
    try { target.setSelectionRange(saved.start, saved.end); } catch { /* not a text field */ }
  }
}

export function render(container, { personId }) {
  view = { container, personId };
  if (personId !== lastPersonId) {
    form = null;
    nameEdit = null;
    lastPersonId = personId;
  }
  // Drop an open form whose exercise vanished (archived elsewhere).
  if (form?.exerciseId && !state.exercises.some(e => e.id === form.exerciseId && !e.archived)) form = null;

  const saved = captureFocus(container);
  const sessions = personSessions(personId);
  // Drop a session-name edit whose session vanished (removed elsewhere).
  if (nameEdit && nameEdit.sessionId !== 'new' && !sessions.some(s => s.id === nameEdit.sessionId)) nameEdit = null;
  // Likewise a new-exercise form whose session vanished (it could no longer be shown).
  if (form && form.exerciseId === null && !sessions.some(s => s.id === form.draft.session_id)) form = null;
  const root = el('div', 'routine stack');
  if (!state.people.some(p => p.id === personId)) {
    root.append(el('p', 'placeholder', 'Pick a person first.'));
  } else {
    if (!sessions.length) root.append(el('p', 'rt-empty muted', 'No sessions yet. Add the first one below.'));
    sessions.forEach((s, i) => root.append(sessionCard(s, i, sessions, personId)));
    if (nameEdit?.sessionId === 'new') {
      const card = el('section', 'card rt-session');
      card.append(renderNameForm(personId));
      root.append(card);
    } else {
      root.append(button('btn btn-block rt-add', '+ Add session', () => {
        nameEdit = { sessionId: 'new', value: '', fresh: true };
        refresh();
      }));
    }
  }
  container.replaceChildren(root);
  restoreFocus(container, saved);
}
