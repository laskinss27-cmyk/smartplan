'use strict';
// ═══════════════════════════════════════════════════════════
// MODES / TOOLS
// ═══════════════════════════════════════════════════════════
function setMode(m){
  G.mode=m;
  document.getElementById('t2d').classList.toggle('on',m==='2d');
  document.getElementById('t3d').classList.toggle('on',m==='3d');
  document.getElementById('c2').style.display=m==='2d'?'block':'none';
  document.getElementById('c3').style.display=m==='3d'?'block':'none';
  document.getElementById('tg2').style.display=m==='2d'?'flex':'none';
  document.getElementById('tg3').style.display=m==='3d'?'flex':'none';
  document.getElementById('gbar').style.display=m==='2d'?'flex':'none';
  document.getElementById('coords').style.display=m==='2d'?'flex':'none';
  document.getElementById('hint2d').style.display=m==='2d'?'block':'none';
  document.getElementById('info3').style.display=m==='3d'?'block':'none';
  document.getElementById('spdbadge').style.display=m==='3d'?'block':'none';
  document.getElementById('scene-preset-btn').style.display=m==='3d'?'flex':'none';
  document.getElementById('cablebox').style.display=(m==='3d'&&G.cables.length>0)?'block':'none';
  document.getElementById('cable-leg').style.display=(m==='3d'&&G.cables.length>0)?'block':'none';
  if(m==='3d')requestAnimationFrame(()=>requestAnimationFrame(()=>{initThree();autoCamera();updateCableUI();}));
  else{migrateWalls();closeP();rd();}
}
function setTool(t){
  G.tool=t;G.drawOn=false;G.drawS=null;G.drawC=null;desel();
  document.querySelectorAll('#tg2 .tb').forEach(b=>b.classList.remove('on'));
  const ids={wall:'tw',door:'td',window:'twin',measure:'tr2',select:'tv'};
  document.getElementById(ids[t])?.classList.add('on');
  rd();
}
// Авто-позиционирование камеры при входе в 3D
function autoCamera(){
  if(!G.walls.length){return;} // нет стен — не трогаем
  // Bounding box всех стен
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  G.walls.forEach(w=>{
    minX=Math.min(minX,w.x1,w.x2);maxX=Math.max(maxX,w.x1,w.x2);
    minZ=Math.min(minZ,w.y1,w.y2);maxZ=Math.max(maxZ,w.y1,w.y2);
  });
  const cx=(minX+maxX)/2, cz=(minZ+maxZ)/2;
  const szX=maxX-minX, szZ=maxZ-minZ;
  const sz=Math.max(szX,szZ,50);
  const f=G.fps;
  // Позиция: чуть снаружи bounding box, на высоте человека
  f.x=cx; f.y=wh3d()*0.6; f.z=maxZ+sz*0.7;
  // Смотрим в центр помещения
  const dx=cx-f.x, dz=cz-f.z;
  f.yaw=Math.atan2(dx,dz);
  f.pitch=-0.15;
  updCam();
}

function v3(v){
  const f=G.fps;
  let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
  G.walls.forEach(w=>{minX=Math.min(minX,w.x1,w.x2);maxX=Math.max(maxX,w.x1,w.x2);minZ=Math.min(minZ,w.y1,w.y2);maxZ=Math.max(maxZ,w.y1,w.y2);});
  if(!isFinite(minX)){minX=0;maxX=200;minZ=0;maxZ=200;}
  const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2;
  const sz=Math.max(maxX-minX,maxZ-minZ,50);
  if(v==='iso'){f.x=cx+sz*0.8;f.y=sz*0.7;f.z=cz+sz*0.8;f.yaw=-2.36;f.pitch=-0.45;}
  else if(v==='top'){f.x=cx;f.y=sz*1.5;f.z=cz+1;f.yaw=0;f.pitch=-1.4;}
  else if(v==='fr'){f.x=cx;f.y=wh3d()*0.6;f.z=maxZ+sz*0.6;f.yaw=Math.PI;f.pitch=-0.1;}
  updCam();
}

// ═══════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════
let _autoSaveTimer=null;
function historySnapshot(){
  return JSON.stringify({
    verts:G.verts,walls:G.walls,doors:G.doors,windows:G.windows,equip:G.equip,
    measures:G.measures,cables:G.cables,comments:G.comments,customEq:G.customEq,
    sc:G.sc,gs:G.gs,nextId:G.nextId,nextVid:G.nextVid,nextWallId:G.nextWallId
  });
}
function restoreHistorySnapshot(snapshot){
  const s=JSON.parse(snapshot);
  G.verts=s.verts||[];G.walls=s.walls||[];G.doors=s.doors||[];G.windows=s.windows||[];
  G.equip=s.equip||[];G.measures=s.measures||[];G.cables=s.cables||[];G.comments=s.comments||[];
  G.customEq=s.customEq||[];G.sc=Core.normalizeScale(s.sc,G.sc);G.gs=Number.isFinite(s.gs)?s.gs:G.gs;
  G.nextId=s.nextId||1;G.nextVid=s.nextVid||1;G.nextWallId=s.nextWallId||1;
  G.floors=Math.max(1,...G.walls.map(w=>w.floor||1),...G.equip.map(e=>e.floor||1));
  G.floor=Math.min(G.floor||1,G.floors);
  G.dragEq2d=null;G.selEqId3=-1;G.cablePts=[];G.cableStepSizes=[];
  if(typeof VD!=='undefined'){VD.mode=null;VD.vid=null;VD.wIdx=null;VD.started=false;}
  syncProjectControls();registerCustomEqDefinitions();renderCustomEqPanel();migrateWalls();
  G.sel=null;G.drawOn=false;G.drawS=null;G.drawC=null;G._dragging=false;closeP();
  if(G.mode==='2d')rd();else buildScene3();
  updateCableUI();
}
function scheduleAutoSave(){
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer=setTimeout(()=>{if(autoSave())showSaveBadge();},800);
}
const projectHistory=Core.createSnapshotHistory(historySnapshot,restoreHistorySnapshot,{
  limit:60,
  undoStack:G.hist,
  redoStack:G.future,
  onChange:event=>{if(event!=='rollback')scheduleAutoSave();}
});
function beginProjectChange(label){return projectHistory.begin(label);}
function commitProjectChange(label){return projectHistory.commit(label);}
function cancelProjectChange(){return projectHistory.cancel();}
function runProjectChange(label,mutator){return projectHistory.run(label,mutator);}
function resetProjectHistory(){projectHistory.reset();}
function undo(){projectHistory.undo();}
function redo(){projectHistory.redo();}

const _propertyPanelBody=document.getElementById('pb');
_propertyPanelBody.addEventListener('focusin',e=>{
  if(e.target.matches('input,select,textarea'))beginProjectChange('property');
});
_propertyPanelBody.addEventListener('input',e=>{
  if(e.target.matches('input,select,textarea'))scheduleAutoSave();
});
function commitPropertyEdit(){
  commitProjectChange('property');
}
_propertyPanelBody.addEventListener('change',commitPropertyEdit);
_propertyPanelBody.addEventListener('focusout',commitPropertyEdit);

function clearAll(){
  if(!confirm('Очистить всё?'))return;
  runProjectChange('clear',()=>{
    G.verts=[];G.walls=[];G.doors=[];G.windows=[];G.equip=[];G.measures=[];G.cables=[];G.comments=[];G.cablePts=[];G.cableStepSizes=[];G.cableType=null;
    // Кастомное оборудование сохраняется — пользователь его настраивал отдельно
    G.drawOn=false;G.drawS=null;G.drawC=null;G.sel=null;
  });
  closeP();if(G.mode==='2d')rd();else buildScene3();updateCableUI();
}

