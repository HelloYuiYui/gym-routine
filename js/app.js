// App shell: boot, sign-in, person picker, view switching, sync indicator.
import * as store from './store.js';
import * as workout from './views/workout.js';
import * as progress from './views/progress.js';
import * as routine from './views/routine.js';

const VIEWS = { workout, progress, routine };
const ADD_PERSON = '__add__';

const $ = id => document.getElementById(id);
const screens = { boot: $('boot'), signin: $('signin'), picker: $('picker'), shell: $('shell') };

let activeView = 'workout';
let started = false;
let authLost = false;
let addingPerson = false; // the picker was opened from the shell to add someone

function show(name) {
  for (const [key, el] of Object.entries(screens)) el.hidden = key !== name;
}

function knownPerson(id) {
  return store.state.people.some(p => p.id === id);
}

// ---- Rendering ----

function renderPersonSelect() {
  const select = $('person-select');
  const options = store.state.people.map(p => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    return o;
  });
  const add = document.createElement('option');
  add.value = ADD_PERSON;
  add.textContent = 'Add person…';
  select.replaceChildren(...options, add);
  select.value = store.currentPersonId() ?? '';
}

function renderPicker() {
  const items = store.state.people.map(p => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-choice btn-block';
    btn.textContent = p.name;
    btn.addEventListener('click', () => choosePerson(p.id));
    li.append(btn);
    return li;
  });
  $('picker-list').replaceChildren(...items);
}

function renderView() {
  const personId = store.currentPersonId();
  // The header's week slot holds the workout's session buttons and week toggle.
  if (activeView === 'workout') workout.renderHeader($('week-slot'), { personId });
  else $('week-slot').replaceChildren();
  for (const [name, mod] of Object.entries(VIEWS)) {
    const container = $(`view-${name}`);
    container.hidden = name !== activeView;
    if (name === activeView) mod.render(container, { personId });
  }
  for (const btn of document.querySelectorAll('.nav-btn')) {
    if (btn.dataset.view === activeView) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

// Re-render whichever screen is up after data, person or tab changes.
function render() {
  if (!started) return;
  const id = store.currentPersonId();
  if (addingPerson || !id || !knownPerson(id)) {
    renderPicker();
    show('picker');
    return;
  }
  renderPersonSelect();
  show('shell');
  renderView();
}

// ---- Sync indicator ----

let sync = { pending: 0, rejected: 0, storageFailed: false, loadError: false };

function renderSync() {
  const { pending, rejected, storageFailed, loadError } = sync;
  const el = $('sync');
  let text;
  let tone = 'ok';
  if (storageFailed) {
    text = 'Storage full — not saved on this phone';
    tone = 'error';
  } else if (rejected > 0) {
    text = `${rejected} not saved`;
    tone = 'error';
  } else if (store.localOnly) {
    text = 'Local only — not synced';
    tone = 'warn';
  } else if (loadError) {
    text = 'Could not load from the server';
    tone = 'error';
  } else if (pending === 0) {
    text = 'Synced';
  } else if (navigator.onLine) {
    text = `Syncing ${pending}…`;
    tone = 'busy';
  } else {
    text = `Offline — ${pending} saved on this phone`;
    tone = 'warn';
  }
  el.textContent = text;
  el.dataset.tone = tone;
}

// ---- Actions ----

function choosePerson(id) {
  addingPerson = false;
  store.setCurrentPerson(id);
  render();
}

// Stays open across store changes (and keeps the typed name) until a person is chosen.
function openAddPerson() {
  addingPerson = true;
  renderPicker();
  show('picker');
  $('add-person-form').elements.name.focus();
}

// Load from the cache, then the server. With `fromCache` the cached data is already in
// state and on screen, so nothing waits on the network.
async function start({ fromCache = false } = {}) {
  authLost = false;
  if (fromCache) {
    started = true;
    render();
  } else {
    show('boot');
  }
  await store.loadAll();
  if (authLost) return; // a 401 during the load put the sign-in form back up
  started = true;
  render();
  store.flush();
}

// ---- Events ----

$('signin-form').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.currentTarget;
  const error = $('signin-error');
  const button = form.querySelector('button[type="submit"]');
  error.hidden = true;
  button.disabled = true;
  const result = await store.signIn(form.elements.email.value.trim(), form.elements.password.value);
  button.disabled = false;
  if (result.error) {
    error.textContent = result.error;
    error.hidden = false;
    return;
  }
  form.reset();
  await start();
});

$('add-person-form').addEventListener('submit', e => {
  e.preventDefault();
  const input = e.currentTarget.elements.name;
  const name = input.value.trim();
  if (!name) return;
  input.value = '';
  const person = store.addPerson(name);
  choosePerson(person.id);
});

$('person-select').addEventListener('change', e => {
  if (e.target.value === ADD_PERSON) {
    e.target.value = store.currentPersonId() ?? '';
    openAddPerson();
  } else {
    choosePerson(e.target.value);
  }
});

for (const btn of document.querySelectorAll('.nav-btn')) {
  btn.addEventListener('click', () => {
    activeView = btn.dataset.view;
    renderView();
    window.scrollTo(0, 0);
  });
}

store.subscribe(render);
store.onSync(status => {
  sync = status;
  renderSync();
});
store.onAuthRequired(() => {
  authLost = true;
  started = false;
  show('signin');
});

window.addEventListener('online', () => {
  renderSync();
  store.flush();
});
window.addEventListener('offline', renderSync);

// Back in the app (maybe days later): re-render for today's date and pick up entries
// logged on the other phones.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  render();
  store.refreshIfStale(60000);
});

// ---- Boot ----

// The app shell (HTML, CSS, JS) is cached by sw.js so a cold open works with no signal.
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  navigator.serviceWorker.register('sw.js').catch(() => {
    // no service worker: the app still works online
  });
}

(async () => {
  if (store.canStartFromCache()) {
    // Render the cached routine and numbers at once; check the session and load in the background.
    store.loadFromCache();
    started = true;
    render();
    authLost = false;
    const signedIn = await store.getSession();
    if (authLost) return; // a write got a 401 meanwhile: the sign-in form is up
    if (signedIn) await start({ fromCache: true });
    else {
      started = false;
      show('signin');
    }
    return;
  }
  if (await store.getSession()) await start();
  else show('signin');
})();
