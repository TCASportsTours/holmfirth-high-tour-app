/* TCA Tours — tour expenses: the LIST, totals and downloads, in admin.html only. v2
   Needs the admin password (step 1) AND the expenses password (EXPENSES_PASSWORD in Netlify).
   The expenses password is kept for this browser tab only (sessionStorage) and is cleared by Lock. */
'use strict';
var XA = { rows: null };
var XA_NY = 'America/New_York', XA_UK = 'Europe/London';
function xaKey(){ try{ return sessionStorage.getItem('hny_exp')||''; }catch(e){ return ''; } }
function xaHdr(extra){ var h={'x-staff-key':pw(),'x-expenses-key':xaKey()}; if(extra) for(var k in extra) h[k]=extra[k]; return h; }
function xaStamp(ts,tz){ if(!ts) return '—'; return new Intl.DateTimeFormat('en-GB',{timeZone:tz,weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ts)); }
function xaDate(){ return new Intl.DateTimeFormat('en-CA',{timeZone:XA_NY,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()); }
function xaMoney(c,v){ try{ return new Intl.NumberFormat('en-GB',{style:'currency',currency:c,currencyDisplay:'narrowSymbol'}).format(Number(v||0)); }catch(e){ return c+' '+Number(v||0).toFixed(2); } }
function xaGBP(v){ return '£'+Number(v||0).toFixed(2); }
function xaJs(v){ return esc(JSON.stringify(String(v==null?'':v))); }

function xaUnlock(){
  var v=$('xaPw').value; if(!v){ say('xaMsg','Enter the expenses password.',true); return; }
  if(!pw()){ say('xaMsg','Enter the admin password in step 1 first.',true); return; }
  try{ sessionStorage.setItem('hny_exp',v); }catch(e){}
  xaLoad(true);
}
function xaLock(){ try{ sessionStorage.removeItem('hny_exp'); }catch(e){} XA.rows=null; $('xaPw').value=''; $('xaGate').style.display=''; $('xaBox').innerHTML=''; say('xaMsg','Locked.'); }
function xaLoad(first){
  say('xaMsg','Loading…');
  fetch(API+'?type=expenses',{headers:xaHdr(),cache:'no-store'}).then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ return {r:r,j:j}; }); }).then(function(x){
    if(!x.r.ok||!x.j.ok){
      try{ sessionStorage.removeItem('hny_exp'); }catch(e){}
      say('xaMsg',x.r.status===429?'Too many wrong passwords. Wait 15 minutes.':x.r.status===503?(x.j.error||'Not set up yet.'):x.r.status===401?'That isn\'t right: check the admin password (step 1) and the expenses password.':'Could not load ('+x.r.status+').',true); return; }
    XA.rows=x.j.rows||[]; $('xaGate').style.display='none'; say('xaMsg',''); xaPaint();
  }).catch(function(){ say('xaMsg','Could not reach the server.',true); });
}
function xaPaint(){
  var rows=XA.rows||[], tot=0, by={};
  rows.forEach(function(r){ tot+=r.gbp; by[r.name]=by[r.name]||{n:0,gbp:0}; by[r.name].n++; by[r.name].gbp+=r.gbp; });
  var h='<div class="stats" style="grid-template-columns:repeat(2,1fr)"><div class="stat"><b>'+rows.length+'</b><span>expenses</span></div><div class="stat private"><b>'+xaGBP(tot)+'</b><span>total in pounds</span></div></div>';
  if(rows.length){
    h+='<h3 style="margin-top:18px">By staff member</h3>'+Object.keys(by).sort().map(function(n){ return '<div class="whorow"><span><b>'+esc(n)+'</b> <span class="s">· '+by[n].n+' expense'+(by[n].n>1?'s':'')+'</span></span><b>'+xaGBP(by[n].gbp)+'</b></div>'; }).join('');
    h+='<div class="row" style="margin-top:16px"><button class="btn dark" onclick="xaXlsx()">Download spreadsheet (.xlsx)</button><button class="btn line" onclick="xaZip()">Download all receipts (.zip)</button></div>'+
      '<p class="small muted" style="margin-top:6px">Each receipt file is named by its Ref (e.g. EXP-001), matching the spreadsheet.</p>';
    h+='<h3 style="margin-top:22px">Every expense <span class="small muted" style="font-family:var(--body)">newest first</span></h3>'+rows.slice().reverse().map(xaCard).join('');
  } else h+='<p class="small muted" style="margin-top:12px">No expenses submitted yet.</p>';
  h+='<div class="row" style="margin-top:18px"><button class="btn line sm" onclick="xaLoad()">Refresh</button><button class="btn line sm" onclick="xaLock()">Lock</button><button class="btn line sm" onclick="xaClearAll()">Clear all expenses &amp; receipts</button></div>';
  $('xaBox').innerHTML=h;
}
function xaCard(r){
  var conv=r.currency!=='GBP';
  return '<div class="card rule" style="padding:16px"><div class="row" style="justify-content:space-between"><b style="font-family:var(--display);font-size:22px">'+esc(r.desc)+'</b><span class="pill gold">'+esc(r.ref)+'</span></div>'+
    '<div class="small" style="margin-top:6px;line-height:1.8">'+
    '<b>'+esc(r.name)+'</b> · '+esc(r.category)+(r.paidBy?' · '+esc(r.paidBy):'')+' · spent '+esc(r.spentOn||'—')+'<br>'+
    (r.country?esc(r.country)+' ('+esc(r.currency)+') · ':'')+'<b>'+xaMoney(r.currency,r.amount)+'</b>'+(conv?' × '+r.rate+' = <b>'+xaGBP(r.gbp)+'</b>':'')+'<br>'+
    (conv?'<span class="muted">Rate 1 '+esc(r.currency)+' = £'+r.rate+' · '+(r.rateEdited?'typed in by staff':esc(r.rateSource||'')+(r.rateFetchedAt?' · fetched '+esc(xaStamp(r.rateFetchedAt,XA_NY))+' NY':''))+'</span><br>':'')+
    'Submitted <b>'+esc(xaStamp(r.submittedAt,XA_NY))+' NY</b> <span class="muted">('+esc(xaStamp(r.submittedAt,XA_UK))+' UK)</span>'+
    (r.notes?'<br>Notes: '+esc(r.notes):'')+'</div>'+
    '<div class="row" style="margin-top:8px">'+((r.receipts||[]).length?(r.receipts||[]).map(function(f){ return '<button class="btn line sm" style="text-transform:none;letter-spacing:0" onclick="xaOne('+xaJs(r.id)+','+f.n+')">'+esc(xaFileName(r,f))+'</button>'; }).join(''):'<span class="pill" style="background:var(--alarm);color:#fff">No receipt</span>')+
    '<button class="btn line sm" onclick="xaDelete('+xaJs(r.id)+','+xaJs(r.ref)+')">Delete</button></div></div>';
}
function xaDelete(id,ref){
  if(!confirm('Delete '+ref+' and its receipts? This can\'t be undone.')) return;
  fetch(API+'?type=expensedel',{method:'POST',headers:xaHdr({'content-type':'application/json'}),body:JSON.stringify({id:id})})
    .then(function(r){ if(r.ok){ say('xaMsg',ref+' deleted.'); xaLoad(); } else say('xaMsg','Could not delete ('+r.status+').',true); }).catch(function(){ say('xaMsg','Could not reach the server.',true); });
}
function xaClearAll(){
  if(!confirm('Clear EVERY expense and receipt? Download the spreadsheet and receipts first. This can\'t be undone.')) return;
  fetch(API+'?type=expenses',{method:'DELETE',headers:xaHdr()}).then(function(r){ if(r.ok){ say('xaMsg','All expenses cleared. Numbering starts again at EXP-001.'); xaLoad(); } else say('xaMsg','Not cleared ('+r.status+').',true); })
    .catch(function(){ say('xaMsg','Could not reach the server.',true); });
}

/* ---------- downloads ---------- */
function xaSafe(s){ return String(s||'').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,30); }
function xaFileName(r,f){ var ext=f.type==='application/pdf'?'pdf':f.type==='image/png'?'png':'jpg'; return r.ref+'_'+xaSafe(r.name)+(r.receipts.length>1?'_'+(f.n+1):'')+'.'+ext; }
function xaGet(id,n){ return fetch(API+'?type=receipt&id='+encodeURIComponent(id)+'&n='+n,{headers:xaHdr(),cache:'no-store'}).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }); }
function xaBytes(data){ var b=atob(data.slice(data.indexOf(',')+1)), u=new Uint8Array(b.length); for(var i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; }
function xaSave(blob,name){ var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },4000); }
function xaOne(id,n){
  var r=(XA.rows||[]).filter(function(x){return x.id===id;})[0], f=r&&r.receipts[n]; if(!f) return;
  xaGet(id,n).then(function(j){ xaSave(new Blob([xaBytes(j.data)],{type:j.type}),xaFileName(r,f)); }).catch(function(){ say('xaMsg','Could not download that receipt.',true); });
}
/* Versioned file names: v1, v2… (counted in this browser), plus the New York date */
function xaDlName(kind,ext){ var k='hny_xadl_'+kind, v=1; try{ v=(parseInt(localStorage.getItem(k),10)||0)+1; localStorage.setItem(k,String(v)); }catch(e){} return 'Holmfirth_NYC_'+kind+'_v'+v+'_'+xaDate()+'.'+ext; }
function xaXlsx(){
  var rows=XA.rows||[]; if(!rows.length) return;
  loadXLSX(function(){
    var X=window.XLSX, head=['Ref','Submitted (New York)','Submitted (UK)','Staff member','Date of expense','What for','Type','Paid by','Country','Currency','Amount','Rate (1 unit = £)','Amount in £','How £ was worked out','Rate source','Rate time (New York)','Receipt files','Notes'];
    var aoa=[head];
    rows.forEach(function(r){ aoa.push([r.ref,xaStamp(r.submittedAt,XA_NY),xaStamp(r.submittedAt,XA_UK),r.name,r.spentOn,r.desc,r.category,r.paidBy,r.country||'',r.currency,r.amount,r.rate,r.gbp,
      xaMoney(r.currency,r.amount)+' × '+r.rate+' = '+xaGBP(r.gbp),r.rateEdited?'Typed in by staff':r.rateSource,r.rateFetchedAt&&!r.rateEdited?xaStamp(r.rateFetchedAt,XA_NY):'',
      (r.receipts||[]).map(function(f){return xaFileName(r,f);}).join(', ')||'NO RECEIPT',r.notes||'']); });
    var last=rows.length+1;
    aoa.push(['','','','','','','','','','','','Total £',0]);
    var ws=X.utils.aoa_to_sheet(aoa);
    for(var i=2;i<=last;i++){ ws['M'+i]={t:'n',v:rows[i-2].gbp,f:'ROUND(K'+i+'*L'+i+',2)',z:'"£"#,##0.00'}; ws['K'+i].z='#,##0.00'; ws['L'+i].z='0.00000000'; }
    ws['M'+(last+1)]={t:'n',v:Math.round(rows.reduce(function(t,r){return t+r.gbp;},0)*100)/100,f:'SUM(M2:M'+last+')',z:'"£"#,##0.00'};
    ws['!cols']=[8,22,22,18,12,30,16,8,18,8,10,12,12,30,30,22,34,30].map(function(w){return {wch:w};});
    ws['!autofilter']={ref:'A1:R'+last};
    var names=[]; rows.forEach(function(r){ if(names.indexOf(r.name)<0) names.push(r.name); }); names.sort();
    var by=[['Staff member','Number of expenses','Total £']];
    names.forEach(function(n){ var mine=rows.filter(function(r){return r.name===n;}); by.push([n,mine.length,Math.round(mine.reduce(function(t,r){return t+r.gbp;},0)*100)/100]); });
    var ws2=X.utils.aoa_to_sheet(by);
    names.forEach(function(n,k){ var i=k+2; ws2['B'+i].f='COUNTIF(Expenses!D:D,A'+i+')'; ws2['C'+i].f='SUMIF(Expenses!D:D,A'+i+',Expenses!M:M)'; ws2['C'+i].z='"£"#,##0.00'; });
    ws2['!cols']=[{wch:22},{wch:20},{wch:14}];
    var wb=X.utils.book_new(); X.utils.book_append_sheet(wb,ws,'Expenses'); X.utils.book_append_sheet(wb,ws2,'By staff member');
    X.writeFile(wb,xaDlName('Expenses','xlsx'));
  });
}
/* A plain .zip (stored, no compression: photos and PDFs are already compressed) */
var XA_CRC=null;
function xaCrc(u){ if(!XA_CRC){ XA_CRC=new Uint32Array(256); for(var n=0;n<256;n++){ var c=n; for(var k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; XA_CRC[n]=c>>>0; } }
  var crc=0xFFFFFFFF; for(var i=0;i<u.length;i++) crc=XA_CRC[(crc^u[i])&0xFF]^(crc>>>8); return (crc^0xFFFFFFFF)>>>0; }
function xaZipBlob(files){
  var parts=[], central=[], off=0, enc=new TextEncoder();
  function le(n,b){ var a=[]; for(var i=0;i<b;i++) a.push((n>>>(8*i))&0xFF); return a; }
  files.forEach(function(f){
    var name=enc.encode(f.name), crc=xaCrc(f.bytes), sz=f.bytes.length;
    var head=[].concat(le(0x04034b50,4),le(20,2),le(0x0800,2),le(0,2),le(0,2),le(0x21,2),le(crc,4),le(sz,4),le(sz,4),le(name.length,2),le(0,2));
    parts.push(new Uint8Array(head),name,f.bytes);
    central.push(new Uint8Array([].concat(le(0x02014b50,4),le(20,2),le(20,2),le(0x0800,2),le(0,2),le(0,2),le(0x21,2),le(crc,4),le(sz,4),le(sz,4),le(name.length,2),le(0,2),le(0,2),le(0,2),le(0,2),le(0,4),le(off,4))),name);
    off+=head.length+name.length+sz;
  });
  var csize=central.reduce(function(t,p){return t+p.length;},0);
  var end=new Uint8Array([].concat(le(0x06054b50,4),le(0,2),le(0,2),le(files.length,2),le(files.length,2),le(csize,4),le(off,4),le(0,2)));
  return new Blob(parts.concat(central,[end]),{type:'application/zip'});
}
function xaZip(){
  var jobs=[]; (XA.rows||[]).forEach(function(r){ (r.receipts||[]).forEach(function(f){ jobs.push({r:r,f:f}); }); });
  if(!jobs.length){ say('xaMsg','No receipt files yet.'); return; }
  var out=[], i=0;
  (function next(){
    if(i>=jobs.length){ xaSave(xaZipBlob(out),xaDlName('Receipts','zip')); say('xaMsg','Downloaded '+out.length+' receipt file'+(out.length>1?'s':'')+'.'); return; }
    say('xaMsg','Getting receipt '+(i+1)+' of '+jobs.length+'…');
    var j=jobs[i++];
    xaGet(j.r.id,j.f.n).then(function(x){ out.push({name:xaFileName(j.r,j.f),bytes:xaBytes(x.data)}); next(); })
      .catch(function(){ say('xaMsg','Stopped: could not download a receipt. Try again.',true); });
  })();
}
