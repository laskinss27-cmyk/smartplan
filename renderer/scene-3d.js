'use strict';
// ═══════════════════════════════════════════════════════════
// THREE.JS 3D
// ═══════════════════════════════════════════════════════════
function initThree(){
  const wrap=document.getElementById('c3');
  const cwEl=document.getElementById('cw');
  const W=cwEl.clientWidth||window.innerWidth-192;
  const H=cwEl.clientHeight||window.innerHeight-44;
  if(!G.R){
    const r=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
    r.setSize(W,H);r.setPixelRatio(Math.min(window.devicePixelRatio,2));
    r.setClearColor(getVar('--cv-bg',G._lightTheme?'#f0f2f5':'#07090e'));r.shadowMap.enabled=true;r.shadowMap.type=THREE.PCFSoftShadowMap;r.localClippingEnabled=true;
    wrap.appendChild(r.domElement);G.R=r;
    G.CAM=new THREE.PerspectiveCamera(Core.scenePresetConfig(G.scenePreset,G.sc).fov,W/H,.5,20000);
    G.SC=new THREE.Scene();
    setup3dEv(r.domElement);
  } else {rsz3();}
  if(!G._animStarted){G._animStarted=true;anim3();}
  updCam();buildScene3();
}
function rsz3(){
  if(!G.R)return;
  const w=document.getElementById('cw');
  const W=w.clientWidth||window.innerWidth-192,H=w.clientHeight||window.innerHeight-44;
  G.R.setSize(W,H);G.CAM.aspect=W/H;G.CAM.updateProjectionMatrix();
}

// ── BUILD SCENE ──
function buildScene3(){
  migrateWalls(); // убедимся что все стены имеют вершины
  if(!G.SC)return;
  const sc=G.SC;
  while(sc.children.length)sc.remove(sc.children[0]);
  const WH=wh3d();
  const preset=Core.scenePresetConfig(G.scenePreset,G.sc);
  const technicalBg=_hex2int(getVar('--cv-bg'),G._lightTheme?0xf0f2f5:0x07090e);
  const background=preset.background==null?technicalBg:preset.background;
  G.R.setClearColor(background);
  sc.background=new THREE.Color(background);
  sc.fog=preset.fogDensity>0?new THREE.FogExp2(background,preset.fogDensity):null;
  G.R.toneMapping=preset.id==='architectural'&&THREE.ACESFilmicToneMapping!=null
    ?THREE.ACESFilmicToneMapping
    :THREE.NoToneMapping;
  G.R.toneMappingExposure=preset.id==='architectural'?1.12:1;
  if(G.CAM.fov!==preset.fov){G.CAM.fov=preset.fov;G.CAM.updateProjectionMatrix();}

  sc.add(new THREE.AmbientLight(preset.id==='architectural'?0x404060:0x3a4560,preset.id==='architectural'?.9:1.1));
  const sun=new THREE.DirectionalLight(preset.id==='architectural'?0xffffff:0x8899cc,preset.id==='architectural'?1.15:1.3);
  sun.position.set(500,900,400);sun.castShadow=true;
  sun.shadow.mapSize.width=2048;sun.shadow.mapSize.height=2048;sun.shadow.camera.far=4000;sc.add(sun);
  const fl2=new THREE.PointLight(preset.id==='architectural'?0x4466cc:0x4c8ef7,preset.id==='architectural'?.46:.3,3000);
  fl2.position.set(-400,500,300);sc.add(fl2);
  if(preset.id==='architectural'){
    const warm=new THREE.PointLight(0xffaa66,.58,2600);
    warm.position.set(450,280,-320);sc.add(warm);
  }

  // Floor
  const flCol=preset.floorColor==null?_hex2int(getVar('--cv-floor'), G._lightTheme?0xe8eaee:0x0b0d16):preset.floorColor;
  const flMat=preset.standardMaterials
    ?new THREE.MeshStandardMaterial({color:flCol,roughness:.88,metalness:.03})
    :new THREE.MeshLambertMaterial({color:flCol});
  const fl=new THREE.Mesh(new THREE.PlaneGeometry(6000,6000),flMat);
  fl.rotation.x=-Math.PI/2;fl.receiveShadow=true;fl.name='floor';sc.add(fl);
  // Grid matches 2D: 1m = 1/G.sc units, show grid at 1m intervals
  const gridC1=preset.gridCenterColor==null?(G._lightTheme?0xc8ccd8:0x161828):preset.gridCenterColor;
  const gridC2=preset.gridColor==null?(G._lightTheme?0xd8dce8:0x0f1120):preset.gridColor;
  const g3size=Math.round(10/G.sc)*200; // cover ~200m
  const g3div=Math.round(g3size*G.sc);  // one division per meter
  const gHelper=new THREE.GridHelper(g3size,g3div,gridC1,gridC2);
  if(preset.id==='architectural'){
    const materials=Array.isArray(gHelper.material)?gHelper.material:[gHelper.material];
    materials.forEach(mat=>{mat.transparent=true;mat.opacity=.34;});
    gHelper.position.y=Core.metersToUnits(.003,G.sc);
  }
  sc.add(gHelper);

  // Floor 2 slab (перекрытие между этажами) — на высоте стен 1 этажа
  const hasFloor2=G.walls.some(w=>(w.floor||1)===2)||G.equip.some(e=>(e.floor||1)===2);
  const f1WallsForSlab=G.walls.filter(w=>(w.floor||1)===1);
  const f1MaxH=f1WallsForSlab.length?Math.max(...f1WallsForSlab.map(w=>w.h!=null?w.h:WH)):WH;

  // Bounding box по стенам этажа (с небольшим отступом наружу на полтолщины стен)
  function _wallsBbox(walls){
    if(!walls.length)return null;
    let minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity,maxTh=Core.defaultWallThicknessUnits(G.sc);
    walls.forEach(w=>{
      minX=Math.min(minX,w.x1,w.x2);maxX=Math.max(maxX,w.x1,w.x2);
      minZ=Math.min(minZ,w.y1,w.y2);maxZ=Math.max(maxZ,w.y1,w.y2);
      if(w.th)maxTh=Math.max(maxTh,w.th);
    });
    const pad=maxTh/2;
    return {minX:minX-pad,maxX:maxX+pad,minZ:minZ-pad,maxZ:maxZ+pad};
  }
  function _bboxUnion(a,b){
    if(!a)return b; if(!b)return a;
    return {minX:Math.min(a.minX,b.minX),maxX:Math.max(a.maxX,b.maxX),minZ:Math.min(a.minZ,b.minZ),maxZ:Math.max(a.maxZ,b.maxZ)};
  }
  function _makeSlabMesh(bbox,y,color,name){
    const w=Math.max(1,bbox.maxX-bbox.minX),d=Math.max(1,bbox.maxZ-bbox.minZ);
    const material=preset.standardMaterials
      ?new THREE.MeshStandardMaterial({color,side:THREE.DoubleSide,roughness:.72,metalness:.03})
      :new THREE.MeshLambertMaterial({color,side:THREE.DoubleSide});
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(w,d),material);
    mesh.rotation.x=-Math.PI/2;
    mesh.position.set((bbox.minX+bbox.maxX)/2,y,(bbox.minZ+bbox.maxZ)/2);
    mesh.name=name;mesh.receiveShadow=true;
    return mesh;
  }

  const f1Bbox=_wallsBbox(f1WallsForSlab);
  const f2Bbox=_wallsBbox(G.walls.filter(w=>(w.floor||1)===2));
  const slabCol=preset.wallColor==null?_hex2int(getVar('--cv-wall'), G._lightTheme?0x2a5a90:0x1e2a42):preset.wallColor;

  if(hasFloor2){
    // Перекрытие покрывает объединение проекций 1 и 2 этажей
    const slabBbox=_bboxUnion(f1Bbox,f2Bbox);
    if(slabBbox)sc.add(_makeSlabMesh(slabBbox,f1MaxH,slabCol,'slab'));
  }

  // Верхние потолки
  if(!hasFloor2&&G.showCeiling&&f1Bbox){
    sc.add(_makeSlabMesh(f1Bbox,f1MaxH,slabCol,'ceil_1'));
  }
  if(hasFloor2&&G.showCeiling&&f2Bbox){
    const f2wallsC=G.walls.filter(w=>(w.floor||1)===2);
    const f2HC=f2wallsC.length?Math.max(...f2wallsC.map(w=>w.h!=null?w.h:WH)):WH;
    sc.add(_makeSlabMesh(f2Bbox,f1MaxH+f2HC,slabCol,'ceil_2'));
  }

  // Walls with door/window cutouts (both floors)
  G.walls.forEach((w,wIdx)=>{
    const wlen=L(w.x1,w.y1,w.x2,w.y2);if(wlen<1)return;
    const ang=Math.atan2(w.y2-w.y1,w.x2-w.x1);
    const WH=w.h!=null?w.h:wh3d();
    const th=wallThicknessUnits(w);
    const wFloor=(w.floor||1);
    const yOff=(wFloor-1)*f1MaxH; // 2nd floor starts at top of 1st floor walls
    const wDir={x:Math.cos(ang),z:Math.sin(ang)};

    // Collect doors and windows that belong to this wall (same floor, nearest wall only)
    const proxFilter=(arr,wIdx)=>arr.filter(d=>{
      if((d.floor||1)!==wFloor)return false;
      const da=Math.atan2(d.y2-d.y1,d.x2-d.x1);
      const diff=Math.abs(((da-ang+Math.PI*3)%(Math.PI*2))-Math.PI);
      if(diff>0.35&&Math.abs(diff-Math.PI)>0.35)return false;
      const dc=(d.x1+d.x2)/2,dcz=(d.y1+d.y2)/2;
      const dist=dSeg(dc,dcz,w.x1,w.y1,w.x2,w.y2);
      if(dist>=wallThicknessUnits(w)*4+20)return false;
      // Check this is the nearest wall for this opening
      let nearest=true;
      G.walls.forEach((ow,oi)=>{
        if(oi===wIdx||(ow.floor||1)!==wFloor)return;
        const oa=Math.atan2(ow.y2-ow.y1,ow.x2-ow.x1);
        const od=Math.abs(((da-oa+Math.PI*3)%(Math.PI*2))-Math.PI);
        if(od>0.35&&Math.abs(od-Math.PI)>0.35)return;
        if(dSeg(dc,dcz,ow.x1,ow.y1,ow.x2,ow.y2)<dist)nearest=false;
      });
      return nearest;
    });
    const wallDoors=proxFilter(G.doors,wIdx);
    const wallWindows=proxFilter(G.windows,wIdx);

    if(!wallDoors.length&&!wallWindows.length){
      addWMesh(sc,wlen,WH,th,ang,(w.x1+w.x2)/2,yOff+WH/2,(w.y1+w.y2)/2,wIdx);
    } else {
      const openings=[];
      wallDoors.forEach(d=>{
        const dx=d.x1-w.x1,dz=d.y1-w.y1;
        const t=dx*wDir.x+dz*wDir.z;
        openings.push({t,len:L(d.x1,d.y1,d.x2,d.y2),type:'door',dh:d.dh!=null?d.dh:dh3d()});
      });
      wallWindows.forEach(wi=>{
        const dx=wi.x1-w.x1,dz=wi.y1-w.y1;
        const t=dx*wDir.x+dz*wDir.z;
        const sill=wi.sill!=null?wi.sill:0.9/G.sc;
        const wiH=wi.wh!=null?wi.wh:1.4/G.sc;
        openings.push({t,len:L(wi.x1,wi.y1,wi.x2,wi.y2),type:'window',sill,wiH});
      });
      openings.sort((a,b)=>a.t-b.t);
      let prev=0;
      openings.forEach(op=>{
        if(op.t-prev>2){const sl=op.t-prev;addWMesh(sc,sl,WH,th,ang,w.x1+wDir.x*(prev+sl/2),yOff+WH/2,w.y1+wDir.z*(prev+sl/2),wIdx);}
        if(op.type==='door'){
          if(WH-op.dh>2){const sl=Math.max(op.len,1);addWMesh(sc,sl,WH-op.dh,th,ang,w.x1+wDir.x*(op.t+sl/2),yOff+op.dh+(WH-op.dh)/2,w.y1+wDir.z*(op.t+sl/2),wIdx);}
        }else{
          const sl=Math.max(op.len,1);
          if(op.sill>2)addWMesh(sc,sl,op.sill,th,ang,w.x1+wDir.x*(op.t+sl/2),yOff+op.sill/2,w.y1+wDir.z*(op.t+sl/2),wIdx);
          const winTop=op.sill+op.wiH;
          if(WH-winTop>2)addWMesh(sc,sl,WH-winTop,th,ang,w.x1+wDir.x*(op.t+sl/2),yOff+winTop+(WH-winTop)/2,w.y1+wDir.z*(op.t+sl/2),wIdx);
        }
        prev=op.t+op.len;
      });
      if(wlen-prev>2){const sl=wlen-prev;addWMesh(sc,sl,WH,th,ang,w.x1+wDir.x*(prev+sl/2),yOff+WH/2,w.y1+wDir.z*(prev+sl/2),wIdx);}
    }
  });

  // Equipment
  G.equip.forEach(eq=>placeEq3(sc,eq));

  // Resize handles + model label for selected equipment
  if(G.selEqId3>=0){
    const _se=G.equip.find(e=>e.id===G.selEqId3);
    if(_se){
      const _sm=sc.children.find(c=>c.name==='eq_'+G.selEqId3);
      if(_sm){
        _sm.updateWorldMatrix(true,false);
        const _sW=_se.eqW||eqSz(), _sH=_se.eqH||(eqSz()*0.7);
        const hndR=Math.max(0.8, eqSz()*0.18);
        [['TL',-1,1],['TR',1,1],['BL',-1,-1],['BR',1,-1]].forEach(([nm,sx,sy])=>{
          const cp=new THREE.Vector3(sx*_sW/2, sy*_sH/2, 0).applyMatrix4(_sm.matrixWorld);
          const hm=new THREE.Mesh(
            new THREE.SphereGeometry(hndR,8,8),
            new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false})
          );
          hm.name='eq_hnd_'+nm; hm.position.copy(cp); sc.add(hm);
        });
        if(_se.model){
          const _lc=document.createElement('canvas'); _lc.width=320; _lc.height=52;
          const _lx=_lc.getContext('2d');
          _lx.fillStyle='rgba(10,18,36,0.9)'; _lx.fillRect(0,0,320,52);
          _lx.strokeStyle='rgba(76,142,247,0.8)'; _lx.lineWidth=2; _lx.strokeRect(1,1,318,50);
          _lx.font='bold 22px Arial'; _lx.fillStyle='#c8d8f0';
          _lx.textAlign='center'; _lx.textBaseline='middle'; _lx.fillText(_se.model,160,26);
          const _lsp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(_lc),transparent:true,depthTest:false}));
          _lsp.name='eq_label'; _lsp.scale.set(_sW*2.5,_sH*0.9,1);
          const _tp=new THREE.Vector3(0,_sH/2+8,0).applyMatrix4(_sm.matrixWorld);
          _lsp.position.copy(_tp); sc.add(_lsp);
        }
      }
    }
  }

  // Cables
  // Комментарии
  G.comments.forEach(c=>{
    // Точка-маркер (маленькая сфера)
    const sg=new THREE.SphereGeometry(0.9,12,12);
    const sm=new THREE.MeshBasicMaterial({color:0x26d4e8});
    const sp=new THREE.Mesh(sg,sm); sp.position.set(c.x,c.y,c.z);
    sp.name='comment_'+c.id; sc.add(sp);
    // Облачко с текстом — canvas-спрайт без ножки
    const pixRatio=Math.min(window.devicePixelRatio||1,2);
    const tcW=440, tcH=88, tailH=18;
    const totalH=tcH+tailH;
    const tc=document.createElement('canvas');
    tc.width=tcW*pixRatio; tc.height=totalH*pixRatio;
    const tx=tc.getContext('2d');
    tx.scale(pixRatio,pixRatio);
    // Тело облачка — закруглённый прямоугольник
    tx.fillStyle='rgba(6,10,22,0.94)';
    _rrect(tx,2,2,tcW-4,tcH-4,13); tx.fill();
    tx.strokeStyle='rgba(38,212,232,0.7)'; tx.lineWidth=2.5;
    _rrect(tx,2,2,tcW-4,tcH-4,13); tx.stroke();
    // Хвостик-треугольник внизу по центру
    const tip=tcW/2;
    tx.fillStyle='rgba(6,10,22,0.94)';
    tx.beginPath(); tx.moveTo(tip-12,tcH-5); tx.lineTo(tip+12,tcH-5); tx.lineTo(tip,tcH+tailH-2); tx.closePath(); tx.fill();
    tx.strokeStyle='rgba(38,212,232,0.7)'; tx.lineWidth=2.5;
    tx.beginPath(); tx.moveTo(tip-12,tcH-4); tx.lineTo(tip,tcH+tailH-2); tx.lineTo(tip+12,tcH-4); tx.stroke();
    // Текст
    tx.font='bold 26px Arial';
    tx.fillStyle='#d8f8ff';
    tx.textBaseline='middle';
    tx.fillText(c.text.slice(0,42), 14, tcH/2);
    const tex=new THREE.CanvasTexture(tc);
    tex.needsUpdate=true;
    const sm2=new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false,sizeAttenuation:false});
    const sprite=new THREE.Sprite(sm2);
    const sy=0.06, sx=sy*(tcW/totalH);
    sprite.scale.set(sx,sy,1);
    sprite.position.set(c.x, c.y+5, c.z);
    sc.add(sprite);
  });
    G.cables.forEach(cab=>{if(cab.pts.length>=2)drawCable3(sc,cab.pts,CABLE_COL[cab.type]||'#888',false);});
  if(G.cableType&&G.cablePts.length>=1)drawCable3(sc,G.cablePts,'#ffffff',true);
}

function addWMesh(sc,wlen,wh,th,ang,mx,my,mz,wallIndex){
  const geo=new THREE.BoxGeometry(wlen,wh,th);
  const preset=Core.scenePresetConfig(G.scenePreset,G.sc);
  const wallCol=preset.wallColor==null?_hex2int(getVar('--cv-wall'), G._lightTheme?0x2a5a90:0x1e2a42):preset.wallColor;
  const mat=preset.standardMaterials
    ?new THREE.MeshStandardMaterial({color:wallCol,roughness:.62,metalness:.03})
    :new THREE.MeshLambertMaterial({color:wallCol});
  const mesh=new THREE.Mesh(geo,mat);
  mesh.position.set(mx,my,mz);mesh.rotation.y=-ang;mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='wall';
  mesh.userData.wallIndex=wallIndex;sc.add(mesh);
  const el=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:preset.edgeColor,transparent:true,opacity:preset.id==='architectural'?.38:.6}));
  el.position.copy(mesh.position);el.rotation.copy(mesh.rotation);sc.add(el);
}

function makeCameraMesh(ES,EO){
  // 3D модель камеры из примитивов — корпус + объектив + крепление
  const group=new THREE.Group();
  const dark=new THREE.MeshLambertMaterial({color:0x1a1a22});
  const blue=new THREE.MeshLambertMaterial({color:0x2a5a90});
  const lens=new THREE.MeshLambertMaterial({color:0x0a0a12});
  const lensGlass=new THREE.MeshBasicMaterial({color:0x203860,transparent:true,opacity:.85});

  // Корпус — прямоугольный, вытянутый вперёд
  const bodyW=ES*0.85, bodyH=ES*0.55, bodyD=ES*0.9;
  const body=new THREE.Mesh(new THREE.BoxGeometry(bodyW,bodyH,bodyD),dark);
  body.position.set(0,0,0);
  group.add(body);
  group.add(new THREE.LineSegments(new THREE.EdgesGeometry(body.geometry),
    new THREE.LineBasicMaterial({color:0x4c8ef7,transparent:true,opacity:.5})));

  // Объектив — цилиндр спереди
  const lensR=bodyH*0.32, lensL=EO*0.8;
  const lensCyl=new THREE.Mesh(new THREE.CylinderGeometry(lensR,lensR*1.1,lensL,12),lens);
  lensCyl.rotation.x=Math.PI/2;
  lensCyl.position.set(0,0,-bodyD/2-lensL/2);
  group.add(lensCyl);

  // Стекло объектива
  const lensGeo=new THREE.CircleGeometry(lensR*0.85,12);
  const glassMesh=new THREE.Mesh(lensGeo,lensGlass);
  glassMesh.position.set(0,0,-bodyD/2-lensL-0.5);
  glassMesh.rotation.x=Math.PI/2; // нет, нужно смотреть вперёд
  glassMesh.rotation.set(0,0,0);
  glassMesh.position.set(0,0,-bodyD/2-lensL);
  group.add(glassMesh);

  // Крепление-кронштейн сзади
  const mount=new THREE.Mesh(
    new THREE.BoxGeometry(bodyW*0.4, bodyH*0.3, EO*0.4),
    blue
  );
  mount.position.set(0, -bodyH*0.4, bodyD/2+EO*0.2);
  group.add(mount);

  // Маленький индикатор (лампочка-пятно)
  const led=new THREE.Mesh(
    new THREE.SphereGeometry(bodyH*0.08,6,6),
    new THREE.MeshBasicMaterial({color:0xff2020})
  );
  led.position.set(bodyW*0.35, bodyH*0.35, -bodyD/2+0.5);
  group.add(led);

  return group;
}

// ═══════════════════════════════════════════════════════════
// SVG ИКОНКИ В 3D (текстуры на плоскостях вместо кубов)
// ═══════════════════════════════════════════════════════════
const SVG_PATHS3={
  doorbell:'assets/svg/intercom.svg',
  monitor:'assets/svg/tablet.svg',
  socket:'assets/svg/socket.svg',
  panel:'assets/svg/electrical-panel-danger.svg',
  light:'assets/svg/bulb.svg',
  heat:'assets/svg/heating.svg',
  nvr:'assets/svg/wifi-modem.svg',
  ac:'assets/svg/air-conditioner.svg'
};
const _svgEl3d={}; // кэш загруженных Image для 3D

function preloadSvg3d(){
  Object.entries(SVG_PATHS3).forEach(([type,src])=>{
    if(type in _svgEl3d)return;
    _svgEl3d[type]=null;
    const img=new Image();
    img.onload=()=>{_svgEl3d[type]=img;if(G.mode==='3d')buildScene3();};
    img.onerror=()=>{_svgEl3d[type]=false;};
    img.src=src;
  });
}

function _rrect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arc(x+w-r,y+r,r,-Math.PI/2,0);
  ctx.lineTo(x+w,y+h-r);ctx.arc(x+w-r,y+h-r,r,0,Math.PI/2);
  ctx.lineTo(x+r,y+h);ctx.arc(x+r,y+h-r,r,Math.PI/2,Math.PI);
  ctx.lineTo(x,y+r);ctx.arc(x+r,y+r,r,Math.PI,-Math.PI/2);
  ctx.closePath();
}

function makeEqCanvasTex(type){
  const S=128;
  const col3=EQ_COL3[type]||0x4c8ef7;
  const cr=(col3>>16)&0xff,cg=(col3>>8)&0xff,cb=col3&0xff;
  const canvas=document.createElement('canvas');
  canvas.width=S;canvas.height=S;
  const ctx=canvas.getContext('2d');
  // Тёмный фон
  ctx.fillStyle=`rgba(${cr*0.07|0},${cg*0.07|0},${cb*0.07|0},0.93)`;
  _rrect(ctx,1,1,S-2,S-2,S*0.14);ctx.fill();
  // Рамка цветом оборудования
  ctx.strokeStyle=`rgba(${cr},${cg},${cb},0.75)`;ctx.lineWidth=4;
  _rrect(ctx,3,3,S-6,S-6,S*0.12);ctx.stroke();
  // Ищем SVG картинку
  let imgEl=null;
  if(type in _svgEl3d){imgEl=_svgEl3d[type];}
  else{imgEl=_svgImgCache[type]||null;} // кастомное оборудование из 2D-кэша
  if(imgEl&&imgEl!==false){
    // Рисуем SVG как силуэт цвета оборудования
    const pad=S*0.13,sz=S-pad*2;
    const offC=document.createElement('canvas');offC.width=S;offC.height=S;
    const offCtx=offC.getContext('2d');
    offCtx.drawImage(imgEl,pad,pad,sz,sz);
    offCtx.globalCompositeOperation='source-atop';
    offCtx.fillStyle=`rgba(${cr},${cg},${cb},0.95)`;
    offCtx.fillRect(0,0,S,S);
    ctx.drawImage(offC,0,0);
  }else{
    // Fallback: буква(ы) типа
    const abbr=(EQ_NAMES[type]||type).slice(0,2).toUpperCase();
    ctx.fillStyle=`rgb(${cr},${cg},${cb})`;
    ctx.font=`bold ${S*0.33|0}px Arial`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(abbr,S/2,S/2);
  }
  return new THREE.CanvasTexture(canvas);
}

function placeEq3(sc,eq){
  const color=EQ_COL3[eq.type]||(eq.type.startsWith('custom_')?getCustomColor(eq.type):0x888888);
  let mount=EQ_MOUNT[eq.type]||'wall';
  const WH=wh3d(),ES=eqSz(),EO=eqOff();
  const GW=eq.eqW||ES, GH=eq.eqH||(ES*0.7), GD=EO;
  const ra=(eq.ang||0)*Math.PI/180;
  // Floor offset: 2nd floor starts at max height of 1st floor walls
  const _f1w=G.walls.filter(w=>(w.floor||1)===1);
  const _f1H=_f1w.length?Math.max(..._f1w.map(w=>w.h!=null?w.h:WH)):WH;
  const eqYOff=((eq.floor||1)-1)*_f1H;

  // Floor-mounted structures: pillar, tree
  if(eq.type==='pillar'){
    const pw=(eq.pillarW||0.3)/G.sc, pd=(eq.pillarD||0.3)/G.sc;
    const ph=eq.pillarH!=null?(eq.pillarH/G.sc):WH;
    const geo=new THREE.BoxGeometry(pw,ph,pd);
    const mat=new THREE.MeshLambertMaterial({color:0x8a7560});
    const mesh=new THREE.Mesh(geo,mat);
    mesh.position.set(eq.x,eqYOff+ph/2,eq.y);mesh.rotation.y=ra;
    mesh.castShadow=true;mesh.receiveShadow=true;mesh.name='eq_'+eq.id;sc.add(mesh);
    const el=new THREE.LineSegments(new THREE.EdgesGeometry(geo),new THREE.LineBasicMaterial({color:0xa08870,transparent:true,opacity:.5}));
    el.position.copy(mesh.position);el.rotation.copy(mesh.rotation);sc.add(el);
    return;
  }
  if(eq.type==='tree'){
    const trunkR=(eq.trunkR||0.1)/G.sc, trunkH=(eq.trunkH||2.5)/G.sc;
    const crownR=(eq.treeR||1.5)/G.sc;
    const grp=new THREE.Group();grp.name='eq_'+eq.id;
    const tGeo=new THREE.CylinderGeometry(trunkR,trunkR*1.2,trunkH,8);
    const tMat=new THREE.MeshLambertMaterial({color:0x6b4e2a});
    const trunk=new THREE.Mesh(tGeo,tMat);trunk.position.y=trunkH/2;trunk.castShadow=true;grp.add(trunk);
    const cGeo=new THREE.SphereGeometry(crownR,12,10);
    const cMat=new THREE.MeshLambertMaterial({color:0x3a7a2a,transparent:true,opacity:0.75});
    const crown=new THREE.Mesh(cGeo,cMat);crown.position.y=trunkH+crownR*0.6;crown.castShadow=true;grp.add(crown);
    grp.position.set(eq.x,eqYOff,eq.y);sc.add(grp);
    const hb=new THREE.Mesh(new THREE.CylinderGeometry(crownR,trunkR,trunkH+crownR*2,8),new THREE.MeshBasicMaterial({visible:false}));
    hb.position.set(eq.x,eqYOff+(trunkH+crownR)/2,eq.y);hb.name='eq_'+eq.id;sc.add(hb);
    return;
  }

  // Для камеры — 3D модель, для остальных — плоский бокс
  const _isCam3=eq.type==='camera'||(G.customEq.find(c=>c.type===eq.type)?.behavior==='camera');
  let mesh;
  if(_isCam3){
    mesh=makeCameraMesh(ES,EO);
  } else {
    const tex=makeEqCanvasTex(eq.type);
    const mat=new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide});
    mesh=new THREE.Mesh(new THREE.PlaneGeometry(GW,GH),mat);
  }
  mesh.name='eq_'+eq.id;

  // Ceiling mount — цепляется к потолку ближайшей стены своего этажа
  if(mount==='ceiling' || (mount==='any' && eq.h3==null)){
    // Находим высоту потолка: высота ближайшей стены или дефолт
    let mountCeilH=WH;
    let bestWD=999999;
    G.walls.filter(w=>(w.floor||1)===(eq.floor||1)).forEach(w=>{
      const d=dSeg(eq.x,eq.y,w.x1,w.y1,w.x2,w.y2);
      if(d<bestWD){bestWD=d;mountCeilH=w.h!=null?w.h:WH;}
    });
    const ceilGap=GD*2+ES*0.3; // заметный отступ от потолка вниз
    mesh.position.set(eq.x, eqYOff + mountCeilH - ceilGap, eq.y);
    mesh.rotation.x=-Math.PI/2; // лицом вниз
  } else {
    // Wall mount (includes 'any' with explicit h3 set to wall height)
    let bw=null,bd=999999,bt=0;
    G.walls.filter(w=>(w.floor||1)===(eq.floor||1)).forEach(w=>{
      const d=dSeg(eq.x,eq.y,w.x1,w.y1,w.x2,w.y2);
      if(d<bd){
        bd=d; bw=w;
        const wl2=Math.max(1,(w.x2-w.x1)**2+(w.y2-w.y1)**2);
        bt=Math.max(0,Math.min(1,((eq.x-w.x1)*(w.x2-w.x1)+(eq.y-w.y1)*(w.y2-w.y1))/wl2));
      }
    });
    if(bw && bd<200){
      const wa=Math.atan2(bw.y2-bw.y1,bw.x2-bw.x1);
      const nx=Math.sin(wa), nz=-Math.cos(wa);
      const dot=(eq.x-bw.x1)*nx+(eq.y-bw.y1)*nz;
      const side=dot>=0?1:-1;
      const px=bw.x1+(bw.x2-bw.x1)*bt;
      const pz=bw.y1+(bw.y2-bw.y1)*bt;
      const wallThick3d=wallThicknessUnits(bw);
      const off=wallThick3d/2+GD/2+1;
      const defH=eq.type==='socket'?0.4/G.sc:eq.type==='heat'?0.6/G.sc:1.5/G.sc;
      const hy=eq.h3!=null?eq.h3:defH;
      mesh.position.set(px+nx*side*off, eqYOff+hy, pz+nz*side*off);
      mesh.rotation.y = -wa + (side>0?0:Math.PI) + ra;
    } else {
      mesh.position.set(eq.x, eqYOff+1.5/G.sc, eq.y);
      mesh.rotation.y = -ra;
    }
  }
  mesh.castShadow=true; sc.add(mesh);

  // Для камеры (Group) добавляем невидимый хитбокс-Mesh прямо в сцену,
  // иначе raycast с recursive=false не находит Group
  if(_isCam3){
    const _hb=new THREE.Mesh(
      new THREE.BoxGeometry(GW,GH*0.7,GW*0.9),
      new THREE.MeshBasicMaterial({visible:false,side:THREE.DoubleSide})
    );
    _hb.name='eq_'+eq.id;
    _hb.position.copy(mesh.position);
    _hb.rotation.copy(mesh.rotation);
    sc.add(_hb);
  }

  // Camera cone — wall-clipped via raycasting
  if(_isCam3&&eq.fovOn!==false){
    const fa=(eq.fovA||60)*Math.PI/180,fd=eq.fovD||120;
    const SEGS=56;
    const halfA=fa/2, tanA=Math.tan(halfA);
    const maxDist=fd/Math.cos(halfA);
    const _floorClip=[new THREE.Plane(new THREE.Vector3(0,1,0),0)];

    const wallMeshes=sc.children.filter(c=>c.name==='wall'&&c.isMesh);
    wallMeshes.forEach(w=>w.updateMatrixWorld(true));
    const camQuat=new THREE.Quaternion().setFromEuler(mesh.rotation);
    const rc=new THREE.Raycaster();

    const verts=[0,0,0];
    const idx=[];
    for(let i=0;i<=SEGS;i++){
      const theta=(i%SEGS)*Math.PI*2/SEGS;
      const lx=tanA*Math.cos(theta),ly=tanA*Math.sin(theta),lz=-1;
      const len=Math.sqrt(lx*lx+ly*ly+1);
      const nx=lx/len,ny=ly/len,nz=lz/len;
      const dirW=new THREE.Vector3(nx,ny,nz).applyQuaternion(camQuat);
      rc.set(mesh.position,dirW);rc.far=maxDist;
      const hits=rc.intersectObjects(wallMeshes);
      const d=hits.length>0?Math.min(maxDist,hits[0].distance):maxDist;
      verts.push(d*nx,d*ny,d*nz);
    }
    for(let i=0;i<SEGS;i++) idx.push(0,i+1,i+2);

    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.Float32BufferAttribute(verts,3));
    geo.setIndex(idx);geo.computeVertexNormals();

    const cm=new THREE.MeshBasicMaterial({color:0x4c8ef7,transparent:true,opacity:.08,side:THREE.DoubleSide,clippingPlanes:_floorClip});
    const cone=new THREE.Mesh(geo,cm);
    const ce=new THREE.LineSegments(new THREE.EdgesGeometry(geo,15),
      new THREE.LineBasicMaterial({color:0x4c8ef7,transparent:true,opacity:.38,clippingPlanes:_floorClip}));

    const coneGroup=new THREE.Group();
    coneGroup.position.copy(mesh.position);
    coneGroup.rotation.copy(mesh.rotation);
    coneGroup.add(cone);coneGroup.add(ce);sc.add(coneGroup);
  }
}

// Builds height-locked wall runs and a surface-level corner.
function routeCablePoints(start,end){
  const sameFloor=start.floor===end.floor;
  return Core.routeCableSegment(start,end,sameFloor?G.walls:[],sameFloor?{floor:end.floor}:{});
}

function drawCable3(sc,pts,colorStr,ghost){
  // linewidth ignored in WebGL — draw cable as thin box meshes per segment
  const col=parseInt(colorStr.replace('#',''),16);
  const opacity=ghost?0.45:1;
  const R=Core.metersToUnits(0.02,G.sc); // 4cm visual diameter at every project scale
  const mat=new THREE.MeshBasicMaterial({color:col,transparent:ghost||false,opacity});

  // Vertex dots at each point
  pts.forEach(p=>{
    const sg=new THREE.SphereGeometry(R*1.2,6,6);
    const sp=new THREE.Mesh(sg,mat.clone());
    sp.position.set(p.x,p.y,p.z);sc.add(sp);
  });

  // Each segment: a box oriented along the segment direction
  for(let i=0;i<pts.length-1;i++){
    const A=new THREE.Vector3(pts[i].x,pts[i].y,pts[i].z);
    const B=new THREE.Vector3(pts[i+1].x,pts[i+1].y,pts[i+1].z);
    const len=A.distanceTo(B);
    if(len<0.01)continue;
    const geo=new THREE.BoxGeometry(R*2,R*2,len);
    const mesh=new THREE.Mesh(geo,mat.clone());
    // Position at midpoint
    mesh.position.copy(A).lerp(B,0.5);
    // Orient along A→B
    mesh.lookAt(B);
    sc.add(mesh);
  }
}

// ── FPS CAMERA ──
function updCam(){
  if(!G.CAM)return;
  const f=G.fps;
  f.pitch=Math.max(-1.4,Math.min(1.4,f.pitch));
  const dir=new THREE.Vector3(Math.cos(f.pitch)*Math.sin(f.yaw),Math.sin(f.pitch),Math.cos(f.pitch)*Math.cos(f.yaw));
  G.CAM.position.set(f.x,f.y,f.z);
  G.CAM.lookAt(f.x+dir.x,f.y+dir.y,f.z+dir.z);
  G.CAM.updateProjectionMatrix();
}
function tickFPS(){
  if(G.mode!=='3d')return;
  const f=G.fps,k=f.keys,s=f.speed;
  const forward=(k.ArrowUp||k.KeyW?1:0)-(k.ArrowDown||k.KeyS?1:0);
  const strafe=(k.ArrowRight||k.KeyD?1:0)-(k.ArrowLeft||k.KeyA?1:0);
  const move=Core.cameraMoveVector(f.yaw,f.pitch,forward,strafe);
  f.x+=move.x*s;f.y+=move.y*s;f.z+=move.z*s;
  if(k.KeyJ)f.yaw-=.03;if(k.KeyL)f.yaw+=.03;
  if(k.KeyI)f.pitch=Math.min(1.4,f.pitch+.03);if(k.KeyK)f.pitch=Math.max(-1.4,f.pitch-.03);
  updCam();
}
function anim3(){
  requestAnimationFrame(anim3);
  if(!G.R||!G.SC||!G.CAM)return;
  tickFPS();G.R.render(G.SC,G.CAM);
}

// ── 3D EVENTS ──
function setup3dEv(el){
  const RAY=new THREE.Raycaster();
  const MP=new THREE.Vector2();
  // Move state
  let mvIdx=-1; // index in G.equip being dragged
  let mvPlane=new THREE.Plane(); // drag plane in world space
  // Resize state
  let resizeCorner=null; // 'TL'|'TR'|'BL'|'BR'
  let resizePlane3=new THREE.Plane();
  let resizeInvMat3=new THREE.Matrix4();
  let rmbDragged=false;
  let rmbTravel=0;

  function castRay(e){
    const rc=el.getBoundingClientRect();
    MP.x=((e.clientX-rc.left)/rc.width)*2-1;
    MP.y=-((e.clientY-rc.top)/rc.height)*2+1;
    RAY.setFromCamera(MP,G.CAM);
  }
  function meshHits(nameFilter){
    return RAY.intersectObjects(G.SC.children,false)
      .filter(h=>h.object.isMesh&&(!nameFilter||h.object.name===nameFilter||h.object.name.startsWith(nameFilter)));
  }

  el.addEventListener('mousedown',e=>{
    if(G.tool3==='comment'&&e.button===0){
      castRay(e);
      const hits=RAY.intersectObjects(G.SC.children,false).filter(h=>h.object.isMesh);
      const wh=hits.find(h=>h.object.name==='wall')||hits.find(h=>h.object.name==='floor')||hits[0];
      let p;
      if(wh){
        p=wh.point.clone();
        if(wh.face){const n=wh.face.normal.clone().transformDirection(wh.object.matrixWorld);p.addScaledVector(n,3);}
      }else{
        // Fallback: пересечение с горизонтальной плоскостью на уровне пола
        const floorPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
        p=new THREE.Vector3();
        if(!RAY.ray.intersectPlane(floorPlane,p))return;
      }
      openCommentDlg(p);
      return;
    }
    if((G.tool3==='utp'||G.tool3==='shvvp')&&e.button===0){
      castRay(e);
      const allMesh=RAY.intersectObjects(G.SC.children,false).filter(h=>h.object.isMesh);
      const wallHit=allMesh.find(h=>h.object.name==='wall');
      const floorHit=allMesh.find(h=>h.object.name==='floor');
      const hit=wallHit||floorHit||allMesh[0];
      if(hit){
        // Put the cable against the wall. Its centre is offset by its visual
        // radius plus a 2mm anti-flicker gap, so the mesh almost touches it.
        const cableRadius=Core.metersToUnits(0.02,G.sc);
        const surfaceGap=Core.metersToUnits(0.002,G.sc);
        const offset=cableRadius+surfaceGap;
        const n=hit.face.normal.clone();
        // Transform normal from local mesh space to world space
        n.transformDirection(hit.object.matrixWorld);
        const p=hit.point.clone().addScaledVector(n, offset);
        const wallIndex=Number.isInteger(hit.object.userData.wallIndex)?hit.object.userData.wallIndex:null;
        const firstFloorWalls=G.walls.filter(w=>(w.floor||1)===1);
        const firstFloorHeight=firstFloorWalls.length?Math.max(...firstFloorWalls.map(w=>w.h!=null?w.h:wh3d())):wh3d();
        const hasSecondFloor=G.walls.some(w=>(w.floor||1)===2);
        const floor=wallIndex!=null?(G.walls[wallIndex].floor||1):(hasSecondFloor&&p.y>=firstFloorHeight-5?2:1);
        const lockedHeight=G.cablePts.length?G.cablePts[0].y:p.y;
        const newPt={x:p.x,y:lockedHeight,z:p.z,floor};
        if(wallIndex!=null)newPt.wallIndex=wallIndex;
        const added=G.cablePts.length>0?routeCablePoints(G.cablePts[G.cablePts.length-1],newPt):[newPt];
        added.forEach(point=>G.cablePts.push(point));
        if(added.length)G.cableStepSizes.push(added.length);
        buildScene3();updateCableUI();
      }
      return;
    }
    // Move tool — pick object
    if(G.tool3==='move'&&e.button===0){
      castRay(e);
      // Check resize handles first
      const hndHits=RAY.intersectObjects(G.SC.children,false)
        .filter(h=>h.object.isMesh&&h.object.name.startsWith('eq_hnd_'));
      if(hndHits.length){
        resizeCorner=hndHits[0].object.name.replace('eq_hnd_','');
        const _rm=G.SC.children.find(c=>c.name==='eq_'+G.selEqId3);
        if(_rm){
          _rm.updateWorldMatrix(true,false);
          const _rn=new THREE.Vector3(0,0,1).applyQuaternion(_rm.quaternion);
          resizePlane3.setFromNormalAndCoplanarPoint(_rn,_rm.position);
          resizeInvMat3.copy(_rm.matrixWorld).invert();
        }
        e.preventDefault(); return;
      }
      const hits=RAY.intersectObjects(G.SC.children,false)
        .filter(h=>h.object.isMesh&&h.object.name.startsWith('eq_')
          &&!h.object.name.startsWith('eq_hnd_')&&h.object.name!=='eq_label');
      if(hits.length){
        const eqId=parseInt(hits[0].object.name.replace('eq_',''));
        mvIdx=G.equip.findIndex(q=>q.id===eqId);
        if(G.selEqId3!==eqId){G.selEqId3=eqId;buildScene3();}
        if(mvIdx>=0){
          // Открываем панель свойств чтобы редактировать модель
          G.sel={t:'eq',i:mvIdx}; showP('eq',mvIdx);
          const camDir=new THREE.Vector3();
          G.CAM.getWorldDirection(camDir);
          mvPlane.setFromNormalAndCoplanarPoint(camDir,hits[0].point);
          el.style.cursor='grabbing';
          e.preventDefault();
        }
      } else {
        if(G.selEqId3>=0){G.selEqId3=-1;buildScene3();}
        closeP();
      }
      return;
    }
    // RMB drag = mouse-look; a short RMB click exits the active tool.
    if(e.button===2){
      G.fps.mouseDown=true;G.fps.lx=e.clientX;G.fps.ly=e.clientY;rmbDragged=false;rmbTravel=0;e.preventDefault();
    }
  });

  el.addEventListener('mousemove',e=>{
    // Resize mode
    if(G.tool3==='move'&&resizeCorner&&G.selEqId3>=0){
      castRay(e);
      const _rpt=new THREE.Vector3();
      if(RAY.ray.intersectPlane(resizePlane3,_rpt)){
        const _rl=_rpt.clone().applyMatrix4(resizeInvMat3);
        const _re=G.equip.find(e=>e.id===G.selEqId3);
        if(_re){
          const minSz=eqSz()*0.3;
          _re.eqW=Math.max(minSz,Math.abs(_rl.x)*2);
          _re.eqH=Math.max(minSz,Math.abs(_rl.y)*2);
          buildScene3();
        }
      }
      return;
    }
    // Drag object in move mode
    if(G.tool3==='move'&&mvIdx>=0){
      castRay(e);
      const target=new THREE.Vector3();
      // Intersect ray with drag plane
      if(RAY.ray.intersectPlane(mvPlane,target)){
        const eq=G.equip[mvIdx];
        const mount=EQ_MOUNT[eq.type]||'wall';
        if(mount==='ceiling'){
          // Snap to ceiling: keep y at WALL_H, move x/z freely
          eq.x=target.x;
          eq.y3z=target.z; // store ceiling position
          // Also sync 2D coords
          eq.y=target.z;
        } else if(mount==='any'){
          // Светильники: снаппим к ближайшей поверхности — потолок или стена
          const allMH=RAY.intersectObjects(G.SC.children,false).filter(h=>h.object.isMesh);
          const ceilMH=allMH.find(h=>h.object.name==='slab'||h.object.name==='ceil_1'||h.object.name==='ceil_2');
          const wallMH=allMH.find(h=>h.object.name==='wall');
          // Светильник: потолок выигрывает если он в пределах 1.8х расстояния до стены —
          // это позволяет «оторвать» светильник от стены, перетаскивая курсор вверх.
          if(ceilMH&&(!wallMH||ceilMH.distance<wallMH.distance*1.8)){
            // Крепление к потолку — этаж сохраняем (eq.floor не меняем).
            eq.x=ceilMH.point.x; eq.y=ceilMH.point.z; eq.h3=null;
          }else if(wallMH){
            // Крепление к стене — этаж по y, h3 относительно низа этажа
            const _mF1W=G.walls.filter(w=>(w.floor||1)===1);
            const _mF1H=_mF1W.length?Math.max(..._mF1W.map(w=>w.h!=null?w.h:wh3d())):wh3d();
            const _mHasF2=G.walls.some(w=>(w.floor||1)===2);
            eq.x=wallMH.point.x; eq.y=wallMH.point.z;
            if(_mHasF2&&wallMH.point.y>=_mF1H-1){
              eq.floor=2; eq.h3=Math.max(0.1/G.sc, wallMH.point.y-_mF1H);
            }else{
              eq.floor=1; eq.h3=Math.max(0.1/G.sc, wallMH.point.y);
            }
          }else{
            eq.x=target.x; eq.y=target.z;
          }
        } else {
          // Try to snap to a wall surface
          const wHits=RAY.intersectObjects(G.SC.children,false)
            .filter(h=>h.object.isMesh&&h.object.name==='wall');
          if(wHits.length){
            const wp=wHits[0].point;
            const _mF1W=G.walls.filter(w=>(w.floor||1)===1);
            const _mF1H=_mF1W.length?Math.max(..._mF1W.map(w=>w.h!=null?w.h:wh3d())):wh3d();
            const _mHasF2=G.walls.some(w=>(w.floor||1)===2);
            eq.x=wp.x; eq.y=wp.z;
            if(_mHasF2&&wp.y>=_mF1H-1){
              eq.floor=2; eq.h3=Math.max(0.1/G.sc, wp.y-_mF1H);
            }else{
              eq.floor=1; eq.h3=Math.max(0.1/G.sc, wp.y);
            }
          } else {
            // No wall hit — move freely in xz at current height
            eq.x=target.x;
            eq.y=target.z;
          }
        }
        buildScene3();
      }
      return;
    }
    // Mouse look (RMB held or pointer locked)
    if(!G.fps.mouseDown&&!G.fps.locked)return;
    const dx=G.fps.locked?e.movementX:(e.clientX-G.fps.lx);
    const dy=G.fps.locked?e.movementY:(e.clientY-G.fps.ly);
    if(G.fps.mouseDown){rmbTravel+=Math.hypot(dx,dy);if(rmbTravel>3)rmbDragged=true;}
    G.fps.yaw-=dx*.003;G.fps.pitch-=dy*.003;
    G.fps.pitch=Math.max(-1.4,Math.min(1.4,G.fps.pitch));
    G.fps.lx=e.clientX;G.fps.ly=e.clientY;updCam();
  });

  el.addEventListener('mouseup',e=>{
    if(e.button===2){
      G.fps.mouseDown=false;
      if(!rmbDragged&&G.tool3!=='nav')set3T('nav');
      rmbDragged=false;
    }
    if(e.button===0&&resizeCorner){resizeCorner=null;savH();return;}
    if(e.button===0&&mvIdx>=0){mvIdx=-1;el.style.cursor='default';}
  });

  el.addEventListener('dblclick',()=>{if(!document.pointerLockElement)el.requestPointerLock();});
  document.addEventListener('pointerlockchange',()=>{
    G.fps.locked=document.pointerLockElement===el;
    document.getElementById('lock-hint').style.display=G.fps.locked?'block':'none';
    document.getElementById('info3').style.display=G.fps.locked?'none':'block';
  });
  el.addEventListener('wheel',e=>{
    G.fps.speed=Math.max(1,Math.min(100,G.fps.speed*(e.deltaY<0?1.18:.85)));
    const v=G.fps.speed.toFixed(0);
    document.getElementById('spd-val').textContent=v;document.getElementById('spd2').textContent=v;
    e.preventDefault();
  },{passive:false});
  el.addEventListener('contextmenu',e=>e.preventDefault());

  // Drop: слушаем на родительском div #c3, не на canvas
  // (WebGL canvas может блокировать drag events)
  const c3div=document.getElementById('c3');
  c3div.addEventListener('dragover',e=>{e.preventDefault();e.dataTransfer.dropEffect='copy';});
  c3div.addEventListener('drop',e=>{
    e.preventDefault();
    const type=e.dataTransfer.getData('text/plain');
    if(!type)return;
    // Вычислим NDC координаты относительно canvas
    const rc=el.getBoundingClientRect();
    MP.x=((e.clientX-rc.left)/rc.width)*2-1;
    MP.y=-((e.clientY-rc.top)/rc.height)*2+1;
    RAY.setFromCamera(MP,G.CAM);
    const allHits=RAY.intersectObjects(G.SC.children,false).filter(h=>h.object.isMesh);
    const wallHit=allHits.find(h=>h.object.name==='wall');
    const floorHit=allHits.find(h=>h.object.name==='floor');
    const ceilHit=allHits.find(h=>h.object.name==='slab'||h.object.name==='ceil_1'||h.object.name==='ceil_2');
    const mount=EQ_MOUNT[type]||'wall';
    // Для потолочного оборудования (light, any) — предпочитаем потолок/перекрытие
    let hit;
    if((mount==='ceiling'||mount==='any')&&ceilHit&&(!wallHit||ceilHit.distance<=wallHit.distance)){
      hit=ceilHit;
    }else{
      hit=wallHit||floorHit||ceilHit||allHits[0];
    }
    // Определяем верхнюю границу 1 этажа для разбиения по этажам
    const _dropF1Walls=G.walls.filter(w=>(w.floor||1)===1);
    const _dropF1H=_dropF1Walls.length?Math.max(..._dropF1Walls.map(w=>w.h!=null?w.h:wh3d())):wh3d();
    const _dropHasF2=G.walls.some(w=>(w.floor||1)===2);

    let wx=0,wy=0,h3val=null,eqFloor=G.floor;
    if(hit){
      wx=hit.point.x; wy=hit.point.z;
      const isCeilSurf=hit.object.name==='slab'||hit.object.name==='ceil_1'||hit.object.name==='ceil_2';
      if(hit.object.name==='wall'){
        // Этаж стены определяется по y попадания, h3 — относительно низа этажа
        if(_dropHasF2&&hit.point.y>=_dropF1H-1){
          eqFloor=2;
          h3val=Math.max(0.1/G.sc, hit.point.y-_dropF1H);
        }else{
          eqFloor=1;
          h3val=Math.max(0.1/G.sc, hit.point.y);
        }
      }else if(isCeilSurf&&(mount==='ceiling'||mount==='any')){
        // Светильник/потолочное оборудование: этаж берём из текущей кнопки этажа,
        // а не из имени потолочного меша. Иначе если камера физически на 2 эт.
        // (после FPS-навигации), луч попадает в ceil_2 и оборудование уезжает на 2 эт.
        eqFloor=G.floor;
        h3val=null;
      }
      // остальные случаи (пол, slab снизу и т.д.) — eqFloor=G.floor, h3val=null
    }
    savH();
    G.equip.push({id:G.nextId++,type,x:wx,y:wy,
      name:EQ_NAMES[type]||type,model:'',ang:0,floor:eqFloor,
      fovA:60,fovD:5/G.sc,fovOn:type==='camera',h3:h3val});
    refresh3d();
  });

  // Keyboard
  if(!G._kbSet){
    G._kbSet=true;
    document.addEventListener('keydown',e=>{
      if(e.target.tagName==='INPUT')return;
      if(G.mode==='3d'){
        G.fps.keys[e.code]=true;
        if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
        if(e.code==='Escape'){
          if(G.fps.locked)document.exitPointerLock();
          if(G.cableType&&G.cablePts.length>0){abortCable();}
        }
        // Backspace removes the last user click and all generated bend points.
        if(e.code==='Backspace'&&G.cableType&&G.cablePts.length>0){
          undoCablePt();e.preventDefault();
        }
      }
      if(G.mode==='2d'){
        const k=e.key.toLowerCase();
        if(k==='w')setTool('wall');else if(k==='d')setTool('door');else if(k==='o')setTool('window');else if(k==='r')setTool('measure');else if(k==='v')setTool('select');
        if((e.code==='Delete'||e.code==='Backspace')&&G.sel)delSel();
      }
    });
    document.addEventListener('keyup',e=>{if(G.fps.keys)G.fps.keys[e.code]=false;});
  }
}

// ── CABLE ──
function cabLen(pts){let l=0;for(let i=1;i<pts.length;i++)l+=Math.sqrt((pts[i].x-pts[i-1].x)**2+(pts[i].y-pts[i-1].y)**2+(pts[i].z-pts[i-1].z)**2);return l;}

function set3T(t){
  const isCable=t==='utp'||t==='shvvp';
  const wasCable=G.tool3==='utp'||G.tool3==='shvvp';

  // При уходе с кабельного инструмента — завершить текущий кабель (если ≥2 точек)
  if(wasCable && !isCable){
    if(G.cablePts.length>=2) finishCable();
    else { G.cablePts=[];G.cableStepSizes=[];buildScene3(); }
    G.cableType=null;
  }

  // При смене типа кабеля (UTP→ШВВП) — завершить предыдущий
  if(isCable && G.cableType && G.cableType!==t){
    if(G.cablePts.length>=2) finishCable();
    else { G.cablePts=[];G.cableStepSizes=[];buildScene3(); }
  }

  G.tool3=t;
  document.querySelectorAll('#tg3 .tb').forEach(b=>b.classList.remove('on'));
  const ids={nav:'t3nav',move:'t3move',utp:'t3utp',shvvp:'t3shvvp',comment:'t3comment'};
  if(ids[t])document.getElementById(ids[t]).classList.add('on');

  document.getElementById('i3comment').style.display=(t==='comment')?'block':'none';
  if(isCable){
    G.cableType=t;
    // НЕ сбрасываем cablePts если тот же тип
    document.getElementById('t3finish').style.display='flex';
    document.getElementById('t3undo1').style.display='flex';
    document.getElementById('i3cable').style.display='block';
    document.getElementById('i3move').style.display='none';
  } else {
    document.getElementById('t3finish').style.display='none';
    document.getElementById('t3undo1').style.display='none';
    document.getElementById('i3cable').style.display='none';
    document.getElementById('i3move').style.display=t==='move'?'block':'none';
  }
}
function finishCable(){
  if(!G.cableType||G.cablePts.length<2){
    G.cablePts=[];G.cableStepSizes=[];buildScene3();updateCableUI();return;
  }
  savH();
  G.cables.push({
    type:G.cableType,
    pts:[...G.cablePts],
    name:`${CABLE_LAB[G.cableType]} ${G.cables.filter(c=>c.type===G.cableType).length+1}`
  });
  G.cablePts=[];G.cableStepSizes=[];
  // Оставляем G.cableType — можно сразу прокладывать следующий того же типа
  buildScene3();updateCableUI();
}
function undoCablePt(){
  if(!G.cablePts.length)return;
  const count=G.cableStepSizes.length?G.cableStepSizes.pop():1;
  G.cablePts.splice(Math.max(0,G.cablePts.length-count),count);
  buildScene3();updateCableUI();
}
function abortCable(){
  // Отменить текущую прокладку без сохранения
  G.cablePts=[];G.cableStepSizes=[];G.cableType=null;
  document.getElementById('t3finish').style.display='none';
  document.getElementById('t3undo1').style.display='none';
  document.getElementById('i3cable').style.display='none';
  // Переключить на навигацию
  G.tool3='nav';
  document.querySelectorAll('#tg3 .tb').forEach(b=>b.classList.remove('on'));
  document.getElementById('t3nav')?.classList.add('on');
  buildScene3();updateCableUI();
}

function setFloor(f){
  G.floor=f;
  // Update buttons
  ['t2floor1','t2floor2','t3floor1','t3floor2'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.classList.toggle('on',id.includes('floor'+f));
  });
  if(G.mode==='2d')rd();else buildScene3();
}

function toggleCeiling(){
  G.showCeiling=!G.showCeiling;
  const btn=document.getElementById('t3ceil');
  if(btn)btn.classList.toggle('on',G.showCeiling);
  buildScene3();
}

function updateCableUI(){
  const box=document.getElementById('cablebox'),body=document.getElementById('cb-body');
  const leg=document.getElementById('cable-leg'),legb=document.getElementById('cable-leg-body');
  if(G.cables.length===0&&G.cablePts.length<2){box.style.display='none';leg.style.display='none';return;}
  box.style.display='block';leg.style.display='block';
  let html='';
  const utpCabs=G.cables.filter(c=>c.type==='utp');
  const shvCabs=G.cables.filter(c=>c.type==='shvvp');
  const utpTotal=utpCabs.reduce((s,c)=>s+cabLen(c.pts),0);
  const shvTotal=shvCabs.reduce((s,c)=>s+cabLen(c.pts),0);
  G.cables.forEach((c,i)=>{
    html+=`<div class="cb-row"><span style="color:${CABLE_COL[c.type]}">${escHtml(c.name)}</span><span style="color:var(--t1);cursor:pointer" onclick="selCable(${i})">📋 ${(cabLen(c.pts)*G.sc).toFixed(2)}м</span></div>`;
  });
  if(G.cablePts.length>=2)html+=`<div class="cb-row" style="color:var(--t3)">В процессе: ${(cabLen(G.cablePts)*G.sc).toFixed(2)}м</div>`;
  if(utpTotal>0)html+=`<div class="cb-row" style="border-top:1px solid var(--ln);margin-top:4px;padding-top:4px"><b style="color:var(--am)">UTP итого:</b><b style="color:var(--t1)">${(utpTotal*G.sc).toFixed(2)}м</b></div>`;
  if(shvTotal>0)html+=`<div class="cb-row"><b style="color:var(--gr)">ШВВП итого:</b><b style="color:var(--t1)">${(shvTotal*G.sc).toFixed(2)}м</b></div>`;
  body.innerHTML=html;
  legb.innerHTML=G.cables.map(c=>`<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="color:${CABLE_COL[c.type]}">⬤ ${escHtml(c.name)}</span><span style="color:var(--t2)">${(cabLen(c.pts)*G.sc).toFixed(1)}м</span></div>`).join('');
}
function selCable(i){G.sel={t:'cable',i};showP('cable',i);}

