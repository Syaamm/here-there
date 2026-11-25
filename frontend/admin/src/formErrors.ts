// Replaces the browser's own "Please fill out this field" bubble with a message under the field, for every form in the console.
const CLASS = 'field-error';

function holder(el: HTMLElement): HTMLElement {
  return (el.closest('label') as HTMLElement | null) ?? (el.parentElement as HTMLElement);
}

function clear(el: HTMLElement) {
  el.removeAttribute('aria-invalid');
  holder(el).querySelectorAll(`:scope > .${CLASS}`).forEach((n) => n.remove());
}

function show(el: HTMLElement, text: string) {
  const box = holder(el);
  box.querySelectorAll(`:scope > .${CLASS}`).forEach((n) => n.remove());
  const msg = document.createElement('span');
  msg.className = CLASS;
  msg.setAttribute('role', 'alert');
  msg.textContent = text;
  box.appendChild(msg);
  el.setAttribute('aria-invalid', 'true');
}

export function installFormErrors() {
  document.addEventListener(
    'invalid',
    (e) => {
      e.preventDefault(); // no browser bubble
      const el = e.target as HTMLInputElement;
      const text = el.validationMessage || 'This field is required';
      show(el, text.charAt(0).toUpperCase() + text.slice(1));
      const form = el.form;
      // focus the first invalid field only
      if (form && form.querySelector(':invalid') === el) el.focus({ preventScroll: false });
    },
    true,
  );
  const fix = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (el && el.willValidate && el.validity?.valid) clear(el);
  };
  document.addEventListener('input', fix, true);
  document.addEventListener('change', fix, true);
}
