'use strict';
// ═══════════════════════════════════════════════════════════
// 2D CANVAS
// ═══════════════════════════════════════════════════════════
const cv=document.getElementById('c2');
const CX=cv.getContext('2d');
function rsz(){
  const w=document.getElementById('cw');
  cv.width=w.clientWidth;cv.height=w.clientHeight;
  if(G.mode==='2d')rd();else if(G.R)rsz3();
}
window.addEventListener('resize',rsz);setTimeout(rsz,0);

const sn=v=>G.snap?Math.round(v/G.gs)*G.gs:v;
const s2w=(sx,sy)=>({x:(sx-G.pan.x)/G.zoom,y:(sy-G.pan.y)/G.zoom});
const L=Core.distance2d;
const px2m=px=>(px*G.sc).toFixed(2);
const escHtml=Core.escapeHtml;
const wallThicknessUnits=w=>Number.isFinite(w?.th)?w.th:Core.defaultWallThicknessUnits(G.sc);

// ── VERTEX SYSTEM ──────────────────────────────────────────
// Snap radius: прилипать к существующей вершине если ближе этого расстояния
const VSNAP=14; // px в экранных координатах

// Найти ближайшую вершину в мировых координатах
function nearVert(wx,wy){
  let best=null,bestD=999999;
  G.verts.forEach(v=>{
    const d=Math.sqrt((v.x-wx)**2+(v.y-wy)**2);
    if(d<bestD){bestD=d;best=v;}
  });
  // Конвертируем порог VSNAP из экранных в мировые координаты
  const worldSnap=VSNAP/G.zoom;
  return bestD<worldSnap?best:null;
}

// Создать вершину или вернуть существующую рядом
function getOrCreateVert(wx,wy){
  const existing=nearVert(wx,wy);
  if(existing)return existing;
  const v={id:G.nextVid++,x:sn(wx),y:sn(wy)};
  G.verts.push(v);
  return v;
}

// Обновить x1/y1/x2/y2 у стены из вершин
function syncWallCoords(w){
  Core.syncWallFromVertices(w,G.verts);
}
function syncAllWalls(){G.walls.forEach(syncWallCoords);}

// Мигрировать старые стены без вершин
function migrateWalls(){
  G.walls.forEach(w=>{
    if(w.v1id==null){
      const v1=getOrCreateVert(w.x1,w.y1);
      const v2=getOrCreateVert(w.x2,w.y2);
      w.v1id=v1.id; w.v2id=v2.id;
    }
  });
}

// Удалить вершины без ссылок
function cleanVerts(){
  Core.removeUnusedWallVertices(G);
}

// Отвязать одну вершину стены от соседей (создать приватную копию)
function detachWallVert(wIdx, key, nx, ny){
  Core.detachWallEndpoint(G,wIdx,key,nx,ny);
}

// Полностью отвязать стену от общих вершин перед перемещением
function detachWallFull(wIdx){
  Core.detachWallVertices(G,wIdx);
}

// ── VERTEX DRAG STATE ──
const VD={
  mode:null,   // 'vert' | 'wall' | null
  vid:null,    // id вершины при mode='vert'
  wIdx:null,   // индекс стены при mode='wall'
  dx:0,dy:0,  // смещение при перетаскивании стены
};

const dSeg=Core.pointToSegmentDistance2d;
function hRGB(h){return `${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)}`;}

function rd(){
  const W=cv.width,H=cv.height;
  CX.clearRect(0,0,W,H);CX.fillStyle=getVar('--cv-bg',G._lightTheme?'#f8f9fb':'#07090e');CX.fillRect(0,0,W,H);
  CX.save();CX.translate(G.pan.x,G.pan.y);CX.scale(G.zoom,G.zoom);
  grid2d(W,H);walls2d();doors2d();windows2d();equip2d();msr2d();ghost2d();if(G.verts.length)verts2d();
  CX.restore();
}
function grid2d(W,H){
  const gs=G.gs,ox=-G.pan.x/G.zoom,oy=-G.pan.y/G.zoom;
  const sx=Math.floor(ox/gs)*gs,sy=Math.floor(oy/gs)*gs;
  const ex=sx+W/G.zoom+gs*2,ey=sy+H/G.zoom+gs*2;
  CX.strokeStyle=getVar('--cv-grid1',G._lightTheme?'#e0e4ec':'#111628');CX.lineWidth=.5;
  for(let x=sx;x<ex;x+=gs){CX.beginPath();CX.moveTo(x,sy);CX.lineTo(x,ey);CX.stroke();}
  for(let y=sy;y<ey;y+=gs){CX.beginPath();CX.moveTo(sx,y);CX.lineTo(ex,y);CX.stroke();}
  CX.strokeStyle=getVar('--cv-grid2',G._lightTheme?'#d0d5e0':'#181e36');CX.lineWidth=.8;
  const mg=gs*5,smx=Math.floor(ox/mg)*mg,smy=Math.floor(oy/mg)*mg;
  for(let x=smx;x<ex;x+=mg){CX.beginPath();CX.moveTo(x,sy);CX.lineTo(x,ey);CX.stroke();}
  for(let y=smy;y<ey;y+=mg){CX.beginPath();CX.moveTo(sx,y);CX.lineTo(ex,y);CX.stroke();}
  CX.strokeStyle=getVar('--cv-axis',G._lightTheme?'#b0b8cc':'#222a48');CX.lineWidth=1;
  CX.beginPath();CX.moveTo(0,sy);CX.lineTo(0,ey);CX.stroke();
  CX.beginPath();CX.moveTo(sx,0);CX.lineTo(ex,0);CX.stroke();
}
function _onFloor(obj){return (obj.floor||1)===G.floor;}
function walls2d(){
  G.walls.forEach((w,i)=>{
    if(!_onFloor(w))return;
    const sel=G.sel&&G.sel.t==='wall'&&G.sel.i===i;
    const th=Math.max(wallThicknessUnits(w),2/G.zoom);
    CX.strokeStyle=sel?getVar('--cv-wall-sel'):getVar('--cv-wall');CX.lineWidth=th;CX.lineCap='square';
    CX.shadowColor=sel?'rgba(80,160,255,.3)':'transparent';CX.shadowBlur=sel?8:0;
    CX.beginPath();CX.moveTo(w.x1,w.y1);CX.lineTo(w.x2,w.y2);CX.stroke();CX.shadowBlur=0;
    const ang=Math.atan2(w.y2-w.y1,w.x2-w.x1),hh=th/2;
    const dx=Math.sin(ang)*hh,dy=-Math.cos(ang)*hh;
    CX.strokeStyle=sel?'rgba(100,160,255,.5)':(G._lightTheme?'rgba(40,80,140,.25)':'rgba(80,130,180,.28)');CX.lineWidth=.8/G.zoom;CX.lineCap='butt';
    [[dx,dy],[-dx,-dy]].forEach(([a,b])=>{CX.beginPath();CX.moveTo(w.x1+a,w.y1+b);CX.lineTo(w.x2+a,w.y2+b);CX.stroke();});
    wLabel(w.x1,w.y1,w.x2,w.y2,px2m(L(w.x1,w.y1,w.x2,w.y2))+' м  t:'+(wallThicknessUnits(w)*G.sc).toFixed(2)+'м',sel?'#80b0e0':'#4a6888');
  });
}
// Рисуем вершины поверх стен
function verts2d(){
  G.verts.forEach(v=>{
    const isDragging=VD.mode==='vert'&&VD.vid===v.id;
    const isSnap=!isDragging&&nearVert(lastMouse.x,lastMouse.y)?.id===v.id;
    CX.beginPath();CX.arc(v.x,v.y,(isDragging?6:isSnap?5:3.5)/G.zoom,0,Math.PI*2);
    CX.fillStyle=isDragging?'#f0c830':isSnap?'rgba(240,200,48,.8)':'rgba(100,160,220,.6)';
    CX.fill();
    if(isSnap||isDragging){
      CX.strokeStyle='#f0c830';CX.lineWidth=1/G.zoom;CX.stroke();
    }
  });
}
let lastMouse={x:0,y:0};
function wLabel(x1,y1,x2,y2,txt,col){
  const mx=(x1+x2)/2,my=(y1+y2)/2,ang=Math.atan2(y2-y1,x2-x1);
  CX.save();CX.translate(mx,my);CX.rotate(ang);
  const fs=11/G.zoom;CX.font=`${fs}px monospace`;
  const tw=CX.measureText(txt).width;
  CX.fillStyle=G._lightTheme?'rgba(240,242,248,.92)':'rgba(7,9,14,.85)';CX.fillRect(-tw/2-3/G.zoom,-fs-3/G.zoom,tw+6/G.zoom,fs+4/G.zoom);
  CX.fillStyle=col;CX.textAlign='center';CX.textBaseline='bottom';CX.fillText(txt,0,0);
  CX.restore();
}
function doors2d(){
  G.doors.forEach((d,i)=>{
    if(!_onFloor(d))return;
    const sel=G.sel&&G.sel.t==='door'&&G.sel.i===i;
    const ang=Math.atan2(d.y2-d.y1,d.x2-d.x1),l=L(d.x1,d.y1,d.x2,d.y2);
    CX.save();CX.translate(d.x1,d.y1);CX.rotate(ang);
    CX.strokeStyle='#07090e';CX.lineWidth=14/G.zoom;CX.lineCap='butt';
    CX.beginPath();CX.moveTo(0,0);CX.lineTo(l,0);CX.stroke();
    CX.strokeStyle=sel?'#ffc060':'#f0a832';CX.lineWidth=2/G.zoom;CX.lineCap='round';
    CX.beginPath();CX.moveTo(0,0);CX.lineTo(l*.9,0);CX.stroke();
    CX.strokeStyle=sel?'rgba(255,192,96,.55)':'rgba(240,168,50,.38)';
    CX.lineWidth=1/G.zoom;CX.setLineDash([3/G.zoom,2/G.zoom]);
    CX.beginPath();CX.arc(0,0,l*.9,0,Math.PI/2);CX.stroke();CX.setLineDash([]);
    CX.fillStyle=sel?'#ffc060':'#f0a832';CX.beginPath();CX.arc(0,0,2.5/G.zoom,0,Math.PI*2);CX.fill();
    CX.restore();
  });
}
function windows2d(){
  G.windows.forEach((w,i)=>{
    if(!_onFloor(w))return;
    const sel=G.sel&&G.sel.t==='window'&&G.sel.i===i;
    const ang=Math.atan2(w.y2-w.y1,w.x2-w.x1),l=L(w.x1,w.y1,w.x2,w.y2);
    CX.save();CX.translate(w.x1,w.y1);CX.rotate(ang);
    // Фон (прорезь в стене)
    CX.strokeStyle='#07090e';CX.lineWidth=14/G.zoom;CX.lineCap='butt';
    CX.beginPath();CX.moveTo(0,0);CX.lineTo(l,0);CX.stroke();
    // Двойная линия (стекло)
    const off=2/G.zoom;
    CX.strokeStyle=sel?'#80d0ff':'#40a8d8';CX.lineWidth=1.5/G.zoom;CX.lineCap='round';
    CX.beginPath();CX.moveTo(0,-off);CX.lineTo(l,-off);CX.moveTo(0,off);CX.lineTo(l,off);CX.stroke();
    // Центральная линия
    CX.strokeStyle=sel?'rgba(128,208,255,.4)':'rgba(64,168,216,.25)';CX.lineWidth=0.5/G.zoom;
    CX.beginPath();CX.moveTo(l/2,-off*2);CX.lineTo(l/2,off*2);CX.stroke();
    CX.restore();
  });
}
function equip2d(){
  G.equip.forEach((eq,i)=>{
    // Деревья и столбы — ландшафт/конструкции, видны на всех этажах
    if(eq.type!=='tree'&&eq.type!=='pillar'&&!_onFloor(eq))return;
    const sel=G.sel&&G.sel.t==='eq'&&G.sel.i===i;
    const _isCamera=eq.type==='camera'||(G.customEq.find(c=>c.type===eq.type)?.behavior==='camera');
    if(_isCamera&&eq.fovOn!==false){
      const fa=(eq.fovA||60)*Math.PI/180,fd=eq.fovD||120;
      // Базовый угол = нормаль ближайшей стены (как в 3D), + eq.ang как доп. поворот
      let baseAng=0;
      let bwD=999999;
      G.walls.forEach(w=>{
        const d=dSeg(eq.x,eq.y,w.x1,w.y1,w.x2,w.y2);
        if(d<bwD){
          bwD=d;
          const wa=Math.atan2(w.y2-w.y1,w.x2-w.x1);
          const nx=Math.sin(wa),nz=-Math.cos(wa);
          const dot=(eq.x-w.x1)*nx+(eq.y-w.y1)*nz;
          const side=dot>=0?1:-1;
          // Нормаль стены в 2D (наружу) = угол нормали
          baseAng=Math.atan2(nz*side,nx*side);
        }
      });
      const ra=-(eq.ang||0)*Math.PI/180+baseAng; // минус: 2D canvas Y вниз, 3D Y вверх
      CX.save();CX.translate(eq.x,eq.y);CX.rotate(ra);
      const g=CX.createRadialGradient(0,0,0,0,0,fd);
      g.addColorStop(0,'rgba(76,142,247,.2)');g.addColorStop(1,'rgba(76,142,247,.02)');
      CX.beginPath();CX.moveTo(0,0);CX.arc(0,0,fd,-fa/2,fa/2);CX.closePath();
      CX.fillStyle=g;CX.fill();
      CX.strokeStyle=sel?'rgba(120,180,255,.55)':'rgba(76,142,247,.35)';CX.lineWidth=1/G.zoom;CX.stroke();
      CX.restore();
    }
    const r=12,col=EQ_COL2[eq.type]||'#888';
    if(sel){CX.shadowColor=col+'99';CX.shadowBlur=10/G.zoom;}
    const _ceqDef=G.customEq.find(c=>c.type===eq.type);
    const _svgImg=_ceqDef?.svgData?getSvgImg(eq.type,_ceqDef.svgData):null;
    if(eq.type==='pillar'){
      // Столб: квадрат с перекрестием
      const ps=(eq.pillarW||0.3)/G.sc/2;
      CX.fillStyle='rgba(50,40,30,.85)';CX.strokeStyle=sel?col:`rgba(${hRGB(col)},.8)`;
      CX.lineWidth=(sel?2:1.5)/G.zoom;CX.fillRect(eq.x-ps,eq.y-ps,ps*2,ps*2);CX.strokeRect(eq.x-ps,eq.y-ps,ps*2,ps*2);
      CX.strokeStyle=`rgba(${hRGB(col)},.4)`;CX.lineWidth=.5/G.zoom;
      CX.beginPath();CX.moveTo(eq.x-ps,eq.y-ps);CX.lineTo(eq.x+ps,eq.y+ps);CX.moveTo(eq.x+ps,eq.y-ps);CX.lineTo(eq.x-ps,eq.y+ps);CX.stroke();
    }else if(eq.type==='tree'){
      // Дерево: зелёный круг (крона) + точка (ствол)
      const cr=(eq.treeR||1.5)/G.sc;
      CX.beginPath();CX.arc(eq.x,eq.y,cr,0,Math.PI*2);
      CX.fillStyle='rgba(40,100,30,.25)';CX.strokeStyle=sel?'#6bc04a':'rgba(74,140,58,.6)';
      CX.lineWidth=(sel?2:1)/G.zoom;CX.fill();CX.stroke();
      CX.beginPath();CX.arc(eq.x,eq.y,3/G.zoom,0,Math.PI*2);
      CX.fillStyle='#6b4e2a';CX.fill();
    }else{
      CX.beginPath();CX.arc(eq.x,eq.y,r/G.zoom,0,Math.PI*2);
      CX.fillStyle='rgba(7,9,14,.92)';CX.strokeStyle=sel?col:`rgba(${hRGB(col)},.7)`;
      CX.lineWidth=(sel?2:1.5)/G.zoom;CX.fill();CX.stroke();
      if(_svgImg){
        try{const sz=18/G.zoom;CX.save();CX.globalAlpha=0.92;CX.drawImage(_svgImg,eq.x-sz/2,eq.y-sz/2,sz,sz);CX.restore();}catch(e){}
      }else{
        CX.fillStyle=col;CX.font=`bold ${9/G.zoom}px monospace`;
        CX.textAlign='center';CX.textBaseline='middle';
        CX.fillText({camera:'C',doorbell:'D',monitor:'M',socket:'S',panel:'P',light:'L',heat:'H',nvr:'N',ac:'AC'}[eq.type]||'?',eq.x,eq.y);
      }
    }
    CX.shadowBlur=0;
    const typeLbl={camera:'Камера',doorbell:'Вызывная панель',monitor:'Монитор',socket:'Розетка',panel:'Электрощит',light:'Свет',heat:'Радиатор',nvr:'NVR',ac:'Кондиц.',pillar:'Столб',tree:'Дерево'}[eq.type]||(EQ_NAMES[eq.type]||eq.type);
    CX.fillStyle=sel?'#b8ccf0':'#5a7a9a';
    CX.font=`bold ${9/G.zoom}px Arial`;
    CX.textBaseline='top';
    CX.fillText(typeLbl, eq.x, eq.y+(r+2)/G.zoom);
    if(eq.name && eq.name!==typeLbl && eq.name!==(EQ_NAMES[eq.type]||'')){
      CX.fillStyle=sel?'#90b0d8':'#3a5070';
      CX.font=`${8/G.zoom}px Arial`;
      CX.fillText(eq.name, eq.x, eq.y+(r+12)/G.zoom);
    }
  });
}
function msr2d(){
  G.measures.forEach(m=>msrLine(m.x1,m.y1,m.x2,m.y2));
  if(G.drawOn&&G.tool==='measure'&&G.drawS&&G.drawC)msrLine(G.drawS.x,G.drawS.y,G.drawC.x,G.drawC.y,true);
}
function msrLine(x1,y1,x2,y2,ghost=false){
  const l=L(x1,y1,x2,y2);if(l<2)return;
  const ang=Math.atan2(y2-y1,x2-x1),col=ghost?'rgba(45,216,122,.4)':'#2dd87a',tl=8/G.zoom;
  CX.strokeStyle=col;CX.lineWidth=1/G.zoom;
  CX.setLineDash([4/G.zoom,2/G.zoom]);CX.beginPath();CX.moveTo(x1,y1);CX.lineTo(x2,y2);CX.stroke();CX.setLineDash([]);
  [[x1,y1],[x2,y2]].forEach(([px,py])=>{
    CX.beginPath();CX.moveTo(px-Math.sin(ang)*tl,py+Math.cos(ang)*tl);CX.lineTo(px+Math.sin(ang)*tl,py-Math.cos(ang)*tl);CX.stroke();
    CX.fillStyle=col;CX.beginPath();CX.arc(px,py,2.5/G.zoom,0,Math.PI*2);CX.fill();
  });
  const mx=(x1+x2)/2,my=(y1+y2)/2;
  CX.save();CX.translate(mx,my);
  const la=Math.abs(ang)>Math.PI/2?ang+Math.PI:ang;CX.rotate(la);
  const fs=10/G.zoom,txt=px2m(l)+' м';CX.font=`bold ${fs}px monospace`;
  const tw=CX.measureText(txt).width,pad=3/G.zoom;
  CX.fillStyle='rgba(7,9,14,.92)';CX.strokeStyle=col;CX.lineWidth=.7/G.zoom;
  CX.beginPath();CX.roundRect(-tw/2-pad,-fs-pad,tw+pad*2,fs+pad*2,2/G.zoom);CX.fill();CX.stroke();
  CX.fillStyle=col;CX.textAlign='center';CX.textBaseline='bottom';CX.fillText(txt,0,0);
  CX.restore();
}
function ghost2d(){
  if(!G.drawOn||!G.drawS||!G.drawC)return;
  const s=G.drawS,e=G.drawC;
  // Подсветка вершины для прилипания
  if(G.tool==='wall'||G.tool==='door'||G.tool==='window'){
    const sv=nearVert(G.drawC?G.drawC.x:0, G.drawC?G.drawC.y:0);
    if(sv){
      CX.beginPath();CX.arc(sv.x,sv.y,6/G.zoom,0,Math.PI*2);
      CX.strokeStyle='#f0c830';CX.lineWidth=1.5/G.zoom;CX.stroke();
      CX.fillStyle='rgba(240,200,48,.2)';CX.fill();
    }
    const sv2=G.drawStart?nearVert(G.drawStart.x,G.drawStart.y):null;
    if(sv2){
      CX.beginPath();CX.arc(sv2.x,sv2.y,5/G.zoom,0,Math.PI*2);
      CX.fillStyle='rgba(240,200,48,.5)';CX.fill();
    }
  }
  if(G.tool==='wall'){
    CX.shadowColor='rgba(80,160,255,.35)';CX.shadowBlur=6/G.zoom;
    CX.strokeStyle='rgba(100,180,255,.85)';CX.lineWidth=8/G.zoom;CX.lineCap='round';
    CX.beginPath();CX.moveTo(s.x,s.y);CX.lineTo(e.x,e.y);CX.stroke();CX.shadowBlur=0;
    const l=L(s.x,s.y,e.x,e.y),ang=Math.atan2(e.y-s.y,e.x-s.x);
    CX.save();CX.translate((s.x+e.x)/2,(s.y+e.y)/2);CX.rotate(ang);
    CX.fillStyle='#90c8ff';CX.font=`bold ${13/G.zoom}px monospace`;CX.textAlign='center';
    CX.fillText(px2m(l)+' м',0,-15/G.zoom);CX.restore();
    CX.fillStyle='#80c8ff';CX.beginPath();CX.arc(s.x,s.y,4/G.zoom,0,Math.PI*2);CX.fill();
  }
  if(G.tool==='door'){
    const ang=Math.atan2(e.y-s.y,e.x-s.x),l=L(s.x,s.y,e.x,e.y);
    CX.save();CX.translate(s.x,s.y);CX.rotate(ang);
    CX.strokeStyle='rgba(240,168,50,.72)';CX.lineWidth=2/G.zoom;CX.lineCap='round';
    CX.beginPath();CX.moveTo(0,0);CX.lineTo(l*.9,0);CX.stroke();
    CX.setLineDash([3/G.zoom,2/G.zoom]);CX.beginPath();CX.arc(0,0,l*.9,0,Math.PI/2);CX.stroke();CX.setLineDash([]);CX.restore();
  }
  if(G.tool==='window'){
    const ang=Math.atan2(e.y-s.y,e.x-s.x),l=L(s.x,s.y,e.x,e.y);
    CX.save();CX.translate(s.x,s.y);CX.rotate(ang);
    const off=2/G.zoom;
    CX.strokeStyle='rgba(64,168,216,.72)';CX.lineWidth=1.5/G.zoom;CX.lineCap='round';
    CX.beginPath();CX.moveTo(0,-off);CX.lineTo(l,-off);CX.moveTo(0,off);CX.lineTo(l,off);CX.stroke();
    CX.restore();
  }
}

// ═══════════════════════════════════════════════════════════
// 2D EVENTS
// ═══════════════════════════════════════════════════════════
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('mousemove',e=>{
  const rc=cv.getBoundingClientRect(),sx=e.clientX-rc.left,sy=e.clientY-rc.top;
  if(G.panning){G.pan.x+=sx-G.panF.x;G.pan.y+=sy-G.panF.y;G.panF={x:sx,y:sy};rd();return;}
  const raw=s2w(sx,sy),wx=sn(raw.x),wy=sn(raw.y);
  document.getElementById('cx').textContent=px2m(wx)+'м';
  document.getElementById('cy').textContent=px2m(wy)+'м';
  lastMouse={x:wx,y:wy};
  if(G.drawOn){
    if(G.drawS&&Math.abs(wx-G.drawS.x)+Math.abs(wy-G.drawS.y)>3) G._dragging=true;
    G.drawC={x:wx,y:wy};rd();
  }
  // Перетаскивание вершины
  if(VD.mode==='vert'){
    const v=G.verts.find(v=>v.id===VD.vid);
    if(v){
      v.x=sn(wx);v.y=sn(wy);
      // Snap к другим вершинам
      const near=G.verts.find(ov=>ov.id!==v.id&&Math.sqrt((ov.x-wx)**2+(ov.y-wy)**2)<VSNAP/G.zoom);
      if(near){v.x=near.x;v.y=near.y;}
      syncAllWalls();rd();
    }
    return;
  }
  // Перетаскивание стены целиком
  if(VD.mode==='wall'){
    const w=G.walls[VD.wIdx];
    const v1=G.verts.find(v=>v.id===w.v1id);
    const v2=G.verts.find(v=>v.id===w.v2id);
    if(v1&&v2){
      // Снапим только v1, v2 = v1 + исходный вектор → длина стены не меняется
      v1.x=sn(wx+VD.ox1);v1.y=sn(wy+VD.oy1);
      v2.x=v1.x+VD.wdx;v2.y=v1.y+VD.wdy;
      syncAllWalls();rd();
    }
    return;
  }
  if(G.dragEq2d!==null){G.equip[G.dragEq2d].x=wx;G.equip[G.dragEq2d].y=wy;rd();}
});
cv.addEventListener('mousedown',e=>{
  if(e.button===1||(e.button===0&&e.altKey)){
    const rc=cv.getBoundingClientRect();G.panning=true;G.panF={x:e.clientX-rc.left,y:e.clientY-rc.top};cv.style.cursor='grabbing';return;
  }
  if(e.button===2){
    G.panning=false;G.dragEq2d=null;VD.mode=null;VD.vid=null;VD.wIdx=null;
    setTool('select');cv.style.cursor='crosshair';return;
  }
  const rc=cv.getBoundingClientRect(),raw=s2w(e.clientX-rc.left,e.clientY-rc.top),wx=sn(raw.x),wy=sn(raw.y);
  if(G.tool==='select'){
    const ei=findEq(wx,wy);
    if(ei!==null){G.dragEq2d=ei;selObj('eq',ei);return;}
    // Проверяем двери и окна ДО стен (они лежат поверх стен)
    const di=findDoor(wx,wy);
    if(di!==null){selObj('door',di);return;}
    const wni=findWindow(wx,wy);
    if(wni!==null){selObj('window',wni);return;}
    const wi=findWall(wx,wy);
    if(wi!==null){
      selObj('wall',wi);
      savH();
      detachWallFull(wi);
      const w=G.walls[wi];
      const v1=G.verts.find(v=>v.id===w.v1id);
      const v2=G.verts.find(v=>v.id===w.v2id);
      if(v1&&v2){
        VD.mode='wall';VD.wIdx=wi;
        VD.ox1=v1.x-wx;VD.oy1=v1.y-wy;
        VD.wdx=v2.x-v1.x;VD.wdy=v2.y-v1.y;
      }
      return;
    }
    desel();
    return;
  }
  if(G.tool==='wall'||G.tool==='door'||G.tool==='window'){
    if(!G.drawOn){
      // Snap к существующей вершине при старте
      const sv=nearVert(wx,wy);
      const sx=sv?sv.x:wx, sy2=sv?sv.y:wy;
      G.drawOn=true;G._dragging=false;
      G.drawS={x:sx,y:sy2};G.drawC={x:sx,y:sy2};
    }
    else{
      // Snap к существующей вершине при завершении
      const sv2=nearVert(G.drawC.x,G.drawC.y);
      const en=sv2?{x:sv2.x,y:sv2.y}:(G.drawC||{x:wx,y:wy});
      const s=G.drawS;
      if(L(s.x,s.y,en.x,en.y)>4){
        savH();
        if(G.tool==='wall'){
          const v1=getOrCreateVert(s.x,s.y);
          const v2=getOrCreateVert(en.x,en.y);
          const wi=G.walls.length;
          G.walls.push({v1id:v1.id,v2id:v2.id,x1:v1.x,y1:v1.y,x2:v2.x,y2:v2.y,th:Core.defaultWallThicknessUnits(G.sc),h:null,floor:G.floor});
          G.sel={t:'wall',i:wi}; showP('wall',wi);
        } else if(G.tool==='door'){
          const di=G.doors.length;
          G.doors.push({x1:s.x,y1:s.y,x2:en.x,y2:en.y,dh:null,floor:G.floor});
          G.sel={t:'door',i:di}; showP('door',di);
        } else {
          const wni=G.windows.length;
          G.windows.push({x1:s.x,y1:s.y,x2:en.x,y2:en.y,wh:null,sill:null,floor:G.floor});
          G.sel={t:'window',i:wni}; showP('window',wni);
        }
        G.drawS={x:en.x,y:en.y};G.drawC={x:en.x,y:en.y};
      }
      rd();
    }
    return;
  }
  if(G.tool==='measure'){
    if(!G.drawOn){G.drawOn=true;G.drawS={x:wx,y:wy};G.drawC={x:wx,y:wy};}
    else{savH();G.measures.push({x1:G.drawS.x,y1:G.drawS.y,x2:wx,y2:wy});G.drawOn=false;G.drawS=null;G.drawC=null;rd();}
    return;
  }
});
cv.addEventListener('mouseup',e=>{
  if(G.panning){G.panning=false;cv.style.cursor='crosshair';}
  if(G.dragEq2d!==null||VD.mode==='wall') scheduleAutoSave();
  G.dragEq2d=null;
  if(VD.mode==='wall'){VD.mode=null;VD.wIdx=null;cleanVerts();rd();return;}
  // Drag-to-draw: если тянули стену/дверь — завершить при mouseup
  if(G.drawOn&&G._dragging&&(G.tool==='wall'||G.tool==='door'||G.tool==='window')){
    const sv=nearVert(G.drawC.x,G.drawC.y);
    const en=sv||G.drawC;
    const st=G.drawS;
    if(L(st.x,st.y,en.x,en.y)>4){
      savH();
      if(G.tool==='wall'){
        const v1=getOrCreateVert(st.x,st.y);
        const v2=getOrCreateVert(en.x,en.y);
        const wi=G.walls.length;
        G.walls.push({v1id:v1.id,v2id:v2.id,x1:v1.x,y1:v1.y,x2:v2.x,y2:v2.y,th:Core.defaultWallThicknessUnits(G.sc),h:null,floor:G.floor});
        G.sel={t:'wall',i:wi};showP('wall',wi);
      } else if(G.tool==='door'){
        const di=G.doors.length;
        G.doors.push({x1:st.x,y1:st.y,x2:en.x,y2:en.y,dh:null,floor:G.floor});
        G.sel={t:'door',i:di};showP('door',di);
      } else {
        const wni=G.windows.length;
        G.windows.push({x1:st.x,y1:st.y,x2:en.x,y2:en.y,wh:null,sill:null,floor:G.floor});
        G.sel={t:'window',i:wni};showP('window',wni);
      }
    }
    G.drawOn=false;G.drawS=null;G.drawC=null;G._dragging=false;
    rd();return;
  }
  G._dragging=false;
});
cv.addEventListener('dblclick',e=>{
  if(G.tool==='wall'){
    // Двойной клик = маленькая стена-столбик в точке клика
    const rc=cv.getBoundingClientRect(),raw=s2w(e.clientX-rc.left,e.clientY-rc.top);
    const wx=sn(raw.x),wy=sn(raw.y);
    const sz=G.gs||10; // размер = шаг сетки
    savH();
    const v1=getOrCreateVert(wx-sz/2,wy);
    const v2=getOrCreateVert(wx+sz/2,wy);
    const wi=G.walls.length;
    G.walls.push({v1id:v1.id,v2id:v2.id,x1:v1.x,y1:v1.y,x2:v2.x,y2:v2.y,th:Core.defaultWallThicknessUnits(G.sc),h:null,floor:G.floor});
    G.drawOn=false;G.drawS=null;G.drawC=null;
    G.sel={t:'wall',i:wi};showP('wall',wi);rd();
  } else if(G.drawOn&&(G.tool==='door'||G.tool==='window')){
    G.drawOn=false;G.drawS=null;G.drawC=null;rd();
  }
});
cv.addEventListener('wheel',e=>{
  e.preventDefault();
  const rc=cv.getBoundingClientRect(),sx=e.clientX-rc.left,sy=e.clientY-rc.top;
  const f=e.deltaY<0?1.12:1/1.12,wx=(sx-G.pan.x)/G.zoom,wy=(sy-G.pan.y)/G.zoom;
  G.zoom=Math.min(Math.max(G.zoom*f,.04),20);G.pan.x=sx-wx*G.zoom;G.pan.y=sy-wy*G.zoom;rd();
},{passive:false});
cv.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
cv.addEventListener('drop',e=>{
  e.preventDefault();
  const type=e.dataTransfer.getData('text/plain');
  if(!type||type==='wall'||type==='door'||type==='window'||type==='measure'||type==='select')return;
  const rc=cv.getBoundingClientRect(),raw=s2w(e.clientX-rc.left,e.clientY-rc.top);
  savH();addEq(type,sn(raw.x),sn(raw.y));
});
// Назначаем dragstart на все .ei в панели
function bindDragItems(){
  document.querySelectorAll('#lp .ei[data-eq]').forEach(el=>{
    // Убираем старый слушатель
    if(el._ds) el.removeEventListener('dragstart',el._ds);
    el._ds=function(e){
      e.dataTransfer.setData('text/plain', el.dataset.eq);
    };
    el.setAttribute('draggable','true');
    el.addEventListener('dragstart',el._ds);
    // Запрещаем drag на дочерних элементах (SVG/img могут перехватывать)
    el.querySelectorAll('*').forEach(child=>{
      child.setAttribute('draggable','false');
    });
  });
}
bindDragItems();

// ═══════════════════════════════════════════════════════════
// 2D PICK
// ═══════════════════════════════════════════════════════════
const findEq=(wx,wy)=>{for(let i=G.equip.length-1;i>=0;i--){if(!_onFloor(G.equip[i]))continue;if(L(G.equip[i].x,G.equip[i].y,wx,wy)<16)return i;}return null;};
const findWall=(wx,wy)=>{for(let i=G.walls.length-1;i>=0;i--){if(!_onFloor(G.walls[i]))continue;if(dSeg(wx,wy,G.walls[i].x1,G.walls[i].y1,G.walls[i].x2,G.walls[i].y2)<10)return i;}return null;};
const findDoor=(wx,wy)=>{for(let i=G.doors.length-1;i>=0;i--){if(!_onFloor(G.doors[i]))continue;if(dSeg(wx,wy,G.doors[i].x1,G.doors[i].y1,G.doors[i].x2,G.doors[i].y2)<10)return i;}return null;};
const findWindow=(wx,wy)=>{for(let i=G.windows.length-1;i>=0;i--){if(!_onFloor(G.windows[i]))continue;if(dSeg(wx,wy,G.windows[i].x1,G.windows[i].y1,G.windows[i].x2,G.windows[i].y2)<10)return i;}return null;};
function selObj(t,i){G.sel={t,i};showP(t,i);rd();}
function desel(){G.sel=null;closeP();rd();}

// ═══════════════════════════════════════════════════════════
// EQUIP
// ═══════════════════════════════════════════════════════════
function addEq(type,x,y){
  const ceqDef=G.customEq.find(c=>c.type===type);
  const isCamera=type==='camera'||(ceqDef&&ceqDef.behavior==='camera');
  G.equip.push({id:G.nextId++,type,x,y,name:EQ_NAMES[type]||type,model:'',ang:0,fovA:60,fovD:5/G.sc,fovOn:isCamera,h3:null,floor:G.floor});
  rd();
}

// ═══════════════════════════════════════════════════════════
// PROPS
// ═══════════════════════════════════════════════════════════
function showP(t,i){
  const panel=document.getElementById('props'),pt=document.getElementById('pt'),pb=document.getElementById('pb');
  panel.classList.add('on');
  if(t==='eq'){
    const eq=G.equip[i],col=EQ_COL2[eq.type]||'#888';
    pt.innerHTML=`<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5.5" fill="${col}" opacity=".18"/><circle cx="6" cy="6" r="2.8" fill="${col}"/></svg>${escHtml(EQ_NAMES[eq.type]||eq.type)}`;
    const defH3=eq.type==='socket'?0.4:eq.type==='heat'?0.6:1.5;
    const curH3m=eq.h3!=null?(eq.h3*G.sc).toFixed(2):defH3.toFixed(2);
    let h=`<div class="pr"><div class="plb2">Название</div><input class="pi" type="text" value="${escHtml(eq.name)}" oninput="upEq('name',this.value)" onkeydown="event.stopPropagation()"></div>
    <div class="pr"><div class="plb2">Модель</div><input class="pi" type="text" placeholder="Например: DS-2CD2143G2" value="${escHtml(eq.model)}" oninput="upEq('model',this.value);refresh3d()" onkeydown="event.stopPropagation()"></div>
    <div class="pr"><div class="plb2">Высота (м)</div><input class="pi" type="number" step="0.1" min="0.1" max="100" value="${curH3m}" oninput="upEq('h3',+this.value/G.sc);refresh3d()" onkeydown="event.stopPropagation()"></div>
    <div class="pr"><div class="plb2">Поворот °</div><input class="pi" type="number" min="-180" max="180" value="${eq.ang||0}" oninput="upEq('ang',+this.value);refresh3d()" onkeydown="event.stopPropagation()"></div>`;
    const _isCamP=eq.type==='camera'||(G.customEq.find(c=>c.type===eq.type)?.behavior==='camera');
    if(eq.type==='pillar'){h+=`
    <div class="pr"><div class="plb2">Ширина (м)</div><input class="pi" type="number" step="0.05" min="0.1" max="3" value="${(eq.pillarW||0.3).toFixed(2)}" oninput="upEq('pillarW',+this.value);refresh3d()" onkeydown="event.stopPropagation()"></div>
    <div class="pr"><div class="plb2">Глубина (м)</div><input class="pi" type="number" step="0.05" min="0.1" max="3" value="${(eq.pillarD||0.3).toFixed(2)}" oninput="upEq('pillarD',+this.value);refresh3d()" onkeydown="event.stopPropagation()"></div>
    <div class="pr"><div class="plb2">Высота (м)</div><input class="pi" type="number" step="0.1" min="0.5" max="20" value="${(eq.pillarH||(2.5)).toFixed(1)}" oninput="upEq('pillarH',+this.value);refresh3d()" onkeydown="event.stopPropagation()"></div>`;}
    if(eq.type==='tree'){h+=`
    <div class="pr"><div class="plb2">Высота ствола (м)</div><input class="pi" type="number" step="0.5" min="0.5" max="20" value="${(eq.trunkH||2.5).toFixed(1)}" oninput="upEq('trunkH',+this.value);refresh3d()" onkeydown="event.stopPropagation()"></div>
    <div class="pr"><div class="plb2">Радиус кроны (м)</div><input class="pi" type="number" step="0.25" min="0.25" max="10" value="${(eq.treeR||1.5).toFixed(2)}" oninput="upEq('treeR',+this.value);rd();refresh3d()" onkeydown="event.stopPropagation()"></div>
    <div class="pr"><div class="plb2">Радиус ствола (м)</div><input class="pi" type="number" step="0.02" min="0.05" max="1" value="${(eq.trunkR||0.1).toFixed(2)}" oninput="upEq('trunkR',+this.value);refresh3d()" onkeydown="event.stopPropagation()"></div>`;}
    if(_isCamP){h+=`
    <div class="pr"><div class="plb2">Угол обзора</div><input class="pi" type="range" min="10" max="180" value="${eq.fovA||60}" oninput="upEq('fovA',+this.value);document.getElementById('pfv').textContent=this.value+'°';refresh3d()"><div class="pv" id="pfv">${eq.fovA||60}°</div></div>
    <div class="pr"><div class="plb2">Дальность (м)</div><input class="pi" type="number" step="0.5" value="${(eq.fovD*G.sc).toFixed(1)}" oninput="upEq('fovD',+this.value/G.sc);refresh3d()"></div>
    <div class="pr"><label class="pck"><input type="checkbox" ${eq.fovOn!==false?'checked':''} onchange="upEq('fovOn',this.checked);refresh3d()"> Конус обзора</label></div>`;}
    pb.innerHTML=h;
  }
  if(t==='wall'){
    const w=G.walls[i];
    pt.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="4" width="10" height="4" rx="1" fill="#4a7ab8"/></svg> Стена';
    const wLen=px2m(L(w.x1,w.y1,w.x2,w.y2));
    const wH=(w.h!=null?(w.h*G.sc).toFixed(2):'2.50');
    const wTh=(wallThicknessUnits(w)*G.sc).toFixed(2);
    pb.innerHTML=`
    <div class="pr"><div class="plb2">Длина (м)</div><input class="pi" type="number" step="0.05" min="0.05" value="${wLen}" onchange="setWLen(+this.value)"></div>
    <div class="pr"><div class="plb2">Высота (м)</div><input class="pi" type="number" step="0.05" min="0.1" max="10" value="${wH}" oninput="G.walls[${i}].h=+this.value/G.sc;refresh3d()"></div>
    <div class="pr"><div class="plb2">Толщина (м)</div><input class="pi" type="number" step="0.01" min="0.05" max="1" value="${wTh}" oninput="G.walls[${i}].th=+this.value/G.sc;rd();refresh3d()"></div>`;
  }
  if(t==='door'){
    const d=G.doors[i];
    pt.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="1" width="8" height="10" rx="1" stroke="#f0a832" fill="none" stroke-width="1"/></svg> Дверной проём';
    const dW=px2m(L(d.x1,d.y1,d.x2,d.y2));
    const dH=(d.dh!=null?(d.dh*G.sc).toFixed(2):'2.00');
    pb.innerHTML=`
    <div class="pr"><div class="plb2">Ширина (м)</div><input class="pi" type="number" step="0.05" min="0.3" value="${dW}" onchange="setDLen(+this.value)"></div>
    <div class="pr"><div class="plb2">Высота (м)</div><input class="pi" type="number" step="0.05" min="0.5" max="5" value="${dH}" oninput="G.doors[${i}].dh=+this.value/G.sc;refresh3d()"></div>`;
  }
  if(t==='window'){
    const w=G.windows[i];
    pt.innerHTML='<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="2" width="10" height="8" rx="1" stroke="#40a8d8" fill="none" stroke-width="1"/><line x1="6" y1="2" x2="6" y2="10" stroke="#40a8d8" stroke-width=".8"/></svg> Оконный проём';
    const wW=px2m(L(w.x1,w.y1,w.x2,w.y2));
    const wH=(w.wh!=null?(w.wh*G.sc).toFixed(2):'1.40');
    const wS=(w.sill!=null?(w.sill*G.sc).toFixed(2):'0.90');
    pb.innerHTML=`
    <div class="pr"><div class="plb2">Ширина (м)</div><input class="pi" type="number" step="0.05" min="0.3" value="${wW}" onchange="setWinLen(+this.value)"></div>
    <div class="pr"><div class="plb2">Высота (м)</div><input class="pi" type="number" step="0.05" min="0.2" max="5" value="${wH}" oninput="G.windows[${i}].wh=+this.value/G.sc;refresh3d()"></div>
    <div class="pr"><div class="plb2">Подоконник (м)</div><input class="pi" type="number" step="0.05" min="0" max="3" value="${wS}" oninput="G.windows[${i}].sill=+this.value/G.sc;refresh3d()"></div>`;
  }
  if(t==='cable'){
    const cab=G.cables[i];
    pt.innerHTML=`<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="${CABLE_COL[cab.type]}" opacity=".3"/><circle cx="6" cy="6" r="2.5" fill="${CABLE_COL[cab.type]}"/></svg> ${CABLE_LAB[cab.type]} кабель`;
    pb.innerHTML=`<div class="pr"><div class="plb2">Название</div><input class="pi" value="${escHtml(cab.name||'')}" oninput="G.cables[${i}].name=this.value"></div>
    <div class="pr"><div class="plb2">Длина</div><div style="font-size:13px;color:var(--gr);font-weight:600">${(cabLen(cab.pts)*G.sc).toFixed(2)} м</div></div>`;
  }
}
function upEq(k,v){if(G.sel&&G.sel.t==='eq')G.equip[G.sel.i][k]=v;}
function setWLen(m){
  if(!G.sel||G.sel.t!=='wall')return;
  const idx=G.sel.i;
  const w=G.walls[idx];
  const resized=Core.resizeSegmentFromStart(w,m/G.sc);
  const nx2=resized.x2;
  const ny2=resized.y2;
  w.x2=nx2; w.y2=ny2;
  // Обновляем/отвязываем вершину v2 — чтобы длина не откатывалась при перемещении
  detachWallVert(idx,'v2id',nx2,ny2);
  rd();
}
function setDLen(m){if(!G.sel||G.sel.t!=='door')return;const d=G.doors[G.sel.i],resized=Core.resizeSegmentFromStart(d,m/G.sc);d.x2=resized.x2;d.y2=resized.y2;rd();}
function setWinLen(m){if(!G.sel||G.sel.t!=='window')return;const w=G.windows[G.sel.i],resized=Core.resizeSegmentFromStart(w,m/G.sc);w.x2=resized.x2;w.y2=resized.y2;rd();}
function refresh3d(){if(G.mode==='3d')buildScene3();else rd();}
function closeP(){G.sel=null;document.getElementById('props').classList.remove('on');rd();}
function delSel(){
  if(!G.sel)return;savH();
  if(G.sel.t==='wall')G.walls.splice(G.sel.i,1);
  if(G.sel.t==='door')G.doors.splice(G.sel.i,1);
  if(G.sel.t==='window')G.windows.splice(G.sel.i,1);
  if(G.sel.t==='eq')G.equip.splice(G.sel.i,1);
  if(G.sel.t==='cable'){G.cables.splice(G.sel.i,1);updateCableUI();}
  G.sel=null;closeP();refresh3d();
}

