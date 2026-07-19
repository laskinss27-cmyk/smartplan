'use strict';
// CSS переменные с fallback — должна быть определена первой
function getVar(name,fallback=''){
  try{
    const v=(getComputedStyle(document.documentElement).getPropertyValue(name)||'').trim();
    return v||fallback;
  }catch(e){return fallback;}
}
function _hex2int(h,fb){
  const s=(h||'').trim().replace(/^#/,'');
  if(/^[0-9a-f]{6}$/i.test(s))return parseInt(s,16);
  return fb;
}
// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════
const Core=window.SmartPlanCore;
const G={
  mode:'2d', tool:'wall', tool3:'nav',
  scenePreset:'technical',
  snap:true, gs:Core.DEFAULT_SNAP_METERS/Core.DEFAULT_SCALE, sc:Core.DEFAULT_SCALE,
  verts:[], walls:[], doors:[], equip:[], measures:[], cables:[], comments:[], customEq:[],
  sel:null, dragEq2d:null, selEqId3:-1,
  drawOn:false, drawS:null, drawC:null,
  pan:{x:0,y:0}, zoom:1, panning:false, panF:null,
  nextId:1, nextVid:1, nextWallId:1, hist:[], future:[],
  // WALL_H computed as wh3d()
  // FPS camera
  fps:{x:0,y:180,z:600,yaw:-1.57,pitch:-0.3,speed:8,keys:{},mouseDown:false,lx:0,ly:0,locked:false},
  // 3D
  R:null,SC:null,CAM:null,_animStarted:false,_kbSet:false,
  // Cable drawing
  cableType:null, cablePts:[], cableStepSizes:[],
  // 3D move
  moveObj:null, movePlane:null,
  // Display toggles
  showCeiling:false,
  // Windows (оконные проёмы)
  windows:[],
  // Floors
  floor:1, floors:1,
};

function syncProjectControls(){
  const scale=document.getElementById('scl');
  if(scale)scale.value=String(G.sc);
  const snapMeters=Core.unitsToMeters(G.gs,G.sc);
  const snap=document.getElementById('gsz');
  if(snap)snap.value=String(Math.max(0.05,Math.min(1,snapMeters)));
  const snapLabel=document.getElementById('gszv');
  if(snapLabel)snapLabel.textContent=snapMeters.toFixed(2)+'м';
}

function setProjectScale(value){
  const nextScale=Core.normalizeScale(value,G.sc);
  if(nextScale===G.sc){syncProjectControls();return;}
  savH();
  Core.rescaleProjectGeometry(G,G.sc,nextScale);
  G.sc=nextScale;
  syncAllWalls();
  syncProjectControls();
  if(G.sel)showP(G.sel.t,G.sel.i);
  refresh3d();
}

let _snapEditOpen=false;
let _snapEditTimer=null;
function setSnapMeters(value){
  const meters=Math.max(0.05,Math.min(1,Number(value)||Core.DEFAULT_SNAP_METERS));
  if(!_snapEditOpen){savH();_snapEditOpen=true;}
  G.gs=Core.metersToUnits(meters,G.sc);
  document.getElementById('gszv').textContent=meters.toFixed(2)+'м';
  clearTimeout(_snapEditTimer);
  _snapEditTimer=setTimeout(()=>{_snapEditOpen=false;},400);
  scheduleAutoSave();
  rd();
}

// 3D height helpers: wall=2.5m, door=2.0m, equip size=0.4m
const wh3d=()=>2.5/G.sc;       // wall height in px-units
const dh3d=()=>2.0/G.sc;       // door height
const eqSz=()=>0.4/G.sc;       // equipment size (~40cm cube)
const eqOff=()=>0.08/G.sc;     // equipment depth offset from wall (8cm)
const EQ_NAMES={camera:'Камера IP',doorbell:'Вызывная панель',monitor:'Монитор домофона',socket:'Розетка',panel:'Электрощит',light:'Светильник',heat:'Радиатор',nvr:'NVR/Роутер',ac:'Кондиционер',pillar:'Столб/Колонна',tree:'Дерево'};
const EQ_MOUNT={camera:'wall',doorbell:'wall',monitor:'wall',socket:'wall',panel:'wall',light:'any',heat:'wall',nvr:'wall',ac:'wall',pillar:'floor',tree:'floor'};
const EQ_COL3={camera:0x4c8ef7,doorbell:0xf0a832,monitor:0x4c8ef7,socket:0x8892b0,panel:0xf0a832,light:0xffc840,heat:0xe84444,nvr:0x2dd87a,ac:0x26d4e8,pillar:0x8a7560,tree:0x4a8c3a};
const EQ_COL2={camera:'#4c8ef7',doorbell:'#f0a832',monitor:'#4c8ef7',socket:'#7a84a8',panel:'#f0a832',light:'#f0a832',heat:'#e84444',nvr:'#2dd87a',ac:'#26d4e8',pillar:'#8a7560',tree:'#4a8c3a'};
const CABLE_COL={utp:'#f0a832',shvvp:'#2dd87a'};
const CABLE_LAB={utp:'UTP',shvvp:'ШВВП'};

