// Round keys in the Calculus-doodlus layout, plus a note key:
//
//     7 8 9 % ✎
//     4 5 6 × ÷
//     1 2 3 + −
//     0 . ⌫ ═══

const PENCIL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20.5h16" stroke-linecap="round"/>'
  + '<path d="M14.6 4.6l3.3 3.3-8.6 8.6-4.3 1 1-4.3z" stroke-linejoin="round"/></svg>';
const DELETE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10.5a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H9L3 12z" stroke-linejoin="round"/>'
  + '<path d="M12 9.5l5 5M17 9.5l-5 5" stroke-linecap="round"/></svg>';

/** [action, label, style, spoken label]. Actions are "digit:7", "op:+", "point", "percent", "note", "equals", "backspace". */
function keys(decimalSeparator) {
  const digit = (n) => [`digit:${n}`, String(n), 'digit', String(n)];
  return [
    digit(7), digit(8), digit(9), ['percent', '%', 'fn', 'Percent'], ['note', PENCIL, 'fn', 'Add note'],
    digit(4), digit(5), digit(6), ['op:*', '×', 'op', 'Times'], ['op:/', '÷', 'op', 'Divide'],
    digit(1), digit(2), digit(3), ['op:+', '+', 'op', 'Plus'], ['op:-', '−', 'op', 'Minus'],
    digit(0), ['point', decimalSeparator, 'digit', 'Decimal point'],
    ['backspace', DELETE, 'digit backspace', 'Delete, hold to remove whole lines'],
    ['equals', '=', 'op wide', 'Equals'],
  ];
}

/**
 * Keys act the moment they're touched, so fast typing keeps up. Two exceptions:
 * ⌫ acts on release, because holding it clears the line, and ✎ acts on a full tap,
 * because iPhone only opens the keyboard from a tap.
 */
export function buildKeypad(container, { decimalSeparator, onKey }) {
  container.innerHTML = keys(decimalSeparator)
    .map(([action, label, style, spoken]) => `<button type="button" class="key ${style}" data-action="${action}" aria-label="${spoken}">${label}</button>`)
    .join('');
  for (const button of container.querySelectorAll('.key')) wire(button, onKey);
}

function wire(button, onKey) {
  const action = button.dataset.action;
  let holdTimer = null;
  let held = false;
  const release = () => {
    button.classList.remove('pressed');
    clearTimeout(holdTimer);
    holdTimer = null;
  };

  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    release();
    button.classList.add('pressed');
    button.setPointerCapture?.(event.pointerId);
    if (action === 'note') return;
    if (action === 'backspace') {
      held = false;
      holdTimer = setTimeout(() => {
        held = true;
        const repeat = () => {
          onKey('clear');
          holdTimer = setTimeout(repeat, 350);
        };
        repeat();
      }, 450);
      return;
    }
    onKey(action);
  });

  button.addEventListener('pointerup', (event) => {
    release();
    if (action !== 'backspace' || held) return;
    const box = button.getBoundingClientRect();
    const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    if (inside) onKey('backspace');
  });
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', release);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) release();
  });
  button.addEventListener('click', (event) => {
    // Keyboard and assistive-technology clicks have no pointer press.
    if (action === 'note' || event.detail === 0) onKey(action);
  });
}
