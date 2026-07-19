const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../project-core');

test('default wall thickness is 20 cm at every drawing scale', () => {
  for (const scale of [0.05, 0.1, 0.2, 0.25]) {
    const units = Core.defaultWallThicknessUnits(scale);
    assert.equal(Core.unitsToMeters(units, scale), 0.2);
  }
});

test('2D geometry measures segments and resizes them without changing direction', () => {
  assert.equal(Core.distance2d(0, 0, 3, 4), 5);
  assert.equal(Core.pointToSegmentDistance2d(5, 3, 0, 0, 10, 0), 3);
  assert.deepEqual(Core.resizeSegmentFromStart({ x1: 2, y1: 4, x2: 5, y2: 8 }, 10), {
    x1: 2,
    y1: 4,
    x2: 8,
    y2: 12
  });
});

test('detaching a shared wall endpoint preserves the neighbouring wall', () => {
  const project = {
    nextVid: 4,
    verts: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
      { id: 3, x: 10, y: 10 }
    ],
    walls: [
      { v1id: 1, v2id: 2, x1: 0, y1: 0, x2: 10, y2: 0 },
      { v1id: 2, v2id: 3, x1: 10, y1: 0, x2: 10, y2: 10 }
    ]
  };

  Core.detachWallEndpoint(project, 0, 'v2id', 8, 0);

  assert.equal(project.walls[0].v2id, 4);
  assert.deepEqual(project.verts.find((vertex) => vertex.id === 4), { id: 4, x: 8, y: 0, floor: 1 });
  assert.equal(project.walls[0].x2, 8);
  assert.equal(project.walls[1].v1id, 2);
  assert.deepEqual(project.verts.find((vertex) => vertex.id === 2), { id: 2, x: 10, y: 0 });
});

test('detaching and cleaning wall vertices keeps topology internally consistent', () => {
  const project = {
    nextVid: 5,
    verts: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
      { id: 3, x: 0, y: 10 },
      { id: 4, x: 99, y: 99 }
    ],
    walls: [
      { v1id: 1, v2id: 2, x1: 0, y1: 0, x2: 10, y2: 0 },
      { v1id: 1, v2id: 3, x1: 0, y1: 0, x2: 0, y2: 10 }
    ]
  };

  Core.detachWallVertices(project, 0);
  assert.equal(project.walls[0].v1id, 5);
  assert.equal(project.walls[0].v2id, 2);
  assert.equal(Core.removeUnusedWallVertices(project), 1);
  assert.equal(project.verts.some((vertex) => vertex.id === 4), false);
  assert.equal(project.verts.some((vertex) => vertex.id === project.walls[0].v1id), true);
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
  assert.equal(data.modelRevision, Core.CURRENT_MODEL_REVISION);
  Core.migrateLegacyDefaults(data);
  assert.equal(data.walls[0].th, 2);
});

test('topology migration assigns stable wall IDs and separates floors', () => {
  const data = {
    version: 3,
    modelRevision: 2,
    nextVid: 4,
    verts: [
      { id: 1, x: 0, y: 0 },
      { id: 2, x: 10, y: 0 },
      { id: 3, x: 20, y: 0 }
    ],
    walls: [
      { v1id: 1, v2id: 2, x1: 0, y1: 0, x2: 10, y2: 0, floor: 1 },
      { v1id: 1, v2id: 3, x1: 0, y1: 0, x2: 20, y2: 0, floor: 2 }
    ],
    cables: [{ type: 'utp', pts: [{ x: 5, y: 10, z: 0, wallIndex: 0 }] }]
  };

  Core.migrateLegacyDefaults(data);

  assert.equal(data.modelRevision, Core.CURRENT_MODEL_REVISION);
  assert.notEqual(data.walls[0].id, data.walls[1].id);
  assert.notEqual(data.walls[0].v1id, data.walls[1].v1id);
  assert.equal(data.verts.find((vertex) => vertex.id === data.walls[0].v1id).floor, 1);
  assert.equal(data.verts.find((vertex) => vertex.id === data.walls[1].v1id).floor, 2);
  assert.equal(data.cables[0].pts[0].wallId, data.walls[0].id);
  const serialized = JSON.stringify(data);
  Core.migrateLegacyDefaults(data);
  assert.equal(JSON.stringify(data), serialized);
});

test('connection normalization merges coincident vertices only on the same floor', () => {
  const project = {
    sc: 0.1,
    verts: [
      { id: 1, x: 10, y: 10, floor: 1 },
      { id: 2, x: 10.005, y: 10, floor: 1 },
      { id: 3, x: 10, y: 10, floor: 2 },
      { id: 4, x: 20, y: 10, floor: 1 },
      { id: 5, x: 20, y: 20, floor: 1 },
      { id: 6, x: 20, y: 10, floor: 2 }
    ],
    walls: [
      { v1id: 1, v2id: 4, x1: 10, y1: 10, x2: 20, y2: 10, floor: 1 },
      { v1id: 2, v2id: 5, x1: 10.005, y1: 10, x2: 20, y2: 20, floor: 1 },
      { v1id: 3, v2id: 6, x1: 10, y1: 10, x2: 20, y2: 10, floor: 2 }
    ]
  };

  assert.equal(Core.normalizeWallConnections(project), 1);
  assert.equal(project.walls[0].v1id, project.walls[1].v1id);
  assert.notEqual(project.walls[0].v1id, project.walls[2].v1id);
  assert.equal(project.verts.some((vertex) => vertex.id === 2), false);
  assert.equal(Core.normalizeWallConnections(project), 0);
});

test('opening attachment follows its wall while preserving width and position', () => {
  const wall = { id: 10, x1: 0, y1: 0, x2: 100, y2: 0, floor: 1 };
  const door = { x1: 30, y1: 2, x2: 50, y2: 2, floor: 1 };

  assert.equal(Core.attachOpeningToNearestWall(door, [wall], { maxDistance: 5 }), 10);
  assert.equal(door.wallPosition, 0.4);
  wall.x1 = 20;
  wall.y1 = 10;
  wall.x2 = 20;
  wall.y2 = 110;
  assert.equal(Core.syncOpeningToWall(door, wall), true);
  assert.equal(Core.distance2d(door.x1, door.y1, door.x2, door.y2), 20);
  assert.deepEqual({ x1: door.x1, y1: door.y1, x2: door.x2, y2: door.y2 }, { x1: 20, y1: 40, x2: 20, y2: 60 });
});

test('opening attachment refuses distant, perpendicular, and other-floor walls', () => {
  const walls = [
    { id: 1, x1: 0, y1: 0, x2: 100, y2: 0, floor: 1 },
    { id: 2, x1: 0, y1: 20, x2: 100, y2: 20, floor: 2 }
  ];
  assert.equal(Core.attachOpeningToNearestWall({ x1: 10, y1: 20, x2: 30, y2: 20, floor: 1 }, walls, { maxDistance: 5 }), null);
  assert.equal(Core.attachOpeningToNearestWall({ x1: 20, y1: -5, x2: 20, y2: 5, floor: 1 }, walls, { maxDistance: 5 }), null);
  assert.equal(Core.attachOpeningToNearestWall({ x1: 10, y1: 20, x2: 30, y2: 20, floor: 2 }, walls, { maxDistance: 5 }), 2);
});

test('opening migration binds confident matches and leaves remote openings free', () => {
  const data = {
    version: 3,
    modelRevision: 4,
    sc: 0.1,
    verts: [{ id: 1, x: 0, y: 0, floor: 1 }, { id: 2, x: 100, y: 0, floor: 1 }],
    walls: [{ id: 7, v1id: 1, v2id: 2, x1: 0, y1: 0, x2: 100, y2: 0, floor: 1 }],
    doors: [
      { x1: 20, y1: 1, x2: 40, y2: 1, floor: 1 },
      { x1: 20, y1: 50, x2: 40, y2: 50, floor: 1 }
    ],
    windows: []
  };

  Core.migrateLegacyDefaults(data);
  assert.equal(data.doors[0].wallId, 7);
  assert.equal(data.doors[1].wallId, undefined);
  assert.equal(data.modelRevision, Core.CURRENT_MODEL_REVISION);
});

test('deleting a wall detaches its openings without moving them', () => {
  const project = {
    doors: [{ x1: 10, y1: 0, x2: 20, y2: 0, wallId: 3, wallPosition: 0.15, wallDirection: 1 }],
    windows: [{ x1: 30, y1: 0, x2: 40, y2: 0, wallId: 3, wallPosition: 0.35, wallDirection: 1 }]
  };
  const before = JSON.stringify({ doors: project.doors, windows: project.windows });
  assert.equal(Core.detachWallOpenings(project, 3), 2);
  assert.equal(project.doors[0].wallId, undefined);
  assert.equal(project.windows[0].wallId, undefined);
  const coordinatesAfter = JSON.parse(JSON.stringify({ doors: project.doors, windows: project.windows }));
  const coordinatesBefore = JSON.parse(before);
  delete coordinatesBefore.doors[0].wallId;delete coordinatesBefore.doors[0].wallPosition;delete coordinatesBefore.doors[0].wallDirection;
  delete coordinatesBefore.windows[0].wallId;delete coordinatesBefore.windows[0].wallPosition;delete coordinatesBefore.windows[0].wallDirection;
  assert.deepEqual(coordinatesAfter, coordinatesBefore);
});

test('cable routing prefers stable wall IDs after walls are reordered', () => {
  const walls = [
    { id: 20, x1: 100, y1: 0, x2: 100, y2: 100, floor: 1 },
    { id: 10, x1: 0, y1: 0, x2: 100, y2: 0, floor: 1 }
  ];
  const start = { x: 20, y: 15, z: 3, wallId: 10, wallIndex: 0 };
  const end = { x: 97, y: 40, z: 60, wallId: 20, wallIndex: 1 };

  const routed = Core.routeCableSegment(start, end, walls, { floor: 1 });

  assert.equal(routed[0].wallId, 10);
  assert.equal(routed[1].wallId, 20);
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
