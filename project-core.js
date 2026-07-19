(function initSmartPlanCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmartPlanCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSmartPlanCore() {
  'use strict';

  const DEFAULT_SCALE = 0.1;
  const DEFAULT_SNAP_METERS = 0.25;
  const DEFAULT_WALL_THICKNESS_METERS = 0.2;
  const CURRENT_MODEL_REVISION = 6;
  const MAX_PROJECT_ITEMS = 100000;
  const MAX_PROJECT_NODES = 500000;
  const MAX_STRING_LENGTH = 2 * 1024 * 1024;

  function finiteNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeScale(value, fallback = DEFAULT_SCALE) {
    const scale = finiteNumber(value, fallback);
    return scale >= 0.001 && scale <= 10 ? scale : fallback;
  }

  function metersToUnits(meters, scale) {
    return finiteNumber(meters, 0) / normalizeScale(scale);
  }

  function unitsToMeters(units, scale) {
    return finiteNumber(units, 0) * normalizeScale(scale);
  }

  function defaultWallThicknessUnits(scale) {
    return metersToUnits(DEFAULT_WALL_THICKNESS_METERS, scale);
  }

  function distance2d(x1, y1, x2, y2) {
    return Math.hypot(
      finiteNumber(x2, 0) - finiteNumber(x1, 0),
      finiteNumber(y2, 0) - finiteNumber(y1, 0)
    );
  }

  function pointToSegmentDistance2d(px, py, x1, y1, x2, y2) {
    const ax = finiteNumber(x1, 0);
    const ay = finiteNumber(y1, 0);
    const dx = finiteNumber(x2, ax) - ax;
    const dy = finiteNumber(y2, ay) - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((finiteNumber(px, ax) - ax) * dx + (finiteNumber(py, ay) - ay) * dy) / lengthSquared))
      : 0;
    return distance2d(px, py, ax + t * dx, ay + t * dy);
  }

  function projectPointToSegment2d(px, py, segment) {
    const x1 = finiteNumber(segment?.x1, 0);
    const y1 = finiteNumber(segment?.y1, 0);
    const dx = finiteNumber(segment?.x2, x1) - x1;
    const dy = finiteNumber(segment?.y2, y1) - y1;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((finiteNumber(px, x1) - x1) * dx + (finiteNumber(py, y1) - y1) * dy) / lengthSquared))
      : 0;
    const x = x1 + t * dx;
    const y = y1 + t * dy;
    return { x, y, t, distance: distance2d(px, py, x, y) };
  }

  function createSnapshotHistory(capture, restore, options = {}) {
    if (typeof capture !== 'function' || typeof restore !== 'function') {
      throw new TypeError('Snapshot history requires capture and restore functions');
    }
    const limit = Math.max(1, Math.trunc(finiteNumber(options.limit, 60)));
    const undoStack = Array.isArray(options.undoStack) ? options.undoStack : [];
    const redoStack = Array.isArray(options.redoStack) ? options.redoStack : [];
    const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
    let transaction = null;

    const trim = (stack) => {
      if (stack.length > limit) stack.splice(0, stack.length - limit);
    };
    const pushUnique = (stack, snapshot) => {
      if (stack[stack.length - 1] !== snapshot) stack.push(snapshot);
      trim(stack);
    };
    const commit = (label = null) => {
      if (!transaction) return false;
      if (label != null && transaction.label !== String(label)) return false;
      const before = transaction.snapshot;
      transaction = null;
      if (before === capture()) return false;
      pushUnique(undoStack, before);
      redoStack.length = 0;
      onChange('commit');
      return true;
    };
    const begin = (label = 'change') => {
      const normalizedLabel = String(label || 'change');
      if (transaction && transaction.label !== normalizedLabel) commit();
      if (!transaction) transaction = { label: normalizedLabel, snapshot: capture() };
      return transaction.snapshot;
    };
    const cancel = () => {
      if (!transaction) return false;
      transaction = null;
      return true;
    };
    const run = (label, mutator) => {
      if (typeof label === 'function') {
        mutator = label;
        label = 'change';
      }
      begin(label);
      try {
        const result = mutator();
        commit();
        return result;
      } catch (error) {
        const before = transaction?.snapshot;
        transaction = null;
        if (before != null) restore(before);
        onChange('rollback');
        throw error;
      }
    };
    const undo = () => {
      if (transaction) commit();
      if (!undoStack.length) return false;
      const previous = undoStack.pop();
      pushUnique(redoStack, capture());
      restore(previous);
      onChange('undo');
      return true;
    };
    const redo = () => {
      if (transaction) commit();
      if (!redoStack.length) return false;
      const next = redoStack.pop();
      pushUnique(undoStack, capture());
      restore(next);
      onChange('redo');
      return true;
    };
    const reset = () => {
      transaction = null;
      undoStack.length = 0;
      redoStack.length = 0;
    };

    return Object.freeze({
      begin,
      commit,
      cancel,
      run,
      undo,
      redo,
      reset,
      undoStack,
      redoStack,
      isActive: () => transaction !== null
    });
  }

  function resizeSegmentFromStart(segment, lengthValue) {
    const x1 = finiteNumber(segment?.x1, 0);
    const y1 = finiteNumber(segment?.y1, 0);
    const currentX2 = finiteNumber(segment?.x2, x1);
    const currentY2 = finiteNumber(segment?.y2, y1);
    const length = Math.max(0, finiteNumber(lengthValue, 0));
    const angle = Math.atan2(currentY2 - y1, currentX2 - x1);
    return {
      x1,
      y1,
      x2: x1 + Math.cos(angle) * length,
      y2: y1 + Math.sin(angle) * length
    };
  }

  function syncWallFromVertices(wall, vertices) {
    if (!wall || !Array.isArray(vertices)) return wall;
    const v1 = vertices.find((vertex) => vertex.id === wall.v1id);
    const v2 = vertices.find((vertex) => vertex.id === wall.v2id);
    if (v1) {
      wall.x1 = v1.x;
      wall.y1 = v1.y;
    }
    if (v2) {
      wall.x2 = v2.x;
      wall.y2 = v2.y;
    }
    return wall;
  }

  function allocateVertexId(project) {
    const vertices = Array.isArray(project.verts) ? project.verts : (project.verts = []);
    const used = new Set(vertices.map((vertex) => vertex.id));
    let next = Number.isInteger(project.nextVid) && project.nextVid > 0
      ? project.nextVid
      : vertices.reduce((max, vertex) => Number.isInteger(vertex.id) ? Math.max(max, vertex.id + 1) : max, 1);
    while (used.has(next)) next += 1;
    project.nextVid = next + 1;
    return next;
  }

  function detachWallEndpoint(project, wallIndex, endpointKey, xValue, yValue) {
    if (!project || !Array.isArray(project.walls) || !['v1id', 'v2id'].includes(endpointKey)) return null;
    const wall = project.walls[wallIndex];
    if (!wall) return null;
    if (!Array.isArray(project.verts)) project.verts = [];
    const isFirst = endpointKey === 'v1id';
    const x = finiteNumber(xValue, finiteNumber(wall[isFirst ? 'x1' : 'x2'], 0));
    const y = finiteNumber(yValue, finiteNumber(wall[isFirst ? 'y1' : 'y2'], 0));
    const vertexId = wall[endpointKey];
    const vertex = project.verts.find((item) => item.id === vertexId);
    const shared = project.walls.some((other, index) => (
      index !== wallIndex && (other.v1id === vertexId || other.v2id === vertexId)
    ));

    if (shared || !vertex) {
      const replacement = { id: allocateVertexId(project), x, y, floor: Math.max(1, Math.trunc(finiteNumber(wall.floor, vertex?.floor || 1))) };
      project.verts.push(replacement);
      wall[endpointKey] = replacement.id;
    } else {
      vertex.x = x;
      vertex.y = y;
    }
    syncWallFromVertices(wall, project.verts);
    return wall[endpointKey];
  }

  function detachWallVertices(project, wallIndex) {
    if (!project || !Array.isArray(project.walls)) return null;
    const wall = project.walls[wallIndex];
    if (!wall) return null;
    detachWallEndpoint(project, wallIndex, 'v1id', wall.x1, wall.y1);
    detachWallEndpoint(project, wallIndex, 'v2id', wall.x2, wall.y2);
    return wall;
  }

  function removeUnusedWallVertices(project) {
    if (!project || !Array.isArray(project.verts) || !Array.isArray(project.walls)) return 0;
    const used = new Set();
    project.walls.forEach((wall) => {
      if (wall.v1id != null) used.add(wall.v1id);
      if (wall.v2id != null) used.add(wall.v2id);
    });
    const before = project.verts.length;
    project.verts = project.verts.filter((vertex) => used.has(vertex.id));
    return before - project.verts.length;
  }

  function normalizeFloor(value) {
    return Math.max(1, Math.trunc(finiteNumber(value, 1)));
  }

  function migrateWallTopology(project) {
    if (!project || typeof project !== 'object') return project;
    if (!Array.isArray(project.walls)) project.walls = [];
    if (!Array.isArray(project.verts)) project.verts = [];

    let nextWallId = Number.isInteger(project.nextWallId) && project.nextWallId > 0 ? project.nextWallId : 1;
    project.walls.forEach((wall) => {
      if (Number.isInteger(wall.id) && wall.id > 0) nextWallId = Math.max(nextWallId, wall.id + 1);
    });
    const seenWallIds = new Set();
    project.walls.forEach((wall) => {
      if (!Number.isInteger(wall.id) || wall.id <= 0 || seenWallIds.has(wall.id)) {
        while (seenWallIds.has(nextWallId)) nextWallId += 1;
        wall.id = nextWallId++;
      }
      seenWallIds.add(wall.id);
    });
    project.nextWallId = nextWallId;

    const vertexById = new Map(project.verts.map((vertex) => [vertex.id, vertex]));
    const vertexFloor = new Map();
    project.verts.forEach((vertex) => {
      if (Number.isInteger(vertex.floor) && vertex.floor > 0) vertexFloor.set(vertex.id, vertex.floor);
    });
    project.walls.forEach((wall) => {
      const floor = normalizeFloor(wall.floor);
      wall.floor = floor;
      [['v1id', 'x1', 'y1'], ['v2id', 'x2', 'y2']].forEach(([idKey, xKey, yKey]) => {
        let vertex = vertexById.get(wall[idKey]);
        if (!vertex) {
          vertex = {
            id: allocateVertexId(project),
            x: finiteNumber(wall[xKey], 0),
            y: finiteNumber(wall[yKey], 0),
            floor
          };
          project.verts.push(vertex);
          vertexById.set(vertex.id, vertex);
          vertexFloor.set(vertex.id, floor);
          wall[idKey] = vertex.id;
        } else {
          const assignedFloor = vertexFloor.get(vertex.id);
          if (assignedFloor == null) {
            vertex.floor = floor;
            vertexFloor.set(vertex.id, floor);
          } else if (assignedFloor !== floor) {
            const replacement = { id: allocateVertexId(project), x: vertex.x, y: vertex.y, floor };
            project.verts.push(replacement);
            vertexById.set(replacement.id, replacement);
            vertexFloor.set(replacement.id, floor);
            wall[idKey] = replacement.id;
            vertex = replacement;
          } else {
            vertex.floor = floor;
          }
        }
        wall[xKey] = vertex.x;
        wall[yKey] = vertex.y;
      });
    });
    project.verts.forEach((vertex) => {
      if (!Number.isInteger(vertex.floor) || vertex.floor <= 0) vertex.floor = 1;
    });

    (project.cables || []).forEach((cable) => (cable.pts || []).forEach((point) => {
      if (!Number.isInteger(point.wallId) && Number.isInteger(point.wallIndex) && project.walls[point.wallIndex]) {
        point.wallId = project.walls[point.wallIndex].id;
      }
    }));
    return project;
  }

  function normalizeWallConnections(project, toleranceValue) {
    if (!project || !Array.isArray(project.verts) || !Array.isArray(project.walls)) return 0;
    const tolerance = Math.max(1e-9, finiteNumber(toleranceValue, metersToUnits(0.001, project.sc)));
    const buckets = new Map();
    const replacementIds = new Map();
    const referencedIds = new Set();
    project.walls.forEach((wall) => {
      if (wall.v1id != null) referencedIds.add(wall.v1id);
      if (wall.v2id != null) referencedIds.add(wall.v2id);
    });

    const bucketKey = (floor, cellX, cellY) => `${floor}:${cellX}:${cellY}`;
    project.verts.forEach((vertex) => {
      if (!referencedIds.has(vertex.id)) return;
      const floor = normalizeFloor(vertex.floor);
      vertex.floor = floor;
      const cellX = Math.floor(vertex.x / tolerance);
      const cellY = Math.floor(vertex.y / tolerance);
      let canonical = null;
      for (let dx = -1; dx <= 1 && !canonical; dx += 1) {
        for (let dy = -1; dy <= 1 && !canonical; dy += 1) {
          const candidates = buckets.get(bucketKey(floor, cellX + dx, cellY + dy)) || [];
          canonical = candidates.find((candidate) => distance2d(vertex.x, vertex.y, candidate.x, candidate.y) <= tolerance) || null;
        }
      }
      if (canonical) {
        replacementIds.set(vertex.id, canonical.id);
      } else {
        const key = bucketKey(floor, cellX, cellY);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(vertex);
      }
    });

    if (!replacementIds.size) return 0;
    project.walls.forEach((wall) => {
      if (replacementIds.has(wall.v1id)) wall.v1id = replacementIds.get(wall.v1id);
      if (replacementIds.has(wall.v2id)) wall.v2id = replacementIds.get(wall.v2id);
      syncWallFromVertices(wall, project.verts);
    });
    removeUnusedWallVertices(project);
    return replacementIds.size;
  }

  function attachOpeningToNearestWall(opening, walls, options = {}) {
    if (!opening || !Array.isArray(walls)) return null;
    const floor = normalizeFloor(opening.floor);
    const openingDx = finiteNumber(opening.x2, 0) - finiteNumber(opening.x1, 0);
    const openingDy = finiteNumber(opening.y2, 0) - finiteNumber(opening.y1, 0);
    const openingLength = Math.hypot(openingDx, openingDy);
    if (openingLength <= 1e-9) return null;
    const centerX = (opening.x1 + opening.x2) / 2;
    const centerY = (opening.y1 + opening.y2) / 2;
    const maxDistance = Math.max(0, finiteNumber(options.maxDistance, metersToUnits(0.3, options.scale)));
    const minimumAlignment = Math.cos(Math.max(0, finiteNumber(options.angleTolerance, 0.35)));
    let best = null;

    walls.forEach((wall) => {
      if (!Number.isInteger(wall.id) || normalizeFloor(wall.floor) !== floor) return;
      const wallDx = wall.x2 - wall.x1;
      const wallDy = wall.y2 - wall.y1;
      const wallLength = Math.hypot(wallDx, wallDy);
      if (wallLength <= 1e-9) return;
      const alignment = (openingDx * wallDx + openingDy * wallDy) / (openingLength * wallLength);
      if (Math.abs(alignment) < minimumAlignment) return;
      const projection = projectPointToSegment2d(centerX, centerY, wall);
      if (projection.distance > maxDistance || (best && projection.distance >= best.distance)) return;
      best = { wall, projection, distance: projection.distance, direction: alignment >= 0 ? 1 : -1 };
    });

    if (!best) return null;
    opening.floor = floor;
    opening.wallId = best.wall.id;
    opening.wallPosition = best.projection.t;
    opening.wallDirection = best.direction;
    return best.wall.id;
  }

  function syncOpeningToWall(opening, wall) {
    if (!opening || !wall || opening.wallId !== wall.id) return false;
    const wallDx = wall.x2 - wall.x1;
    const wallDy = wall.y2 - wall.y1;
    const wallLength = Math.hypot(wallDx, wallDy);
    const openingLength = distance2d(opening.x1, opening.y1, opening.x2, opening.y2);
    if (wallLength <= 1e-9 || openingLength <= 1e-9) return false;
    const ux = wallDx / wallLength;
    const uy = wallDy / wallLength;
    const half = openingLength / 2;
    let centerDistance = Math.max(0, Math.min(1, finiteNumber(opening.wallPosition, 0.5))) * wallLength;
    if (openingLength <= wallLength) centerDistance = Math.max(half, Math.min(wallLength - half, centerDistance));
    else centerDistance = wallLength / 2;
    const centerX = wall.x1 + ux * centerDistance;
    const centerY = wall.y1 + uy * centerDistance;
    const direction = opening.wallDirection === -1 ? -1 : 1;
    opening.x1 = centerX - ux * half * direction;
    opening.y1 = centerY - uy * half * direction;
    opening.x2 = centerX + ux * half * direction;
    opening.y2 = centerY + uy * half * direction;
    opening.wallPosition = centerDistance / wallLength;
    opening.floor = normalizeFloor(wall.floor);
    return true;
  }

  function syncWallOpenings(project, wallId) {
    if (!project || !Array.isArray(project.walls)) return 0;
    const wall = project.walls.find((item) => item.id === wallId);
    if (!wall) return 0;
    let updated = 0;
    ['doors', 'windows'].forEach((collection) => (project[collection] || []).forEach((opening) => {
      if (syncOpeningToWall(opening, wall)) updated += 1;
    }));
    return updated;
  }

  function detachWallOpenings(project, wallId) {
    let detached = 0;
    ['doors', 'windows'].forEach((collection) => (project?.[collection] || []).forEach((opening) => {
      if (opening.wallId !== wallId) return;
      delete opening.wallId;
      delete opening.wallPosition;
      delete opening.wallDirection;
      detached += 1;
    }));
    return detached;
  }

  function migrateOpeningAttachments(project) {
    if (!project || !Array.isArray(project.walls)) return project;
    const options = { scale: project.sc, maxDistance: metersToUnits(0.3, project.sc), angleTolerance: 0.35 };
    ['doors', 'windows'].forEach((collection) => (project[collection] || []).forEach((opening) => {
      if (!Number.isInteger(opening.wallId) || !project.walls.some((wall) => wall.id === opening.wallId)) {
        attachOpeningToNearestWall(opening, project.walls, options);
      }
    }));
    return project;
  }

  const WALL_EQUIPMENT_TYPES = Object.freeze([
    'camera', 'doorbell', 'monitor', 'socket', 'panel', 'heat', 'nvr', 'ac'
  ]);

  function equipmentMountKind(equipment, customDefinitions = []) {
    if (!equipment) return 'free';
    const custom = Array.isArray(customDefinitions)
      ? customDefinitions.find((definition) => definition?.type === equipment.type)
      : null;
    if (custom) return custom.behavior === 'light' ? (equipment.h3 == null ? 'ceiling' : 'wall') : 'wall';
    if (equipment.type === 'light') return equipment.h3 == null ? 'ceiling' : 'wall';
    if (equipment.type === 'pillar' || equipment.type === 'tree') return 'floor';
    return WALL_EQUIPMENT_TYPES.includes(equipment.type) ? 'wall' : 'free';
  }

  function attachEquipmentToWall(equipment, wall, options = {}) {
    if (!equipment || !wall || !Number.isInteger(wall.id)) return null;
    const floor = normalizeFloor(equipment.floor);
    if (normalizeFloor(wall.floor) !== floor) return null;
    const projection = projectPointToSegment2d(equipment.x, equipment.y, wall);
    const wallDx = wall.x2 - wall.x1;
    const wallDy = wall.y2 - wall.y1;
    const wallLength = Math.hypot(wallDx, wallDy);
    if (wallLength <= 1e-9) return null;
    const nx = wallDy / wallLength;
    const ny = -wallDx / wallLength;
    const signedDistance = (equipment.x - projection.x) * nx + (equipment.y - projection.y) * ny;
    const side = options.side === -1 || options.side === 1
      ? options.side
      : (Math.abs(signedDistance) <= 1e-9 && equipment.wallSide === -1 ? -1 : (signedDistance >= 0 ? 1 : -1));
    equipment.wallId = wall.id;
    equipment.wallPosition = projection.t;
    equipment.wallSide = side;
    equipment.floor = floor;
    if (options.snap !== false) syncEquipmentToWall(equipment, wall);
    return wall.id;
  }

  function attachEquipmentToNearestWall(equipment, walls, options = {}) {
    if (!equipment || !Array.isArray(walls)) return null;
    const floor = normalizeFloor(equipment.floor);
    const maxDistance = Math.max(0, finiteNumber(options.maxDistance, metersToUnits(0.4, options.scale)));
    let best = null;
    walls.forEach((wall) => {
      if (!Number.isInteger(wall.id) || normalizeFloor(wall.floor) !== floor) return;
      const projection = projectPointToSegment2d(equipment.x, equipment.y, wall);
      if (projection.distance > maxDistance || (best && projection.distance >= best.distance)) return;
      best = { wall, distance: projection.distance };
    });
    return best ? attachEquipmentToWall(equipment, best.wall, options) : null;
  }

  function syncEquipmentToWall(equipment, wall) {
    if (!equipment || !wall || equipment.wallId !== wall.id) return false;
    const wallDx = wall.x2 - wall.x1;
    const wallDy = wall.y2 - wall.y1;
    const wallLength = Math.hypot(wallDx, wallDy);
    if (wallLength <= 1e-9) return false;
    const position = Math.max(0, Math.min(1, finiteNumber(equipment.wallPosition, 0.5)));
    equipment.x = wall.x1 + wallDx * position;
    equipment.y = wall.y1 + wallDy * position;
    equipment.wallPosition = position;
    equipment.floor = normalizeFloor(wall.floor);
    return true;
  }

  function syncWallEquipment(project, wallId) {
    if (!project || !Array.isArray(project.walls)) return 0;
    const wall = project.walls.find((item) => item.id === wallId);
    if (!wall) return 0;
    let updated = 0;
    (project.equip || []).forEach((equipment) => {
      if (syncEquipmentToWall(equipment, wall)) updated += 1;
    });
    return updated;
  }

  function detachEquipmentFromWall(equipment) {
    if (!equipment || !Number.isInteger(equipment.wallId)) return false;
    delete equipment.wallId;
    delete equipment.wallPosition;
    delete equipment.wallSide;
    return true;
  }

  function detachWallEquipment(project, wallId) {
    let detached = 0;
    (project?.equip || []).forEach((equipment) => {
      if (equipment.wallId !== wallId) return;
      if (detachEquipmentFromWall(equipment)) detached += 1;
    });
    return detached;
  }

  function migrateEquipmentAttachments(project) {
    if (!project || !Array.isArray(project.walls)) return project;
    const options = { scale: project.sc, maxDistance: metersToUnits(0.4, project.sc), snap: false };
    (project.equip || []).forEach((equipment) => {
      if (equipmentMountKind(equipment, project.customEq) !== 'wall') {
        detachEquipmentFromWall(equipment);
        return;
      }
      const attachedWall = Number.isInteger(equipment.wallId)
        ? project.walls.find((wall) => wall.id === equipment.wallId && normalizeFloor(wall.floor) === normalizeFloor(equipment.floor))
        : null;
      if (!attachedWall) {
        detachEquipmentFromWall(equipment);
        attachEquipmentToNearestWall(equipment, project.walls, options);
      }
    });
    return project;
  }

  function scenePresetConfig(value, scaleValue = DEFAULT_SCALE) {
    const scale = normalizeScale(scaleValue);
    if (value === 'architectural') {
      return Object.freeze({
        id: 'architectural',
        label: 'Архитектурный',
        fov: 48,
        background: 0x111122,
        fogDensity: 0.008 * scale,
        floorColor: 0x29463b,
        wallColor: 0x9a8068,
        edgeColor: 0x6b5745,
        gridCenterColor: 0x7791b9,
        gridColor: 0x354a67,
        standardMaterials: true
      });
    }
    return Object.freeze({
      id: 'technical',
      label: 'Монтажный',
      fov: 60,
      background: null,
      fogDensity: 0,
      floorColor: null,
      wallColor: null,
      edgeColor: 0x3a5080,
      gridCenterColor: null,
      gridColor: null,
      standardMaterials: false
    });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function assertSafeProjectTree(value) {
    let nodes = 0;
    const visit = (current, depth) => {
      nodes += 1;
      if (nodes > MAX_PROJECT_NODES) throw new Error('Проект содержит слишком много данных');
      if (depth > 12) throw new Error('Проект имеет недопустимую вложенность');
      if (current == null || typeof current === 'boolean') return;
      if (typeof current === 'number') {
        if (!Number.isFinite(current)) throw new Error('Проект содержит некорректное число');
        return;
      }
      if (typeof current === 'string') {
        if (current.length > MAX_STRING_LENGTH) throw new Error('Проект содержит слишком длинное текстовое поле');
        return;
      }
      if (Array.isArray(current)) {
        if (current.length > MAX_PROJECT_ITEMS) throw new Error('Проект содержит слишком много объектов');
        current.forEach((item) => visit(item, depth + 1));
        return;
      }
      if (typeof current === 'object') {
        const proto = Object.getPrototypeOf(current);
        if (proto !== Object.prototype && proto !== null) throw new Error('Некорректный объект проекта');
        Object.keys(current).forEach((key) => {
          if (key.length > 200) throw new Error('Некорректное имя поля проекта');
          visit(current[key], depth + 1);
        });
        return;
      }
      throw new Error('Проект содержит недопустимый тип данных');
    };
    visit(value, 0);
  }

  function validateProjectData(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Неверный формат файла проекта');
    }
    if (data.version !== 3) throw new Error('Поддерживаются только проекты SmartPlan версии 3');
    if (data.sc != null && (!Number.isFinite(data.sc) || data.sc < 0.001 || data.sc > 10)) throw new Error('Некорректный масштаб проекта');
    if (data.gs != null && (!Number.isFinite(data.gs) || data.gs <= 0 || data.gs > 100000)) throw new Error('Некорректный шаг привязки');
    const collections = ['verts', 'walls', 'doors', 'windows', 'equip', 'measures', 'cables', 'comments', 'customEq'];
    collections.forEach((key) => {
      if (data[key] != null && !Array.isArray(data[key])) throw new Error(`Поле ${key} должно быть массивом`);
      (data[key] || []).forEach((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Некорректный объект в поле ${key}`);
      });
    });
    const requireNumbers = (items, fields, label) => (items || []).forEach((item) => {
      fields.forEach((field) => {
        if (!Number.isFinite(item[field]) || Math.abs(item[field]) > 1e8) {
          throw new Error(`Некорректное поле ${label}.${field}`);
        }
      });
    });
    requireNumbers(data.verts, ['id', 'x', 'y'], 'verts');
    requireNumbers(data.walls, ['x1', 'y1', 'x2', 'y2'], 'walls');
    requireNumbers(data.doors, ['x1', 'y1', 'x2', 'y2'], 'doors');
    requireNumbers(data.windows, ['x1', 'y1', 'x2', 'y2'], 'windows');
    requireNumbers(data.equip, ['id', 'x', 'y'], 'equip');
    requireNumbers(data.measures, ['x1', 'y1', 'x2', 'y2'], 'measures');
    requireNumbers(data.comments, ['id', 'x', 'y', 'z'], 'comments');
    (data.equip || []).forEach((item) => {
      if (typeof item.type !== 'string' || item.type.length > 100) throw new Error('Некорректный тип оборудования');
    });
    (data.comments || []).forEach((item) => {
      if (typeof item.text !== 'string') throw new Error('Некорректный комментарий');
    });
    (data.cables || []).forEach((item) => {
      if (!['utp', 'shvvp'].includes(item.type) || !Array.isArray(item.pts)) throw new Error('Некорректная кабельная трасса');
      requireNumbers(item.pts, ['x', 'y', 'z'], 'cables.pts');
    });
    (data.customEq || []).forEach((item) => {
      if (typeof item.type !== 'string' || !/^custom_[a-zA-Z0-9_-]{1,80}$/.test(item.type)) throw new Error('Некорректный тип пользовательского оборудования');
      if (typeof item.name !== 'string' || !['normal', 'camera', 'light'].includes(item.behavior || 'normal')) throw new Error('Некорректное пользовательское оборудование');
      if (item.svgData != null && (typeof item.svgData !== 'string' || !/^data:image\/svg\+xml(?:;charset=[^;,]+)?(?:;base64)?,/i.test(item.svgData))) {
        throw new Error('Некорректная SVG-иконка оборудования');
      }
    });
    assertSafeProjectTree(data);
    return data;
  }

  function scaleFields(item, fields, factor) {
    if (!item || typeof item !== 'object') return;
    fields.forEach((field) => {
      if (Number.isFinite(item[field])) item[field] *= factor;
    });
  }

  function rescaleProjectGeometry(project, oldScaleValue, newScaleValue) {
    const oldScale = normalizeScale(oldScaleValue);
    const newScale = normalizeScale(newScaleValue, oldScale);
    if (oldScale === newScale) return 1;
    const factor = oldScale / newScale;

    (project.verts || []).forEach((item) => scaleFields(item, ['x', 'y'], factor));
    (project.walls || []).forEach((item) => scaleFields(item, ['x1', 'y1', 'x2', 'y2', 'th', 'h'], factor));
    (project.doors || []).forEach((item) => scaleFields(item, ['x1', 'y1', 'x2', 'y2', 'dh'], factor));
    (project.windows || []).forEach((item) => scaleFields(item, ['x1', 'y1', 'x2', 'y2', 'wh', 'sill'], factor));
    (project.equip || []).forEach((item) => scaleFields(item, ['x', 'y', 'h3', 'fovD', 'eqW', 'eqH'], factor));
    (project.measures || []).forEach((item) => scaleFields(item, ['x1', 'y1', 'x2', 'y2'], factor));
    (project.comments || []).forEach((item) => scaleFields(item, ['x', 'y', 'z'], factor));
    (project.cables || []).forEach((cable) => {
      (cable.pts || []).forEach((item) => scaleFields(item, ['x', 'y', 'z'], factor));
    });
    if (Number.isFinite(project.gs)) project.gs *= factor;
    if (project.fps) scaleFields(project.fps, ['x', 'y', 'z', 'speed'], factor);
    return factor;
  }

  function pointToWallDistance(point, wall) {
    const dx = wall.x2 - wall.x1;
    const dz = wall.y2 - wall.y1;
    const lengthSquared = dx * dx + dz * dz;
    const t = lengthSquared > 0
      ? Math.max(0, Math.min(1, ((point.x - wall.x1) * dx + (point.z - wall.y1) * dz) / lengthSquared))
      : 0;
    const x = wall.x1 + t * dx;
    const z = wall.y1 + t * dz;
    return Math.hypot(point.x - x, point.z - z);
  }

  function wallDirection(wall) {
    const dx = wall.x2 - wall.x1;
    const dz = wall.y2 - wall.y1;
    const length = Math.hypot(dx, dz);
    return length > 1e-9 ? { x: dx / length, z: dz / length } : null;
  }

  function nearestWallIndex(point, walls, floor, maxDistance) {
    if (Number.isInteger(point.wallId)) {
      const stableIndex = walls.findIndex((wall) => wall.id === point.wallId);
      if (stableIndex >= 0) {
        const wall = walls[stableIndex];
        if (floor == null || (wall.floor || 1) === floor) return stableIndex;
      }
    }
    if (Number.isInteger(point.wallIndex) && walls[point.wallIndex]) {
      const wall = walls[point.wallIndex];
      if (floor == null || (wall.floor || 1) === floor) return point.wallIndex;
    }
    let bestIndex = -1;
    let bestDistance = maxDistance;
    walls.forEach((wall, index) => {
      if (floor != null && (wall.floor || 1) !== floor) return;
      const distance = pointToWallDistance(point, wall);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    return bestIndex;
  }

  function sharedWallCorner(wallA, wallB, tolerance) {
    const endsA = [{ x: wallA.x1, z: wallA.y1 }, { x: wallA.x2, z: wallA.y2 }];
    const endsB = [{ x: wallB.x1, z: wallB.y1 }, { x: wallB.x2, z: wallB.y2 }];
    let closest = null;
    let bestDistance = Infinity;
    endsA.forEach((a) => endsB.forEach((b) => {
      const distance = Math.hypot(a.x - b.x, a.z - b.z);
      if (distance < bestDistance) {
        bestDistance = distance;
        closest = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      }
    }));
    return bestDistance <= tolerance ? closest : null;
  }

  function intersectLines2d(pointA, directionA, pointB, directionB) {
    const cross = directionA.x * directionB.z - directionA.z * directionB.x;
    if (Math.abs(cross) < 1e-8) return null;
    const dx = pointB.x - pointA.x;
    const dz = pointB.z - pointA.z;
    const t = (dx * directionB.z - dz * directionB.x) / cross;
    return { x: pointA.x + directionA.x * t, z: pointA.z + directionA.z * t };
  }

  function cablePoint(point, x, y, z, wallIndex, wall) {
    const result = { x, y, z };
    if (Number.isInteger(wallIndex) && wallIndex >= 0) result.wallIndex = wallIndex;
    if (Number.isInteger(wall?.id)) result.wallId = wall.id;
    if (Number.isInteger(point.floor)) result.floor = point.floor;
    return result;
  }

  function pushUniquePoint(points, point, epsilon) {
    const previous = points[points.length - 1];
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y, previous.z - point.z) > epsilon) {
      points.push(point);
    }
  }

  // Returns the points to append after `start`, including a normalized `end`.
  // Every generated segment stays at the height established by `start`.
  function routeCableSegment(start, end, walls = [], options = {}) {
    const epsilon = finiteNumber(options.epsilon, 1e-6);
    const cornerTolerance = finiteNumber(options.cornerTolerance, 10);
    const maxWallDistance = finiteNumber(options.maxWallDistance, 30);
    const floor = options.floor == null ? null : Number(options.floor);
    const wallAIndex = nearestWallIndex(start, walls, floor, maxWallDistance);
    const wallBIndex = nearestWallIndex(end, walls, floor, maxWallDistance);
    const wallA = walls[wallAIndex];
    const wallB = walls[wallBIndex];
    const points = [start];
    // A cable run keeps the height established by its first point. Cursor
    // movement on later wall clicks only chooses the horizontal position.
    const endY = start.y;

    if (wallA && wallB && wallAIndex === wallBIndex) {
      const direction = wallDirection(wallA);
      if (direction) {
        const along = (end.x - start.x) * direction.x + (end.z - start.z) * direction.z;
        const endX = start.x + direction.x * along;
        const endZ = start.z + direction.z * along;
        pushUniquePoint(points, cablePoint(end, endX, endY, endZ, wallAIndex, wallA), epsilon);
        return points.slice(1);
      }
    }

    if (wallA && wallB && wallAIndex !== wallBIndex) {
      const directionA = wallDirection(wallA);
      const directionB = wallDirection(wallB);
      const sharedCorner = sharedWallCorner(wallA, wallB, cornerTolerance);
      const surfaceCorner = directionA && directionB && sharedCorner
        ? intersectLines2d(start, directionA, end, directionB)
        : null;
      if (surfaceCorner) {
        pushUniquePoint(points, cablePoint(start, surfaceCorner.x, start.y, surfaceCorner.z, wallAIndex, wallA), epsilon);
        pushUniquePoint(points, cablePoint(end, end.x, endY, end.z, wallBIndex, wallB), epsilon);
        return points.slice(1);
      }
    }

    pushUniquePoint(points, cablePoint(end, end.x, endY, end.z, wallBIndex, wallB), epsilon);
    return points.slice(1);
  }

  function cameraMoveVector(yawValue, pitchValue, forwardAmount = 0, strafeAmount = 0) {
    const yaw = finiteNumber(yawValue, 0);
    const pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, finiteNumber(pitchValue, 0)));
    const forward = finiteNumber(forwardAmount, 0);
    const strafe = finiteNumber(strafeAmount, 0);
    const cosPitch = Math.cos(pitch);
    const vector = {
      x: cosPitch * Math.sin(yaw) * forward - Math.cos(yaw) * strafe,
      y: Math.sin(pitch) * forward,
      z: cosPitch * Math.cos(yaw) * forward + Math.sin(yaw) * strafe
    };
    const length = Math.hypot(vector.x, vector.y, vector.z);
    if (length > 1) {
      vector.x /= length;
      vector.y /= length;
      vector.z /= length;
    }
    return vector;
  }

  function migrateLegacyDefaults(data) {
    const scale = normalizeScale(data.sc);
    if ((data.modelRevision || 0) < 2) {
      (data.walls || []).forEach((wall) => {
        if (wall && wall.th === 8) wall.th = defaultWallThicknessUnits(scale);
      });
    }
    if ((data.modelRevision || 0) < 3) migrateWallTopology(data);
    if ((data.modelRevision || 0) < 4) normalizeWallConnections(data);
    if ((data.modelRevision || 0) < 5) migrateOpeningAttachments(data);
    if ((data.modelRevision || 0) < 6) migrateEquipmentAttachments(data);
    data.modelRevision = CURRENT_MODEL_REVISION;
    return data;
  }

  return Object.freeze({
    DEFAULT_SCALE,
    DEFAULT_SNAP_METERS,
    DEFAULT_WALL_THICKNESS_METERS,
    CURRENT_MODEL_REVISION,
    normalizeScale,
    metersToUnits,
    unitsToMeters,
    defaultWallThicknessUnits,
    distance2d,
    pointToSegmentDistance2d,
    projectPointToSegment2d,
    createSnapshotHistory,
    resizeSegmentFromStart,
    syncWallFromVertices,
    detachWallEndpoint,
    detachWallVertices,
    removeUnusedWallVertices,
    migrateWallTopology,
    normalizeWallConnections,
    attachOpeningToNearestWall,
    syncOpeningToWall,
    syncWallOpenings,
    detachWallOpenings,
    migrateOpeningAttachments,
    WALL_EQUIPMENT_TYPES,
    equipmentMountKind,
    attachEquipmentToWall,
    attachEquipmentToNearestWall,
    syncEquipmentToWall,
    syncWallEquipment,
    detachEquipmentFromWall,
    detachWallEquipment,
    migrateEquipmentAttachments,
    scenePresetConfig,
    escapeHtml,
    validateProjectData,
    rescaleProjectGeometry,
    routeCableSegment,
    cameraMoveVector,
    migrateLegacyDefaults
  });
});
