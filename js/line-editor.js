// Edit a line already on the tape. Every change recalculates the page live underneath.

import * as tape from './tape.js';
import { NumberFormat } from './number-format.js';
import { escapeHTML } from './page-view.js';
import { ICONS, openSheet } from './ui.js';

const OPERATORS = [['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷']];

/**
 * Opens the editor on `store.editing`. The caller closes it when editing ends,
 * and calls `update()` after other changes so it stays in step.
 */
export function openLineEditor({ store, format, onDismiss }) {
  let ref = null;
  const { header, body, setTitle, close } = openSheet({
    title: 'Edit Line',
    trailing: '<button type="button" class="sheet-button bold" data-done>Done</button>',
    className: 'sheet-medium',
    onClose: onDismiss,
  });
  header.addEventListener('click', (event) => {
    if (event.target.closest('[data-done]')) store.endEditing();
  });

  const page = () => store.page(ref.pageID);
  const entry = () => (page() ? tape.entryOf(page(), ref.entryID) : null);

  function build() {
    ref = store.editing;
    const current = entry();
    setTitle(current?.kind === 'total' ? 'Total' : 'Edit Line');
    if (!current) {
      body.innerHTML = '<p class="sheet-empty">Line removed</p>';
    } else if (current.kind === 'line') {
      body.innerHTML = lineForm(current);
      wireLineForm();
    } else {
      body.innerHTML = totalForm();
    }
    update();
  }

  function lineForm(line) {
    // Numbers are edited without grouping separators.
    const plain = new NumberFormat({ ...format, groupingSeparator: '' });
    return '<div class="group">'
      + '<div class="cell"><div class="segmented" role="radiogroup" aria-label="Operation" data-operators></div></div>'
      + '<div class="cell amount-cell">'
      + `<input class="amount-input" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-label="Amount" value="${escapeHTML(plain.formatTyped(line.text))}">`
      + '<select class="kind-select" aria-label="Kind"><option value="number">Number</option><option value="percent">Percent</option></select>'
      + '</div>'
      + '<div class="cell invalid" data-invalid hidden>That isn\'t a number yet.</div>'
      + '</div>'
      + '<p class="group-footer" data-explanation></p>'
      + '<div class="group">'
      + `<button type="button" class="cell action" data-insert>${ICONS.insert}<span>Insert Line Below</span></button>`
      + `<button type="button" class="cell action" data-add-title>${ICONS.title}<span>Add Title</span></button>`
      + `<button type="button" class="cell action destructive" data-delete>${ICONS.trash}<span>Delete Line</span></button>`
      + '</div>';
  }

  function totalForm() {
    return '<div class="group">'
      + `<button type="button" class="cell action" data-add-title>${ICONS.title}<span>Add Title</span></button>`
      + `<button type="button" class="cell action destructive" data-delete>${ICONS.trash}<span>Remove Total</span></button>`
      + '</div>'
      + '<p class="group-footer">Lines after a total continue from it. Removing it joins them to the lines above.</p>';
  }

  function wireLineForm() {
    const amount = body.querySelector('.amount-input');
    const invalid = body.querySelector('[data-invalid]');
    amount.addEventListener('input', () => {
      const canonical = format.canonicalize(amount.value);
      invalid.hidden = canonical !== null || amount.value === '';
      if (canonical !== null && entry()?.text !== canonical) {
        store.updateLine(ref, (line) => { line.text = canonical; });
      }
    });
    amount.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') amount.blur();
    });
    body.querySelector('.kind-select').addEventListener('change', (event) => {
      store.updateLine(ref, (line) => { line.mode = event.target.value; });
    });
  }

  body.addEventListener('click', (event) => {
    const operator = event.target.closest('[data-op]');
    if (operator) {
      const op = operator.dataset.op === 'start' ? null : operator.dataset.op;
      store.updateLine(ref, (line) => { line.op = op; });
    } else if (event.target.closest('[data-insert]')) {
      const newID = store.insertLine(ref);
      if (newID) store.editInstead(newID);
    } else if (event.target.closest('[data-add-title]')) {
      const calculation = tape.calculationContaining(page(), ref.entryID);
      store.endEditing();
      if (calculation) store.beginTitle(ref.pageID, calculation.id);
    } else if (event.target.closest('[data-delete]')) {
      store.deleteEntry(ref);
      store.endEditing();
    }
  });

  /** Brings the sheet in step with the line, without touching the amount being typed. */
  function update() {
    if (store.editing && (store.editing.entryID !== ref.entryID || store.editing.pageID !== ref.pageID)) {
      build();
      return;
    }
    const current = entry();
    if (!current) {
      if (!body.querySelector('.sheet-empty')) body.innerHTML = '<p class="sheet-empty">Line removed</p>';
      return;
    }
    const calculation = tape.calculationContaining(page(), ref.entryID);
    body.querySelector('[data-add-title]')?.toggleAttribute('hidden', Boolean(calculation?.title));
    if (current.kind !== 'line') return;

    const showStart = tape.isFirstEntry(page(), ref.entryID) || current.op === null;
    const options = [...(showStart ? [['start', 'Start']] : []), ...OPERATORS];
    body.querySelector('[data-operators]').innerHTML = options.map(([op, label]) => {
      const selected = (current.op ?? 'start') === op;
      return `<button type="button" role="radio" aria-checked="${selected}" class="segment${selected ? ' selected' : ''}" data-op="${op}">${label}</button>`;
    }).join('');
    body.querySelector('.kind-select').value = current.mode;
    body.querySelector('[data-explanation]').textContent = explanation(current);
  }

  build();
  return { update, close };
}

function explanation(line) {
  if (line.mode === 'number') return 'Lines apply to the running total from top to bottom, like a paper tape.';
  if (line.op === '+' || line.op === '-') return 'Adds or takes off this percentage of the total above.';
  if (line.op === null) return 'Starts the calculation at this percentage (50% = 0.5).';
  return 'Multiplies or divides the total above by this percentage.';
}
