"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

test("pwa manifest points at icons and does not request a start url outside the site", function () {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "DueTrail");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#17211b");
  assert.equal(manifest.start_url, "./");
  assert.ok(manifest.icons.length >= 2);
  manifest.icons.forEach(function (icon) {
    assert.equal(fs.existsSync(path.join(root, icon.src)), true, icon.src);
    assert.equal(icon.src.includes("http"), false);
  });
});

test("service worker stays on this origin and does not cache invoice uploads", function () {
  const source = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.match(source, /request\.method !== "GET"/);
  assert.match(source, /url\.origin !== self\.location\.origin/);
  assert.match(source, /networkFirst/);
  assert.equal(source.includes("checkout"), false);
  assert.equal(source.includes("stripe"), false);
});
