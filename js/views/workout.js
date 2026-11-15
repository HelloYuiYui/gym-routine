// Workout view. Placeholder until its own task replaces this body.
export function render(container, { personId }) {
  const p = document.createElement('p');
  p.className = 'placeholder';
  p.textContent = 'Workout view is not built yet.';
  container.replaceChildren(p);
}
