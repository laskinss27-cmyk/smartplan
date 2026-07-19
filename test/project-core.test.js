const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../project-core');

test('default wall thickness is 20 cm at every drawing scale', () => {
  for (const scale of [0.05, 0.1, 0.2, 0.25]) {
    const units = Core.defaultWallThicknessUnits(scale);
    assert.equal(Core.unitsToMeters(units, scale), 0.2);
  }
});

test('architectural scene preset has a scale-aware atmosphere', () => {
  const preset = Core.scenePresetConfig('architectural', 0.1);
  assert.equal(preset.id, 'architectural');
  assert.equal(preset.label, 'Архитектурный');
  assert.equal(preset.fov, 48);
  assert.equal(preset.fogDensity, 0.0008);
  assert.equal(preset.standardMaterials, true);
});

test('unknown scene presets safely fall back to the technical view', () => {
  const preset = Core.scenePresetConfig('unknown', 0.1);
  assert.equal(preset.id, 'technical');
  assert.equal(preset.label, 'Монтажный');
  assert.equal(preset.fov, 60);
  assert.equal(preset.fogDensity, 0);
  assert.equal(preset.standardMaterials, false);
});

test('changing scale preserves physical geometry and snap distance', () => {
  const project = {
    gs: 2.5,
    verts: [{ x: 10, y: 20 }],
    walls: [{ x1: 10, y1: 20, x2: 90, y2: 20, th: 2, h: 25 }],
    doors: [{ x1: 20, y1: 20, x2: 30, y2: 20, dh: 20 }],
    windows: [{ x1: 40, y1: 20, x2: 50, y2: 20, wh: 14, sill: 9 }],
    equip: [{ x: 45, y: 20, h3: 15, fovD: 50 }],
    measures: [{ x1: 0, y1: 0, x2: 80, y2: 60 }],
    cables: [{ pts: [{ x: 10, y: 15, z: 20 }, { x: 30, y: 15, z: 20 }] }],
    comments: [{ x: 10, y: 15, z: 20 }],
    fps: { x: 20, y: 18, z: 60, speed: 8 }
  };
  const beforeMeters = {
    wallLength: (project.walls[0].x2 - project.walls[0].x1) * 0.1,
    thickness: project.walls[0].th * 0.1,
    snap: project.gs * 0.1,
    cableX: project.cables[0].pts[1].x * 0.1
  };

  Core.rescaleProjectGeometry(project, 0.1, 0.05);

  assert.equal((project.walls[0].x2 - project.walls[0].x1) * 0.05, beforeMeters.wallLength);
  assert.equal(project.walls[0].th * 0.05, beforeMeters.thickness);
  assert.equal(project.gs * 0.05, beforeMeters.snap);
  assert.equal(project.cables[0].pts[1].x * 0.05, beforeMeters.cableX);
});

test('legacy default wall thickness migrates to 20 cm once', () => {
  const data = { version: 3, sc: 0.1, walls: [{ th: 8 }] };
  Core.migrateLegacyDefaults(data);
  assert.equal(data.walls[0].th, 2);
  assert.equal(data.modelRevision, 2);
  Core.migrateLegacyDefaults(data);
  assert.equal(data.walls[0].th, 2);
});

test('project validation rejects unsupported and unsafe data', () => {
  assert.throws(() => Core.validateProjectData({ version: 2 }), /версии 3/);
  assert.throws(() => Core.validateProjectData({ version: 3, walls: {} }), /массивом/);
  assert.throws(() => Core.validateProjectData({ version: 3, walls: [{ x1: Infinity }] }), /Некорректное поле/);
  assert.throws(() => Core.validateProjectData({ version: 3, sc: 0 }), /масштаб/);
  assert.throws(() => Core.validateProjectData({ version: 3, gs: -1 }), /шаг привязки/);
});

test('HTML escaping protects project-controlled labels and attributes', () => {
  assert.equal(Core.escapeHtml('\"><img src=x onerror=alert(1)>'), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
});

test('cable routing locks later points to the first-point height on one wall', () => {
  const walls = [{ x1: 0, y1: 0, x2: 100, y2: 0, floor: 1 }];
  const start = { x: 10, y: 20, z: 3, wallIndex: 0 };
  const end = { x: 70, y: 50, z: 3.2, wallIndex: 0 };

  assert.deepEqual(Core.routeCableSegment(start, end, walls, { floor: 1 }), [
    { x: 70, y: 20, z: 3, wallIndex: 0 }
  ]);
});

test('cable routing turns around the visible surfaces of adjacent walls', () => {
  const walls = [
    { x1: 0, y1: 0, x2: 100, y2: 0, floor: 1 },
    { x1: 100, y1: 0, x2: 100, y2: 100, floor: 1 }
  ];
  const start = { x: 70, y: 20, z: 3, wallIndex: 0 };
  const end = { x: 97, y: 50, z: 40, wallIndex: 1 };
  const routed = Core.routeCableSegment(start, end, walls, { floor: 1 });

  assert.deepEqual(routed, [
    { x: 97, y: 20, z: 3, wallIndex: 0 },
    { x: 97, y: 20, z: 40, wallIndex: 1 }
  ]);
  assert.notDeepEqual(routed[0], { x: 100, y: 20, z: 0 });
});

test('cable routing keeps the first-point height when no wall route exists', () => {
  const start = { x: 0, y: 10, z: 0 };
  const end = { x: 20, y: 30, z: 40 };
  const routed = Core.routeCableSegment(start, end);

  assert.deepEqual(routed, [
    { x: 20, y: 10, z: 40 }
  ]);
});

test('cable routing removes small height jitter instead of leaving a shallow slope', () => {
  const walls = [{ x1: 0, y1: 0, x2: 100, y2: 0 }];
  const start = { x: 10, y: 20, z: 3, wallIndex: 0 };
  const end = { x: 70, y: 20.3, z: 3, wallIndex: 0 };

  assert.deepEqual(Core.routeCableSegment(start, end, walls), [
    { x: 70, y: 20, z: 3, wallIndex: 0 }
  ]);
});

test('camera forward movement follows pitch up and down', () => {
  const upward = Core.cameraMoveVector(0, Math.PI / 4, 1, 0);
  const downward = Core.cameraMoveVector(0, -Math.PI / 4, 1, 0);

  assert.ok(upward.y > 0);
  assert.ok(downward.y < 0);
  assert.ok(Math.abs(Math.hypot(upward.x, upward.y, upward.z) - 1) < 1e-9);
});

test('camera strafing uses intuitive left and right directions', () => {
  assert.deepEqual(Core.cameraMoveVector(0, 0, 0, 1), { x: -1, y: 0, z: 0 });
  assert.deepEqual(Core.cameraMoveVector(0, 0, 0, -1), { x: 1, y: 0, z: 0 });
});

test('camera diagonal movement is normalized to regular speed', () => {
  const diagonal = Core.cameraMoveVector(0, 0, 1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y, diagonal.z) - 1) < 1e-9);
});
