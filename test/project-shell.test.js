const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(projectDir, file), 'utf8');
const rendererFiles = [
  'renderer/state.js',
  'renderer/plan-2d.js',
  'renderer/scene-3d.js',
  'renderer/actions.js',
  'renderer/pdf.js',
  'renderer/project.js'
];

test('HTML shell loads renderer modules in the required order', () => {
  const html = read('index.html');
  const corePosition = html.indexOf('<script src="project-core.js"></script>');
  let previousPosition = corePosition;

  assert.match(html, /<link rel="stylesheet" href="styles\.css">/);
  assert.ok(corePosition >= 0, 'project-core.js is referenced');
  for (const file of rendererFiles) {
    const position = html.indexOf(`<script src="${file}"></script>`);
    assert.ok(position > previousPosition, `${file} loads in order`);
    assert.match(read(file), /^'use strict';/);
    previousPosition = position;
  }
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
  assert.doesNotMatch(html, /<script>(?:.|\n|\r)*?<\/script>/i);
});

test('Electron package includes every extracted renderer asset', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packagedFiles = packageJson.build.files;

  for (const file of ['index.html', 'styles.css', 'project-core.js', 'renderer/**/*.js']) {
    assert.ok(packagedFiles.includes(file), `${file} is included in Electron package`);
  }
});
