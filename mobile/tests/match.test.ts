import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findDishes } from '../src/match';

const menu = ['Chicken Biryani', 'Veg Biryani', 'Puneri Misal', 'Misal Pav', 'Paneer Butter Masala', 'Pav Bhaji', 'Amul Pav Bhaji', 'Butter Naan', 'Cold Coffee', 'Gulab Jamun', 'Masala Dosa', 'Jeera Rice']
  .map((name, id) => ({ id, name }));
const first = (s: string) => findDishes(s, menu)[0]?.name;

test('spoken or misspelt dish names find the right dish', () => {
  assert.equal(first('chin biryani'), 'Chicken Biryani');
  assert.equal(first('chicken biriyani'), 'Chicken Biryani');
  assert.equal(first('puneri misal'), 'Puneri Misal');
  assert.equal(first('poonery missal'), 'Puneri Misal');
  assert.equal(first('panir butter masala'), 'Paneer Butter Masala');
  assert.equal(first('pav baji'), 'Pav Bhaji');
  assert.equal(first('gulab jamoon'), 'Gulab Jamun');
  assert.equal(first('jira rice'), 'Jeera Rice');
  assert.equal(first('cold coffee'), 'Cold Coffee');
});

test('typing part of a name still works and unrelated words find nothing', () => {
  assert.equal(first('naan'), 'Butter Naan');
  assert.equal(first('dosa'), 'Masala Dosa');
  assert.equal(findDishes('pizza', menu).length, 0);
  assert.equal(findDishes('', menu).length, menu.length);
});
