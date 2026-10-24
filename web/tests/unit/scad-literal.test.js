import test from "node:test";
import assert from "node:assert/strict";

import {
  callArgs,
  defineArgs,
  scadIdentifier,
  scadLiteral,
  scadSafeText,
} from "../../src/lib/scadLiteral.js";

test("scalars come out as OpenSCAD literals", () => {
  assert.equal(scadLiteral(true), "true");
  assert.equal(scadLiteral(false), "false");
  assert.equal(scadLiteral(1.5), "1.5");
  assert.equal(scadLiteral(-0), "0");
  assert.equal(scadLiteral(null), "undef");
  assert.equal(scadLiteral(undefined), "undef");
});

test("strings escape quotes and backslashes, and keep line breaks as escapes", () => {
  assert.equal(scadLiteral('a"b'), '"a\\"b"');
  assert.equal(scadLiteral("a\\b"), '"a\\\\b"');
  assert.equal(scadLiteral("a\nb\tc\rd"), '"a\\nb\\tc\\rd"');
  // Non-ASCII stays as it is: OpenSCAD reads UTF-8 source.
  assert.equal(scadLiteral("Größe ✓"), '"Größe ✓"');
});

test("control characters OpenSCAD has no escape for are dropped, lone surrogates replaced", () => {
  // JSON.stringify would write these as \b, \f, \u0001 and \u007f-less
  // DEL — escapes OpenSCAD's lexer doesn't read.
  assert.equal(scadLiteral("a\bb\fc\u0001d\u007fe"), '"abcde"');
  assert.equal(scadLiteral("x\ud800y"), '"x�y"');
  // A well-formed pair is one character and stays.
  assert.equal(scadLiteral("😀"), '"😀"');
  assert.equal(scadSafeText("ok\u0000"), "ok");
});

test("NaN and Infinity throw instead of becoming an unknown variable", () => {
  assert.throws(() => scadLiteral(NaN), /Cannot pass NaN/);
  assert.throws(() => scadLiteral(Infinity), /Cannot pass Infinity/);
  assert.throws(() => scadLiteral([1, -Infinity]), /Cannot pass -Infinity/);
});

test("arrays nest", () => {
  assert.equal(scadLiteral([1, [2, "x"], [], true]), '[1, [2, "x"], [], true]');
});

test("objects and other values without a literal throw", () => {
  assert.throws(() => scadLiteral({ a: 1 }), /structured value/);
  assert.throws(() => scadLiteral([{}]), /structured value/);
  assert.throws(() => scadLiteral(() => 1), /function/);
  assert.throws(() => scadLiteral(1n), /bigint/);
});

test("callArgs and defineArgs write identifier keys, including $-variables and constants", () => {
  assert.equal(callArgs({ w: 40, label: 'a"b', $fn: 32 }), 'w=40, label="a\\"b", $fn=32');
  assert.equal(callArgs(undefined), "");
  assert.deepEqual(defineArgs({ FIT_CLEARANCE: 0.2, part: "c1" }), [
    "-D",
    "FIT_CLEARANCE=0.2",
    "-D",
    'part="c1"',
  ]);
});

test("a key that isn't an identifier is refused, not pasted into the source", () => {
  for (const key of ["x=1);evil(", "a b", "1abc", "", 'a"', "a\nb", "a-b"]) {
    assert.throws(() => callArgs({ [key]: 1 }), /isn't a valid OpenSCAD parameter name/, key);
    assert.throws(() => defineArgs({ [key]: 1 }), /isn't a valid OpenSCAD parameter name/, key);
  }
  assert.equal(scadIdentifier("_private2"), "_private2");
});

test("a lone surrogate is replaced, a pair kept — without lookbehind (Safari before 16.4)", () => {
  assert.equal(scadSafeText("a\ud83db"), "a�b");
  assert.equal(scadSafeText("a\ude00b"), "a�b");
  assert.equal(scadSafeText("\ud83d"), "�");
  assert.equal(scadSafeText("😀 ok 😀"), "😀 ok 😀");
  assert.equal(scadSafeText("\ude00\ud83d"), "��");
});
