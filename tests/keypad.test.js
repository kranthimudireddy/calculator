import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKeypad } from '../js/keypad.js';

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const handlers = new Map();
  const windowHandlers = new Map();
  globalThis.window = { addEventListener: (name, fn) => windowHandlers.set(name, fn) };
  globalThis.document = { addEventListener() {} };
  const button = {
    dataset: { action: 'backspace' },
    classList: { add() {}, remove() {} },
    setPointerCapture() {},
    addEventListener: (name, fn) => handlers.set(name, fn),
    getBoundingClientRect: () => ({left:0,right:100,top:0,bottom:100}),
  };
  const actions = [];
  buildKeypad({ set innerHTML(value) {}, querySelectorAll: () => [button] }, { decimalSeparator: '.', onKey: action => actions.push(action) });
  const event = { preventDefault() {}, pointerId:1, clientX:50, clientY:50 };
  return { actions, emit: name => handlers.get(name)(event), windowHandlers };
}

test('holding delete repeats whole-line deletion and stops on release', t => {
  const {actions,emit} = setup(t);
  emit('pointerdown');
  t.mock.timers.tick(449); assert.deepEqual(actions, []);
  t.mock.timers.tick(1); assert.deepEqual(actions, ['clear']);
  t.mock.timers.tick(350); assert.deepEqual(actions, ['clear','clear']);
  t.mock.timers.tick(350); assert.deepEqual(actions, ['clear','clear','clear']);
  emit('pointerup');
  t.mock.timers.tick(1000); assert.equal(actions.length, 3);
});

test('quick tap deletes one character', t => {
  const {actions,emit} = setup(t);
  emit('pointerdown'); t.mock.timers.tick(100); emit('pointerup');
  t.mock.timers.tick(1000); assert.deepEqual(actions, ['backspace']);
});

for (const cancel of ['pointercancel','lostpointercapture']) {
  test(`${cancel} stops hold deletion`, t => {
    const {actions,emit} = setup(t);
    emit('pointerdown'); t.mock.timers.tick(450); emit(cancel);
    t.mock.timers.tick(1000); assert.deepEqual(actions, ['clear']);
  });
}
