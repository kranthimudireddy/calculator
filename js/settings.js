import { THEMES, FONTS, savePrefs } from './prefs.js';
import { escapeHTML } from './page-view.js';
import { openSheet } from './ui.js';

export function openSettings({ prefs, format, onChange }) {
  const view = openSheet({ title: 'Settings', className: 'sheet-large', trailing: '<button class="sheet-button bold" data-done>Done</button>' });
  const choices = (key, values) => `<div class="segmented">${values.map(([value, label]) => `<button class="segment${String(prefs[key]) === value ? ' selected' : ''}" data-pref="${key}" data-value="${value}" aria-pressed="${String(prefs[key]) === value}">${label}</button>`).join('')}</div>`;
  function draw() {
    view.body.innerHTML = '<h3 class="settings-heading">Keypad colour</h3><div class="group theme-choices">'
      + Object.entries(THEMES).map(([key, theme]) => `<button data-pref="theme" data-value="${key}" aria-pressed="${prefs.theme === key}" class="theme-choice"><span style="background:${theme.panel};--swatch-op:${theme.opFill}"></span>${theme.name}</button>`).join('') + '</div>'
      + '<h3 class="settings-heading">Paper</h3><div class="group"><div class="cell">' + choices('paper', ['plain', 'lined', 'grid'].map(v => [v, v[0].toUpperCase() + v.slice(1)])) + '</div></div>'
      + '<h3 class="settings-heading">Handwriting</h3><div class="group">'
      + Object.entries(FONTS).map(([key, font]) => `<button class="cell" data-pref="font" data-value="${key}" aria-pressed="${prefs.font === key}"><span>${font.name}</span><span class="spacer"></span><span style="font-family:${escapeHTML(font.family)};font-size:24px">${escapeHTML(format.formatTyped('1234.56'))}</span><span class="settings-check">${prefs.font === key ? '✓' : ''}</span></button>`).join('')
      + '<div class="cell">' + choices('size', ['small', 'medium', 'large'].map(v => [v, v[0].toUpperCase() + v.slice(1)])) + '</div></div>'
      + '<h3 class="settings-heading">Numbers</h3><div class="group"><label class="cell">Round results to<span class="spacer"></span><select data-rounding class="kind-select">'
      + [0, 1, 2, 3, 4, 6, 8, 10].map(n => `<option value="${n}" ${prefs.decimals === n ? 'selected' : ''}>${n === 0 ? 'Whole numbers' : `${n} decimal${n === 1 ? '' : 's'}`}</option>`).join('')
      + '</select></label></div><p class="group-footer">Numbers you type stay exactly as typed. Totals and percentages are rounded, and the next line continues from the rounded total.</p>'
      + '<div class="group"><label class="cell">Key clicks (haptics)<span class="spacer"></span><input type="checkbox" data-haptics ' + (prefs.haptics ? 'checked' : '') + '></label></div><p class="group-footer">Haptics are available on browsers that support vibration.</p>';
  }
  const update = (key, value) => { prefs[key] = value; savePrefs(prefs); onChange(); draw(); };
  view.header.querySelector('[data-done]').addEventListener('click', view.close);
  view.body.addEventListener('click', event => { const button = event.target.closest('[data-pref]'); if (button) update(button.dataset.pref, button.dataset.value); });
  view.body.addEventListener('change', event => {
    if (event.target.matches('[data-rounding]')) update('decimals', Number(event.target.value));
    if (event.target.matches('[data-haptics]')) update('haptics', event.target.checked);
  });
  draw();
  return view;
}
