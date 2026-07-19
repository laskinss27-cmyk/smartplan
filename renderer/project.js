'use strict';
// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT')return;
  if((e.ctrlKey||e.metaKey)&&e.code==='KeyZ'){
    if(e.shiftKey)redo();else undo();
    e.preventDefault();return;
  }
  if((e.ctrlKey||e.metaKey)&&e.code==='KeyY'){
    redo();e.preventDefault();return;
  }
  if(G.mode==='2d'){
    const k=e.key.toLowerCase();
    if(k==='w')setTool('wall');else if(k==='d')setTool('door');else if(k==='o')setTool('window');else if(k==='r')setTool('measure');else if(k==='v')setTool('select');
    else if(k==='escape'){G.drawOn=false;G.drawS=null;G.drawC=null;rd();}
  }
  if((e.code==='Delete')&&G.sel&&G.mode==='2d')delSel();
});

// ═══════════════════════════════════════════════════════════
// SVG IMAGE CACHE (для отрисовки кастомного оборудования на canvas)
// ═══════════════════════════════════════════════════════════
const _svgImgCache={};
function getSvgImg(type,svgData){
  if(type in _svgImgCache)return _svgImgCache[type];
  if(!svgData){_svgImgCache[type]=null;return null;}
  _svgImgCache[type]=null; // placeholder пока грузится
  const img=new Image();
  img.onload=()=>{_svgImgCache[type]=img;rd();};
  img.onerror=()=>{_svgImgCache[type]=null;};
  try{img.src=svgData;}catch(e){_svgImgCache[type]=null;}
  return null;
}
function clearSvgCache(type){delete _svgImgCache[type];}

// CUSTOM EQUIPMENT
// ═══════════════════════════════════════════════════════════
let _aeqSvg=null; // SVG data URL для нового оборудования

function openAddEq(){
  _aeqSvg=null;
  document.getElementById('aeq-name').value='';
  document.getElementById('aeq-sub').value='';
  document.getElementById('aeq-preview').style.display='none';
  const bsel=document.getElementById('aeq-behavior');
  if(bsel)bsel.value='normal';
  document.getElementById('aeq-drop').style.display='block';
  // Пересоздаём file input — иначе браузер не даёт повторно выбрать тот же файл
  const oldInp=document.getElementById('aeq-file');
  const newInp=document.createElement('input');
  newInp.type='file'; newInp.id='aeq-file'; newInp.accept='.svg,image/svg+xml';
  newInp.style.display='none';
  newInp.onchange=function(){loadAeqSvg(this);};
  oldInp.replaceWith(newInp);
  document.getElementById('ov-eq').style.display='flex';
}
function closeAddEq(){document.getElementById('ov-eq').style.display='none';}

function loadAeqSvg(inp){
  const file=inp.files[0]; if(!file)return;
  if(!file.name.toLowerCase().endsWith('.svg')&&!file.type.includes('svg')){
    alert('Пожалуйста выберите SVG файл');return;
  }
  if(file.size>500000){alert('SVG файл слишком большой (макс. 500KB)');return;}
  const reader=new FileReader();
  reader.onerror=function(){alert('Ошибка чтения файла');};
  reader.onload=function(ev){
    let svgText=String(ev.target.result||'');
    // Гарантируем xmlns — без него <img> отказывается рендерить SVG
    if(!/xmlns\s*=/i.test(svgText)){
      svgText=svgText.replace(/<svg\b/i,'<svg xmlns="http://www.w3.org/2000/svg"');
    }
    // Грузим SVG в Image и растеризуем в PNG — PNG dataURL грузится всегда
    const blob=new Blob([svgText],{type:'image/svg+xml'});
    const url=URL.createObjectURL(blob);
    const img=new Image();
    img.onload=function(){
      try{
        const S=256;
        const c=document.createElement('canvas');c.width=S;c.height=S;
        const ctx=c.getContext('2d');
        // Вписываем SVG с сохранением пропорций
        const iw=img.naturalWidth||img.width||S;
        const ih=img.naturalHeight||img.height||S;
        const k=Math.min(S/iw,S/ih);
        const dw=iw*k, dh=ih*k;
        ctx.drawImage(img,(S-dw)/2,(S-dh)/2,dw,dh);
        const pngUrl=c.toDataURL('image/png');
        URL.revokeObjectURL(url);
        _aeqSvg=pngUrl;
        const prev=document.getElementById('aeq-preview');
        prev.innerHTML='<img src="'+pngUrl+'" style="width:48px;height:48px;object-fit:contain;border:1px solid var(--ln2);border-radius:6px;padding:4px;background:var(--bg3)">';
        prev.style.display='block';
        document.getElementById('aeq-drop').style.display='none';
      }catch(e){
        URL.revokeObjectURL(url);
        alert('Не удалось обработать SVG: '+e.message);
      }
    };
    img.onerror=function(){
      URL.revokeObjectURL(url);
      alert('SVG невалидный или содержит неподдерживаемые элементы (внешние ссылки, скрипты).');
    };
    img.src=url;
  };
  reader.readAsText(file);
  inp.value='';
}

function confirmAddEq(){
  const nameInp=document.getElementById('aeq-name');
  const name=(nameInp?nameInp.value:'').trim();
  if(!name){
    if(nameInp)nameInp.focus();
    nameInp.style.borderColor='var(--rd)';
    setTimeout(()=>nameInp.style.borderColor='',1500);
    return;
  }
  const subInp=document.getElementById('aeq-sub');
  const sub=subInp?subInp.value.trim():'';
  const behavior=document.getElementById('aeq-behavior')?.value||'normal';
  const type='custom_'+G.nextId++;
  G.customEq.push({type,name,sub,svgData:_aeqSvg||null,behavior});
  EQ_NAMES[type]=name;
  // Поведение определяет mount и доп. свойства
  EQ_MOUNT[type]=behavior==='light'?'any':'wall';
  EQ_COL3[type]=behavior==='camera'?0x4c8ef7:behavior==='light'?0xffc840:0x6a8fc0;
  EQ_COL2[type]=behavior==='camera'?'#4c8ef7':behavior==='light'?'#f0a832':'#6a8fc0';
  // Сбрасываем кэш SVG чтобы иконка загрузилась заново
  clearSvgCache(type);
  renderCustomEqPanel();
  // Сохраняем кастомный список
  try{localStorage.setItem(LS_EQ_KEY,JSON.stringify(G.customEq));}catch(e){}
  closeAddEq();
}

function renderCustomEqPanel(){
  const list=document.getElementById('custom-eq-list');
  list.innerHTML=G.customEq.map(ceq=>{
    const abbr=escHtml((ceq.name||'').slice(0,2).toUpperCase());
    const safeType=escHtml(ceq.type||'');
    const iconHtml=ceq.svgData
      ?'<img src="'+escHtml(ceq.svgData)+'" style="width:24px;height:24px;object-fit:contain">'
      :'<svg width="24" height="24" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3" fill="#1a2a4a" stroke="#4c8ef7" stroke-width="1.2"/><text x="12" y="16" text-anchor="middle" fill="#4c8ef7" font-size="10" font-family="Arial">'+abbr+'</text></svg>';
    const subHtml=(ceq.sub?'<div class="ei-s">'+escHtml(ceq.sub)+'</div>':'')+
      (ceq.behavior&&ceq.behavior!=='normal'?'<div class="ei-s" style="color:var(--ac);font-size:9px">'+
      (ceq.behavior==='camera'?'с конусом обзора':'потолок/стена')+'</div>':'');
    const safeName=escHtml(ceq.name||'');
    return '<div class="ei" draggable="true" data-eq="'+safeType+'" id="cei_'+safeType+'" style="position:relative">'
      +'<div class="ei-ic">'+iconHtml+'</div>'
      +'<div style="flex:1;min-width:0"><div class="ei-n" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+safeName+'</div>'+subHtml+'</div>'
      +'<button class="ceq-del" data-delete-eq="'+safeType+'" title="Удалить из библиотеки" '
      +'onmousedown="event.stopPropagation()" '
      +'style="background:transparent;border:1px solid var(--ln2);color:var(--t3);width:18px;height:18px;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;line-height:1;padding:0;flex-shrink:0" '
      +'onmouseover="this.style.background=\'var(--rd)\';this.style.color=\'#fff\';this.style.borderColor=\'var(--rd)\'" '
      +'onmouseout="this.style.background=\'transparent\';this.style.color=\'var(--t3)\';this.style.borderColor=\'var(--ln2)\'">×</button>'
      +'</div>';
  }).join('');
  list.querySelectorAll('.ei[data-eq]').forEach(el=>{
    el.removeEventListener('dragstart',el._ds);
    el._ds=e=>e.dataTransfer.setData('text/plain',el.dataset.eq);
    el.addEventListener('dragstart',el._ds);
  });
  list.querySelectorAll('.ceq-del[data-delete-eq]').forEach(btn=>{
    btn.addEventListener('click',e=>{e.stopPropagation();deleteCustomEq(btn.dataset.deleteEq);});
  });
}

function deleteCustomEq(type){
  const idx=G.customEq.findIndex(c=>c.type===type);
  if(idx<0)return;
  const ceq=G.customEq[idx];
  // Считаем размещённые экземпляры
  const placed=G.equip.filter(e=>e.type===type).length;
  const msg=placed>0
    ? 'Удалить «'+ceq.name+'» из библиотеки?\nНа плане размещено: '+placed+' шт. Они тоже будут удалены.'
    : 'Удалить «'+ceq.name+'» из библиотеки?';
  if(!confirm(msg))return;
  savH();
  // Удаляем размещённые экземпляры
  G.equip=G.equip.filter(e=>e.type!==type);
  // Удаляем привязанные кабели (если кабель шёл к удаляемому объекту)
  if(Array.isArray(G.cables)){
    G.cables=G.cables.filter(cab=>{
      if(!cab||!cab.fromEq||!cab.toEq)return true;
      // У кабелей нет ссылки на eq.type — они хранят координаты, поэтому ничего не делаем
      return true;
    });
  }
  // Удаляем из словарей и кэшей
  G.customEq.splice(idx,1);
  delete EQ_NAMES[type];
  delete EQ_MOUNT[type];
  delete EQ_COL3[type];
  delete EQ_COL2[type];
  clearSvgCache(type);
  // Сбрасываем выбор если удалённый элемент выбран
  if(G.sel&&G.sel.t==='eq'){
    const eq=G.equip[G.sel.i]; if(!eq) G.sel=null;
  }
  renderCustomEqPanel();
  try{localStorage.setItem(LS_EQ_KEY,JSON.stringify(G.customEq));}catch(e){}
  refresh3d();
  closeP();
}

// Кастомные типы в 3D — рисуем как спрайт из SVG или как цветной бокс
function getCustomColor(type){
  const ceq=G.customEq.find(c=>c.type===type);
  if(!ceq)return 0x4c8ef7;
  // Генерируем цвет из хэша имени
  let h=0;for(let i=0;i<ceq.name.length;i++)h=(h*31+ceq.name.charCodeAt(i))&0xffffff;
  return 0x334466|(h&0x8888aa); // тёмно-синеватый оттенок
}

function registerCustomEqDefinitions(){
  G.customEq.forEach(ceq=>{
    EQ_NAMES[ceq.type]=ceq.name;
    EQ_MOUNT[ceq.type]=ceq.behavior==='light'?'any':'wall';
    EQ_COL3[ceq.type]=ceq.behavior==='camera'?0x4c8ef7:ceq.behavior==='light'?0xffc840:0x6a8fc0;
    EQ_COL2[ceq.type]=ceq.behavior==='camera'?'#4c8ef7':ceq.behavior==='light'?'#f0a832':'#6a8fc0';
  });
}

// ═══════════════════════════════════════════════════════════
// SAVE / LOAD
// ═══════════════════════════════════════════════════════════

function getProjectData(){
  return {
    version:3,
    modelRevision:2,
    verts:G.verts, walls:G.walls, doors:G.doors, windows:G.windows,
    equip:G.equip, measures:G.measures,
    cables:G.cables, comments:G.comments,
    customEq:G.customEq,
    sc:G.sc, gs:G.gs,
    savedAt:new Date().toISOString()
  };
}

function applyProjectData(data){
  try{
    Core.validateProjectData(data);
    Core.migrateLegacyDefaults(data);
  }catch(err){alert('Неверный формат файла: '+err.message);return false;}
  G.verts=data.verts||[];
  G.walls=data.walls||[];
  G.doors=data.doors||[];
  G.windows=data.windows||[];
  G.equip=data.equip||[];
  G.measures=data.measures||[];
  G.cables=data.cables||[];
  G.comments=data.comments||[];
  G.customEq=data.customEq||[];
  // Восстанавливаем счётчики ID чтобы избежать коллизий
  if(G.verts.length) G.nextVid=Math.max(...G.verts.map(v=>v.id))+1;
  let maxId=G.nextId;
  G.equip.forEach(e=>{if(e.id>=maxId)maxId=e.id+1;});
  G.comments.forEach(c=>{if(c.id>=maxId)maxId=c.id+1;});
  G.nextId=maxId;
  if(data.sc)G.sc=Core.normalizeScale(data.sc,G.sc);
  if(data.gs)G.gs=data.gs;
  // Восстанавливаем кастомные словари и сбрасываем кэши SVG (2D и 3D)
  Object.keys(_svgImgCache).forEach(k=>delete _svgImgCache[k]);
  registerCustomEqDefinitions();
  renderCustomEqPanel();
  G.sel=null; G.drawOn=false; G.drawS=null; G.drawC=null;
  G.cablePts=[];G.cableStepSizes=[];G.cableType=null;
  G.hist=[];G.future=[];
  G.floors=Math.max(1,...G.walls.map(w=>w.floor||1),...G.equip.map(e=>e.floor||1));
  G.floor=Math.min(G.floor||1,G.floors);
  syncProjectControls();
  if(G.mode==='2d')rd();
  else{buildScene3();autoCamera();}
  return true;
}

// Сохранить в JSON файл
async function saveProject(){
  const data=getProjectData();
  if(window.electronAPI?.saveProject){
    try{
      const result=await window.electronAPI.saveProject(data);
      if(result?.saved){autoSave();showSaveBadge();}
    }catch(err){alert('Ошибка сохранения файла: '+err.message);}
    return;
  }
  const json=JSON.stringify(data,null,2);
  const blob=new Blob([json],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  const name=prompt('Имя проекта:','Проект_'+new Date().toLocaleDateString('ru-RU').replace(/\./g,'-'));
  if(name===null)return;
  a.href=url; a.download=(name||'SmartPlan')+'_v3.json';
  a.click(); URL.revokeObjectURL(url);
  autoSave(); // также обновляем автосохранение
}

// Загрузить из JSON файла
async function loadProject(){
  if(window.electronAPI?.openProject){
    try{
      const data=await window.electronAPI.openProject();
      if(data&&applyProjectData(data))autoSave();
    }catch(err){alert('Ошибка чтения файла: '+err.message);}
    return;
  }
  const inp=document.createElement('input');
  inp.type='file'; inp.accept='.json';
  inp.onchange=e=>{
    const file=e.target.files[0]; if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const data=JSON.parse(ev.target.result);
        if(applyProjectData(data))autoSave();
      }catch(err){alert('Ошибка чтения файла: '+err.message);}
    };
    reader.readAsText(file);
  };
  inp.click();
}

// Автосохранение в localStorage
const LS_KEY='smartplan_v3_autosave';
const LS_EQ_KEY='smartplan_v3_customEq';

function autoSave(){
  try{
    const data=getProjectData();
    localStorage.setItem(LS_KEY, JSON.stringify(data));
    // Кастомное оборудование отдельно — восстанавливается даже в новом проекте
    if(G.customEq.length)
      localStorage.setItem(LS_EQ_KEY, JSON.stringify(G.customEq));
  }catch(e){}
}

function autoLoad(){
  // localStorage в Electron работает через persist: partition
  try{
    // Гарантируем что G.customEq массив
    if(!Array.isArray(G.customEq))G.customEq=[];
    // Восстанавливаем кастомное оборудование
    const ceqSaved=localStorage.getItem(LS_EQ_KEY);
    if(ceqSaved){
      const ceqList=JSON.parse(ceqSaved);
      if(Array.isArray(ceqList)){
        Core.validateProjectData({version:3,customEq:ceqList});
        ceqList.forEach(ceq=>{
          if(!ceq||!ceq.type)return;
          if(!G.customEq.find(c=>c.type===ceq.type)){
            G.customEq.push(ceq);
          }
        });
        registerCustomEqDefinitions();
        renderCustomEqPanel();
      }
    }
    // Восстанавливаем последний проект
    const saved=localStorage.getItem(LS_KEY);
    if(saved){
      const data=JSON.parse(saved);
      if(data&&data.version===3&&Array.isArray(data.walls)&&Array.isArray(data.equip)){
        if(applyProjectData(data))showAutoLoadMsg(data.savedAt);
      }
    }
  }catch(e){console.warn('autoLoad error:',e);}
}

function showSaveBadge(){
  // Мигаем зелёной точкой на кнопке Сохранить
  const b=document.getElementById('save-badge');
  if(!b)return;
  b.style.display='block';
  clearTimeout(b._t);
  b._t=setTimeout(()=>b.style.display='none',2500);
}
function showAutoLoadMsg(dateStr){
  const d=dateStr?new Date(dateStr):null;
  const msg=document.createElement('div');
  msg.style.cssText='position:fixed;bottom:20px;right:20px;background:var(--bg3);border:1px solid var(--gr);border-radius:8px;padding:10px 16px;font-size:12px;color:var(--gr);z-index:300;box-shadow:0 4px 20px #0008;display:flex;align-items:center;gap:10px';
  msg.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    +'Восстановлен автосохранённый проект'+(d?' от '+d.toLocaleString('ru-RU'):'')+' <span style="cursor:pointer;color:var(--t3);margin-left:4px" onclick="this.parentElement.remove()">✕</span>';
  document.body.appendChild(msg);
  setTimeout(()=>msg.remove&&msg.remove(),5000);
}

// ── THEME ──
G._lightTheme=false;
// getVar moved to top
function toggleTheme(){
  G._lightTheme=!G._lightTheme;
  document.body.classList.toggle('light-theme',G._lightTheme);
  document.getElementById('theme-icon-dark').style.display=G._lightTheme?'none':'block';
  document.getElementById('theme-icon-light').style.display=G._lightTheme?'block':'none';
  document.getElementById('theme-label').textContent=G._lightTheme?'Тёмный':'Светлый';
  // Применяем пользовательские цвета для новой темы (или сбрасываем к её дефолтам)
  if(typeof loadColorSettings==='function')loadColorSettings();
  // Обновляем 3D фон
  if(G.R){
    G.R.setClearColor(getVar('--cv-bg',G._lightTheme?'#f0f2f5':'#07090e'));
    buildScene3();
  }
  rd();
  // Сохраняем предпочтение
  try{localStorage.setItem('smartplan_theme',G._lightTheme?'light':'dark');}catch(e){}
}

// ── 3D SCENE PRESET ──
const SCENE_PRESET_KEY='smartplan_scene_preset';
function applyScenePreset(value,persist=true){
  const preset=Core.scenePresetConfig(value,G.sc);
  G.scenePreset=preset.id;
  const btn=document.getElementById('scene-preset-btn');
  const label=document.getElementById('scene-preset-label');
  if(btn){
    btn.classList.toggle('scene-architectural',preset.id==='architectural');
    btn.setAttribute('aria-pressed',preset.id==='architectural'?'true':'false');
    btn.title=preset.id==='architectural'
      ? 'Архитектурный стиль: мягкий свет и атмосферная палитра'
      : 'Монтажный стиль: контрастная техническая схема';
  }
  if(label)label.textContent=preset.label;
  if(G.CAM){
    G.CAM.fov=preset.fov;
    G.CAM.updateProjectionMatrix();
  }
  if(G.R)buildScene3();
  if(persist){
    try{localStorage.setItem(SCENE_PRESET_KEY,preset.id);}catch(e){}
  }
}
function toggleScenePreset(){
  applyScenePreset(G.scenePreset==='architectural'?'technical':'architectural');
}

// ─── Диалог комментария ─────────────────────────────────────
let _commentPos=null;
function openCommentDlg(p){
  _commentPos=p;
  const inp=document.getElementById('comment-inp');
  inp.value='';
  document.getElementById('ov-comment').style.display='flex';
  setTimeout(()=>inp.focus(),60);
}
function confirmComment(){
  const txt=document.getElementById('comment-inp').value.trim();
  const p=_commentPos;
  closeComment();
  if(txt&&p){
    savH();
    G.comments.push({id:G.nextId++,x:p.x,y:p.y,z:p.z,text:txt});
    buildScene3();
  }
}
function closeComment(){
  document.getElementById('ov-comment').style.display='none';
  _commentPos=null;
}

setTool('wall');syncProjectControls();rsz();rd();bindDragItems();preloadSvg3d();
if(window.electronAPI?.onCommand){
  window.electronAPI.onCommand(command=>{
    if(command==='new')clearAll();
    else if(command==='open')loadProject();
    else if(command==='save')saveProject();
    else if(command==='undo')undo();
    else if(command==='redo')redo();
    else if(command==='theme-dark'&&G._lightTheme)toggleTheme();
    else if(command==='theme-light'&&!G._lightTheme)toggleTheme();
  });
}
G.appVersion='dev';
if(window.electronAPI?.getVersion){
  window.electronAPI.getVersion().then(version=>{
    G.appVersion=version;document.title='SmartPlan '+version;
    document.getElementById('ls').textContent='Монтажник v'+version;
  }).catch(()=>{});
}
// Восстанавливаем тему
// ─── Пользовательские цвета стен и окружения ────────────────
const COLOR_KEY='smartplan_colors_v1';
const COLOR_VARS={
  dark:{
    '--cv-wall':     {label:'Стены',          def:'#3a6090'},
    '--cv-wall-sel': {label:'Выделенная стена',def:'#80b8ff'},
    '--cv-bg':       {label:'Фон холста',     def:'#07090e'},
    '--cv-grid1':    {label:'Сетка тонкая',   def:'#111628'},
    '--cv-grid2':    {label:'Сетка крупная',  def:'#181e36'},
    '--cv-axis':     {label:'Оси координат',  def:'#222a48'},
    '--cv-floor':    {label:'Пол (3D)',       def:'#0b0d16'}
  },
  light:{
    '--cv-wall':     {label:'Стены',          def:'#2a5a90'},
    '--cv-wall-sel': {label:'Выделенная стена',def:'#1a4a80'},
    '--cv-bg':       {label:'Фон холста',     def:'#f8f9fb'},
    '--cv-grid1':    {label:'Сетка тонкая',   def:'#e0e4ec'},
    '--cv-grid2':    {label:'Сетка крупная',  def:'#d0d5e0'},
    '--cv-axis':     {label:'Оси координат',  def:'#b0b8cc'},
    '--cv-floor':    {label:'Пол (3D)',       def:'#e8eaee'}
  }
};
function _colorTheme(){return G._lightTheme?'light':'dark';}
function loadColorSettings(){
  let stored={};
  try{stored=JSON.parse(localStorage.getItem(COLOR_KEY)||'{}')||{};}catch(e){stored={};}
  const theme=_colorTheme();
  const map=stored[theme]||{};
  Object.keys(COLOR_VARS[theme]).forEach(v=>{
    if(map[v]) document.documentElement.style.setProperty(v,map[v]);
    else document.documentElement.style.removeProperty(v);
  });
  return stored;
}
function saveColorSetting(varName,value){
  let stored={};
  try{stored=JSON.parse(localStorage.getItem(COLOR_KEY)||'{}')||{};}catch(e){stored={};}
  const theme=_colorTheme();
  if(!stored[theme])stored[theme]={};
  if(value)stored[theme][varName]=value; else delete stored[theme][varName];
  try{localStorage.setItem(COLOR_KEY,JSON.stringify(stored));}catch(e){}
  if(value)document.documentElement.style.setProperty(varName,value);
  else document.documentElement.style.removeProperty(varName);
  rd();
  if(G.mode==='3d'&&G.R){
    G.R.setClearColor(getVar('--cv-bg',G._lightTheme?'#f0f2f5':'#07090e'));
    buildScene3();
  }
}
function openColorSettings(){
  const theme=_colorTheme();
  const stored=loadColorSettings();
  const map=stored[theme]||{};
  const rows=document.getElementById('cs-rows');
  rows.innerHTML=Object.keys(COLOR_VARS[theme]).map(v=>{
    const cfg=COLOR_VARS[theme][v];
    const cur=map[v]||cfg.def;
    return '<div style="display:flex;align-items:center;gap:10px">'
      +'<input type="color" value="'+cur+'" oninput="saveColorSetting(\''+v+'\',this.value)" style="width:38px;height:30px;border:1px solid var(--ln2);border-radius:5px;background:transparent;cursor:pointer;padding:0">'
      +'<div style="flex:1"><div style="font-size:12px;color:var(--t1)">'+cfg.label+'</div>'
      +'<div style="font-size:10px;color:var(--t3);font-family:monospace">'+v+'</div></div>'
      +'<button title="Сбросить к значению по умолчанию" onclick="this.previousElementSibling.previousElementSibling.value=\''+cfg.def+'\';saveColorSetting(\''+v+'\',null);openColorSettings()" style="background:transparent;border:1px solid var(--ln2);color:var(--t3);width:26px;height:26px;border-radius:4px;cursor:pointer;font-size:11px;padding:0">↺</button>'
      +'</div>';
  }).join('');
  document.getElementById('ov-colors').style.display='flex';
}
function closeColorSettings(){document.getElementById('ov-colors').style.display='none';}
function resetColorSettings(){
  if(!confirm('Сбросить цвета '+(_colorTheme()==='light'?'светлой':'тёмной')+' темы к значениям по умолчанию?'))return;
  let stored={};
  try{stored=JSON.parse(localStorage.getItem(COLOR_KEY)||'{}')||{};}catch(e){stored={};}
  delete stored[_colorTheme()];
  try{localStorage.setItem(COLOR_KEY,JSON.stringify(stored));}catch(e){}
  loadColorSettings();
  rd();
  if(G.mode==='3d'&&G.R){
    G.R.setClearColor(getVar('--cv-bg',G._lightTheme?'#f0f2f5':'#07090e'));
    buildScene3();
  }
  openColorSettings();
}

try{if(localStorage.getItem('smartplan_theme')==='light')toggleTheme();}catch(e){}
loadColorSettings();
try{applyScenePreset(localStorage.getItem(SCENE_PRESET_KEY)||'technical',false);}catch(e){applyScenePreset('technical',false);}
autoLoad();

// Финальное сохранение при закрытии/перезагрузке страницы
window.addEventListener('beforeunload',()=>{
  clearTimeout(_autoSaveTimer);
  autoSave();
});
