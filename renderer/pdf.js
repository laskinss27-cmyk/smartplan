'use strict';
// ═══════════════════════════════════════════════════════════
// PDF EXPORT
// ═══════════════════════════════════════════════════════════
// Stored 3D snapshots for PDF
G.snaps3d=G.snaps3d||[];

function addSnap3d(){
  if(!G.R){alert('Сначала откройте 3D режим');return;}
  // Force render frame
  G.R.render(G.SC,G.CAM);
  const dataUrl=G.R.domElement.toDataURL('image/png',.92);
  const label=`Вид ${G.snaps3d.length+1}`;
  G.snaps3d.push({dataUrl,label});
  renderSnap3dList();
}
function removeSnap3d(i){G.snaps3d.splice(i,1);renderSnap3dList();}
function renderSnap3dList(){
  const list=document.getElementById('snap3d-list');
  if(!list)return;
  list.innerHTML=G.snaps3d.map((s,i)=>`
    <div style="display:flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--ln);border-radius:5px;padding:5px 8px">
      <img src="${escHtml(s.dataUrl)}" style="width:80px;height:50px;object-fit:cover;border-radius:3px;flex-shrink:0">
      <input value="${escHtml(s.label)}" oninput="G.snaps3d[${i}].label=this.value" style="flex:1;padding:3px 6px;border-radius:3px;border:1px solid var(--ln2);background:var(--bg4);color:var(--t1);font-size:11px;outline:none">
      <button onclick="removeSnap3d(${i})" style="background:none;border:none;color:var(--rd);cursor:pointer;font-size:14px;padding:2px 5px">✕</button>
    </div>`).join('');
}

function openPDF(){
  G.snaps3d=G.snaps3d||[];
  // Build equipment model inputs
  const grid=document.getElementById('eq-model-grid');
  grid.innerHTML=G.equip.length?G.equip.map((eq,i)=>`
    <div class="eq-row">
      <div class="eq-row-label">${escHtml(EQ_NAMES[eq.type]||eq.type)}</div>
      <input id="em_${i}" placeholder="Модель / Артикул" value="${escHtml(eq.model||'')}">
    </div>`).join(''):'<div style="color:var(--t3);font-size:11px">Нет оборудования</div>';
  // Cable section
  const cabGrid=document.getElementById('cable-model-grid');
  const utpL=G.cables.filter(c=>c.type==='utp').reduce((s,c)=>s+cabLen(c.pts),0);
  const shvL=G.cables.filter(c=>c.type==='shvvp').reduce((s,c)=>s+cabLen(c.pts),0);
  cabGrid.innerHTML='';
  if(utpL>0)cabGrid.innerHTML+=`<div class="eq-row"><div class="eq-row-label" style="color:var(--am)">UTP кабель</div><span class="eq-cnt">${(utpL*G.sc).toFixed(2)} м</span><input id="em_utp" placeholder="Марка кабеля"></div>`;
  if(shvL>0)cabGrid.innerHTML+=`<div class="eq-row"><div class="eq-row-label" style="color:var(--gr)">ШВВП кабель</div><span class="eq-cnt">${(shvL*G.sc).toFixed(2)} м</span><input id="em_shvvp" placeholder="Марка кабеля"></div>`;
  if(!utpL&&!shvL)cabGrid.innerHTML='<div style="color:var(--t3);font-size:11px">Кабели не проложены</div>';
  renderSnap3dList();
  document.getElementById('ov').classList.add('on');
}
function closePDF(){document.getElementById('ov').classList.remove('on');}

function doPDF(){
  G.snaps3d=G.snaps3d||[];
  const name=document.getElementById('pN').value||'Не указан';
  const addr=document.getElementById('pA').value||'—';
  const phone=document.getElementById('pT').value||'—';
  const kp=document.getElementById('pK').value||'КП-001';
  const pdfComments=(document.getElementById('pdfComments')?.value||'').trim();
  const date=new Date().toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
  // Читаем модели из инпутов обратно в оборудование
  G.equip.forEach((eq,i)=>{const inp=document.getElementById('em_'+i);if(inp)eq.model=inp.value;});
  // Группируем по тип+модель
  const _mg={};
  G.equip.forEach(eq=>{const k=eq.type+'|||'+(eq.model||'');if(!_mg[k])_mg[k]={type:eq.type,model:eq.model||'',count:0};_mg[k].count++;});
  const _tableRows=Object.values(_mg);
  const utpModel=document.getElementById('em_utp')?.value||'';
  const shvModel=document.getElementById('em_shvvp')?.value||'';
  const utpL=G.cables.filter(c=>c.type==='utp').reduce((s,c)=>s+cabLen(c.pts),0);
  const shvL=G.cables.filter(c=>c.type==='shvvp').reduce((s,c)=>s+cabLen(c.pts),0);

  const{jsPDF}=window.jspdf;
  const doc=new jsPDF('landscape','mm','a4');
  const PW=297,PH=210;
  const M=8; // margin

  // ── Helper: canvas text block → image in PDF ──
  function canvasText(lines,opts={}){
    // lines: [{text, size, color, bold}]
    const W=opts.w||400,scale=2;
    const c=document.createElement('canvas');c.width=W*scale;c.height=300*scale;
    const x=c.getContext('2d');x.scale(scale,scale);
    let y=0;
    lines.forEach(l=>{
      x.font=`${l.bold?'bold ':''} ${l.size||12}px Arial`;
      x.fillStyle=l.color||'#222';
      x.fillText(l.text,0,y+=l.size||12);
      y+=3;
    });
    // trim height
    const h=y+8;
    const c2=document.createElement('canvas');c2.width=W*scale;c2.height=h*scale;
    c2.getContext('2d').drawImage(c,0,0);
    return{img:c2.toDataURL('image/png',.95),w:W,h};
  }

  // ── Page 1: Header + 2D + 3D views ──
  // Header bar
  doc.setFillColor(15,25,45);doc.rect(0,0,PW,16,'F');
  doc.setFillColor(76,142,247);doc.rect(0,0,3,16,'F');

  // Header text via canvas (Cyrillic)
  const hc=document.createElement('canvas');hc.width=1800;hc.height=60;
  const hx=hc.getContext('2d');
  hx.fillStyle='#0f1929';hx.fillRect(0,0,1800,60);
  hx.font='bold 18px Arial';hx.fillStyle='#c8d8f0';hx.fillText('SmartPlan',0,20);
  hx.font='13px Arial';hx.fillStyle='#4c8ef7';hx.fillText(`Заказчик: `,0,42);
  hx.fillStyle='#c8d8f0';hx.fillText(name,90,42);
  hx.fillStyle='#4c8ef7';hx.fillText(`Адрес: `,360,42);hx.fillStyle='#c8d8f0';hx.fillText(addr,430,42);
  hx.fillStyle='#4c8ef7';hx.fillText(`Тел: `,900,42);hx.fillStyle='#c8d8f0';hx.fillText(phone,940,42);
  hx.fillStyle='#4c8ef7';hx.fillText(`КП: `,1150,42);hx.fillStyle='#c8d8f0';hx.fillText(kp,1185,42);
  hx.fillStyle='#4c8ef7';hx.fillText(`Дата: `,1380,42);hx.fillStyle='#c8d8f0';hx.fillText(date,1440,42);
  doc.addImage(hc.toDataURL(),'PNG',0,0,PW,16);

  const rowY=18; // start of image row
  const imgH=100; // height for each image row

  // ── 2D snapshot (auto-fit to content) ──
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  const pad2d=40;
  [...G.walls,...G.doors].forEach(w=>{minX=Math.min(minX,w.x1,w.x2);minY=Math.min(minY,w.y1,w.y2);maxX=Math.max(maxX,w.x1,w.x2);maxY=Math.max(maxY,w.y1,w.y2);});
  G.equip.forEach(e=>{minX=Math.min(minX,e.x-20);minY=Math.min(minY,e.y-20);maxX=Math.max(maxX,e.x+20);maxY=Math.max(maxY,e.y+20);});
  if(!isFinite(minX)){minX=0;minY=0;maxX=400;maxY=300;}
  minX-=pad2d;minY-=pad2d;maxX+=pad2d;maxY+=pad2d;
  const scW=maxX-minX,scH=maxY-minY;
  const oc=document.createElement('canvas');
  const tW=900,tH=Math.round(tW*scH/scW);
  oc.width=tW;oc.height=tH;
  const oCX=oc.getContext('2d');
  oCX.fillStyle=G._lightTheme?'#f8f9fb':'#07090e';oCX.fillRect(0,0,tW,tH);
  const sf=tW/scW;
  oCX.save();oCX.translate(-minX*sf,-minY*sf);oCX.scale(sf,sf);
  drawSceneOnCtx(oCX,sf);
  oCX.restore();
  const snap2=oc.toDataURL('image/png',.95);

  // Lay out images row: 2D + all stored 3D snaps, side by side
  // Collect all images
  const allImgs=[{src:snap2,label:'2D Чертёж',asp:tW/tH}];
  G.snaps3d.forEach(s=>{
    const tmp=new Image();tmp.src=s.dataUrl;
    // We don't know dimensions without loading, assume 16:9
    allImgs.push({src:s.dataUrl,label:s.label,asp:16/9});
  });

  // Distribute images across rows of max 3 per row
  const perRow=Math.min(3,allImgs.length);
  const imgW=(PW-M*2-(perRow-1)*4)/perRow;
  let cx2=M;
  let curRowY=rowY;
  allImgs.forEach((img,i)=>{
    if(i>0&&i%perRow===0){curRowY+=imgH+8;cx2=M;}
    const ih=imgW/img.asp;
    doc.setDrawColor(60,80,120);doc.setLineWidth(.25);doc.rect(cx2,curRowY,imgW,Math.min(ih,imgH));
    doc.addImage(img.src,'PNG',cx2,curRowY,imgW,Math.min(ih,imgH));
    // label
    const lc=document.createElement('canvas');lc.width=300;lc.height=18;
    const lx=lc.getContext('2d');lx.fillStyle='#fff';lx.fillRect(0,0,300,18);
    lx.font='bold 11px Arial';lx.fillStyle='#1a3a70';lx.textAlign='center';lx.fillText(img.label,150,13);
    doc.addImage(lc.toDataURL(),'PNG',cx2,curRowY+Math.min(ih,imgH)+0.5,imgW,5);
    cx2+=imgW+4;
  });

  const tableY=curRowY+imgH+10;

  // ── SPEC TABLE (white background, clean) ──
  const specRowH=7;
  const specX=M,specW=PW-M*2;

  function drawTableHeader(y,title){
    // Section title row
    doc.setFillColor(235,240,252);doc.rect(specX,y,specTableW,specRowH+1,'F');
    doc.setDrawColor(180,195,230);doc.setLineWidth(.2);doc.rect(specX,y,specTableW,specRowH+1,'S');
    const tc=document.createElement('canvas');tc.width=600;tc.height=22;
    const tx=tc.getContext('2d');tx.fillStyle='#eaf0fc';tx.fillRect(0,0,600,22);
    tx.font='bold 13px Arial';tx.fillStyle='#1a3a70';tx.fillText(title,4,16);
    doc.addImage(tc.toDataURL(),'PNG',specX,y,specTableW,specRowH+1);
    return y+specRowH+1;
  }

  function drawTableRow(y,cols,widths,isAlt){
    if(isAlt){doc.setFillColor(248,250,254);doc.rect(specX,y,specW,specRowH,'F');}
    doc.setDrawColor(210,218,235);doc.setLineWidth(.15);
    let rx=specX;
    cols.forEach((col,i)=>{
      doc.rect(rx,y,widths[i],specRowH,'S');
      // Render text via canvas for Cyrillic
      const cc=document.createElement('canvas');cc.width=widths[i]*4;cc.height=20;
      const cx3=cc.getContext('2d');
      cx3.fillStyle=isAlt?'#f8faff':'#fff';cx3.fillRect(0,0,cc.width,20);
      cx3.font=`${col.bold?'bold ':''} 12px Arial`;cx3.fillStyle=col.color||'#111';
      cx3.fillText(col.text,4,14);
      doc.addImage(cc.toDataURL(),'PNG',rx+0.5,y+0.5,widths[i]-1,specRowH-1);
      rx+=widths[i];
    });
    return y+specRowH;
  }

  let ty=tableY;
  // Compact table: 160mm wide on left side
  const specTableW=160;
  const W1=75,W2=30,W3=55; // 75+30+55=160

  // Equipment header
  ty=drawTableHeader(ty,'Оборудование');
  // Column headers
  ty=drawTableRow(ty,[{text:'Наименование',bold:true,color:'#334'},{text:'Кол-во',bold:true,color:'#334'},{text:'Модель / Артикул',bold:true,color:'#334'}],[W1,W2,W3],false);
  _tableRows.forEach((row,j)=>{
    ty=drawTableRow(ty,[{text:EQ_NAMES[row.type]||row.type},{text:row.count+' шт.'},{text:row.model||'—'}],[W1,W2,W3],j%2===1);
    if(ty>PH-20){doc.addPage();ty=M;}
  });

  // Cable section
  if(utpL>0||shvL>0){
    ty+=3;
    ty=drawTableHeader(ty,'Кабельные трассы');
    ty=drawTableRow(ty,[{text:'Тип кабеля',bold:true,color:'#334'},{text:'Длина',bold:true,color:'#334'},{text:'Марка / Артикул',bold:true,color:'#334'}],[W1,W2,W3],false);
    if(utpL>0)ty=drawTableRow(ty,[{text:'UTP кабель'},{text:(utpL*G.sc).toFixed(2)+' м'},{text:utpModel||'—'}],[W1,W2,W3],false);
    if(shvL>0)ty=drawTableRow(ty,[{text:'ШВВП кабель'},{text:(shvL*G.sc).toFixed(2)+' м'},{text:shvModel||'—'}],[W1,W2,W3],true);
    ty+=2;
    // Total row
    const totalC=document.createElement('canvas');totalC.width=700;totalC.height=22;
    const totalX=totalC.getContext('2d');totalX.fillStyle='#e8f0fd';totalX.fillRect(0,0,700,22);
    totalX.font='bold 13px Arial';totalX.fillStyle='#1a3a70';
    totalX.fillText(`Итого кабеля: ${((utpL+shvL)*G.sc).toFixed(2)} м`,4,16);
    doc.setFillColor(232,240,253);doc.rect(specX,ty,specTableW,specRowH,'F');
    doc.addImage(totalC.toDataURL(),'PNG',specX,ty,specTableW,specRowH);
  }



  // Комментарии из формы — справа от таблицы
  if(pdfComments){
    const cmX=specX+specTableW+8, cmW=Math.max(40,PW-cmX-M);
    let cty=tableY;
    const mkC=(txt,bg,bold,wrap)=>{
      const W=cmW*4,lh=18;
      const lines=wrap?wrapText(txt,W-8,14):[[txt]];
      const H=Math.max(22,(lines.length||1)*lh+8);
      const c=document.createElement('canvas');c.width=W;c.height=H;
      const x=c.getContext('2d');x.fillStyle=bg;x.fillRect(0,0,W,H);
      x.font=(bold?'bold ':'')+'13px Arial';x.fillStyle='#1a3a70';
      (lines.length?lines:[[txt]]).forEach((ln,i)=>x.fillText(ln,6,lh*(i+1)));
      return{url:c.toDataURL(),h:H/4};
    };
    function wrapText(text,maxW,size){
      const c=document.createElement('canvas');const x=c.getContext('2d');
      x.font=size+'px Arial';
      const words=text.split(' '),lines=[];let cur='';
      words.forEach(w=>{const t=cur?cur+' '+w:w;if(x.measureText(t).width>maxW){lines.push(cur);cur=w;}else cur=t;});
      if(cur)lines.push(cur);return lines.map(l=>[l]);
    }
    // Заголовок
    const hdr=mkC('Комментарии к КП','#e8f0fd',true,false);
    doc.setFillColor(232,240,253);doc.rect(cmX,cty,cmW,specRowH+1,'F');
    doc.setDrawColor(180,195,230);doc.setLineWidth(.2);doc.rect(cmX,cty,cmW,specRowH+1,'S');
    doc.addImage(hdr.url,'PNG',cmX,cty,cmW,specRowH+1);
    cty+=specRowH+1;
    // Текст построчно
    const body=mkC(pdfComments,'#ffffff',false,true);
    const bh=Math.max(specRowH,body.h);
    doc.setFillColor(255,255,255);doc.rect(cmX,cty,cmW,bh,'F');
    doc.setDrawColor(210,218,235);doc.setLineWidth(.15);doc.rect(cmX,cty,cmW,bh,'S');
    doc.addImage(body.url,'PNG',cmX+.5,cty+.5,cmW-1,bh-1);
  }
    // Footer
  doc.setFillColor(240,244,252);doc.rect(0,PH-7,PW,7,'F');
  doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(80,100,140);
  doc.text(`SmartPlan v${G.appVersion||'dev'}  |  КП: ${kp}  |  ${date}`,PW/2,PH-1.5,{align:'center'});

  doc.save(`SmartPlan_${kp}_${name.replace(/\s+/g,'_')}.pdf`);
  closePDF();
}

// Draw scene onto arbitrary canvas context (for PDF snapshot)
function drawSceneOnCtx(ctx,scale){
  // Walls
  G.walls.forEach(w=>{
    const th=Math.max(2,wallThicknessUnits(w));
    ctx.strokeStyle='#3a6090';ctx.lineWidth=th;ctx.lineCap='square';
    ctx.beginPath();ctx.moveTo(w.x1,w.y1);ctx.lineTo(w.x2,w.y2);ctx.stroke();
    const ang=Math.atan2(w.y2-w.y1,w.x2-w.x1);
    ctx.save();ctx.translate((w.x1+w.x2)/2,(w.y1+w.y2)/2);ctx.rotate(ang);
    const l=L(w.x1,w.y1,w.x2,w.y2),fs=11;ctx.font=`${fs}px monospace`;
    const txt=px2m(l)+' м',tw=ctx.measureText(txt).width;
    ctx.fillStyle='rgba(7,9,14,.8)';ctx.fillRect(-tw/2-3,-fs-2,tw+6,fs+4);
    ctx.fillStyle='#5a8aaa';ctx.textAlign='center';ctx.textBaseline='bottom';ctx.fillText(txt,0,0);ctx.restore();
  });
  // Doors
  G.doors.forEach(d=>{
    const ang=Math.atan2(d.y2-d.y1,d.x2-d.x1),l=L(d.x1,d.y1,d.x2,d.y2);
    ctx.save();ctx.translate(d.x1,d.y1);ctx.rotate(ang);
    ctx.strokeStyle='#07090e';ctx.lineWidth=12;ctx.lineCap='butt';
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(l,0);ctx.stroke();
    ctx.strokeStyle='#f0a832';ctx.lineWidth=2;ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(l*.9,0);ctx.stroke();
    ctx.strokeStyle='rgba(240,168,50,.4)';ctx.lineWidth=1;ctx.setLineDash([3,2]);
    ctx.beginPath();ctx.arc(0,0,l*.9,0,Math.PI/2);ctx.stroke();ctx.setLineDash([]);ctx.restore();
  });
  // Equip
  G.equip.forEach(eq=>{
    const _isCamera=eq.type==='camera'||(G.customEq.find(c=>c.type===eq.type)?.behavior==='camera');
    if(_isCamera&&eq.fovOn!==false){
      const fa=(eq.fovA||60)*Math.PI/180,fd=eq.fovD||120;
      // Вычисляем угол так же как в equip2d: нормаль закреплённой стены + пользовательский поворот
      let baseAng=0;
      const bw=Number.isInteger(eq.wallId)?G.walls.find(w=>w.id===eq.wallId&&(w.floor||1)===(eq.floor||1)):null;
      if(bw){
        const wa=Math.atan2(bw.y2-bw.y1,bw.x2-bw.x1);
        const nx=Math.sin(wa),nz=-Math.cos(wa);
        const side=eq.wallSide===-1?-1:1;
        baseAng=Math.atan2(nz*side,nx*side);
      }
      const ra=-(eq.ang||0)*Math.PI/180+baseAng;
      ctx.save();ctx.translate(eq.x,eq.y);ctx.rotate(ra);
      ctx.fillStyle='rgba(76,142,247,.15)';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,fd,-fa/2,fa/2);ctx.closePath();ctx.fill();
      ctx.strokeStyle='rgba(76,142,247,.35)';ctx.lineWidth=1;ctx.stroke();ctx.restore();
    }
    const r=11,col=EQ_COL2[eq.type]||'#888';
    ctx.beginPath();ctx.arc(eq.x,eq.y,r,0,Math.PI*2);
    ctx.fillStyle='rgba(7,9,14,.9)';ctx.strokeStyle=col;ctx.lineWidth=1.5;ctx.fill();ctx.stroke();
    ctx.fillStyle=col;ctx.font='bold 8px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
    const sym={camera:'C',doorbell:'D',monitor:'M',socket:'S',panel:'P',light:'L',heat:'H',nvr:'N'};
    ctx.fillText(sym[eq.type]||'?',eq.x,eq.y);
    // Подпись под иконкой — полное название
    const labelNames={camera:'Камера',doorbell:'Панель',monitor:'Монитор',socket:'Розетка',panel:'Щит',light:'Свет',heat:'Радиатор',nvr:'NVR'};
    const lbl=labelNames[eq.type]||eq.type;
    ctx.font=`${Math.max(7, r*0.7)}px Arial`;
    ctx.fillStyle='rgba(200,220,240,0.9)';
    ctx.fillText(lbl, eq.x, eq.y+r+5);
    if(eq.name && eq.name!==lbl && eq.name!==(EQ_NAMES&&EQ_NAMES[eq.type])){
      ctx.font=`${Math.max(6, r*0.6)}px Arial`;
      ctx.fillStyle='rgba(150,180,210,0.7)';
      ctx.fillText(eq.name, eq.x, eq.y+r+13);
    }
  });
  // Measures
  G.measures.forEach(m=>{
    ctx.strokeStyle='#2dd87a';ctx.lineWidth=1;ctx.setLineDash([4,2]);
    ctx.beginPath();ctx.moveTo(m.x1,m.y1);ctx.lineTo(m.x2,m.y2);ctx.stroke();ctx.setLineDash([]);
  });
}

