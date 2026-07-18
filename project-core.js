(function initSmartPlanCore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SmartPlanCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSmartPlanCore() {
  'use strict';

  const DEFAULT_SCALE = 0.1;
  const DEFAULT_SNAP_METERS = 0.25;
  const DEFAULT_WALL_THICKNESS_METERS = 0.2;
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

  function migrateLegacyDefaults(data) {
    const scale = normalizeScale(data.sc);
    if (data.modelRevision >= 2) return data;
    (data.walls || []).forEach((wall) => {
      if (wall && wall.th === 8) wall.th = defaultWallThicknessUnits(scale);
    });
    data.modelRevision = 2;
    return data;
  }

  return Object.freeze({
    DEFAULT_SCALE,
    DEFAULT_SNAP_METERS,
    DEFAULT_WALL_THICKNESS_METERS,
    normalizeScale,
    metersToUnits,
    unitsToMeters,
    defaultWallThicknessUnits,
    escapeHtml,
    validateProjectData,
    rescaleProjectGeometry,
    migrateLegacyDefaults
  });
});
