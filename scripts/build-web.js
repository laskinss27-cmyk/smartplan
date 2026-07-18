const fs = require('node:fs');
const path = require('node:path');

const projectDir = path.resolve(__dirname, '..');
const outputDir = path.join(projectDir, 'dist-web');
const staticFiles = [
  'styles.css',
  'project-core.js'
];
const rendererFiles = [
  'renderer/state.js',
  'renderer/plan-2d.js',
  'renderer/scene-3d.js',
  'renderer/actions.js',
  'renderer/pdf.js',
  'renderer/project.js'
];

if (path.dirname(outputDir) !== projectDir) {
  throw new Error('Unexpected web output directory');
}

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const sourceIndex = fs.readFileSync(path.join(projectDir, 'index.html'), 'utf8');
const rendererBlock = /<!-- renderer:start -->[\s\S]*?<!-- renderer:end -->/;
if (!rendererBlock.test(sourceIndex)) throw new Error('Renderer script block not found');

const webIndex = sourceIndex.replace(rendererBlock, '<script src="renderer.js"></script>');
const rendererBundle = rendererFiles
  .map((file) => fs.readFileSync(path.join(projectDir, file), 'utf8'))
  .join('\n');

fs.writeFileSync(path.join(outputDir, 'index.html'), webIndex, 'utf8');
fs.writeFileSync(path.join(outputDir, 'renderer.js'), rendererBundle, 'utf8');

for (const file of staticFiles) {
  fs.copyFileSync(path.join(projectDir, file), path.join(outputDir, file));
}
fs.cpSync(path.join(projectDir, 'assets'), path.join(outputDir, 'assets'), { recursive: true });

console.log(`SmartPlan web build: ${outputDir}`);
