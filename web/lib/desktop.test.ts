import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DESKTOP_MIN_WIDTH, DESKTOP_QUERY } from "./desktop.ts";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../app/globals.css"), "utf8");

test("desktop breakpoint is one 1024px value in JS and CSS", () => {
  assert.equal(DESKTOP_MIN_WIDTH, "1024px");
  assert.equal(DESKTOP_QUERY, "(min-width: 1024px)");
  assert.ok(Number.parseInt(DESKTOP_MIN_WIDTH, 10) > 1023);

  const theme = css.match(/--breakpoint-md:\s*([^;]+);/);
  assert.ok(theme);
  assert.equal(theme[1].trim(), DESKTOP_MIN_WIDTH);

  const layoutQueries = [...css.matchAll(/@media\s*\((min-width:\s*theme\(--breakpoint-md\))\)/g)];
  assert.equal(layoutQueries.length, 3);
  assert.doesNotMatch(css, /@media\s*\(\s*min-width:\s*\d+(?:px|rem)\s*\)/);
  assert.doesNotMatch(css, /64rem/);
});
