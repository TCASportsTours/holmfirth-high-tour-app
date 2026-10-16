/* TCA Tours — tour expenses (TCA Tours staff only). v1
   Staff add a receipt photo/PDF, their name, the amount, the currency and the rate to pounds.
   The server stamps the date and time it was submitted. Everything downloads as an .xlsx
   spreadsheet plus a .zip of the receipts, named to match the spreadsheet's Ref column.
   Uses helpers from index.html: API, lsGet, lsSet, esc, jsArg, $, toast, openPage, rerenderPage, openModal, closeModal, T, NY, UK. */
'use strict';
var EXP = { rows: null, draft: null };
var EXP_CUR = [{c:'USD',s:'$',n:'US dollars'},{c:'GBP',s:'£',n:'Pounds'},{c:'EUR',s:'€',n:'Euros'},{c:'CAD',s:'C$',n:'Canadian dollars'}];
var EXP_CATS = ['Food & drink','Subway & transport','Taxi / Uber','Tickets & entry','Supplies','Tips','Phone & data','Other'];

function expKeyHdr(extra){ var h={'x-staff-key':lsGet('hny_staffkey')||''}; if(extra) for(var k in extra) h[k]=extra[k]; return h; }
function expStamp(ts,tz){ if(!ts) return '—'; return new Intl.DateTimeFormat('en-GB',{timeZone:tz,weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ts)); }
function expNYDate(ts){ var p=new Intl.DateTimeFormat('en-CA',{timeZone:NY,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts||Date.now())); return p; }
function expSym(c){ var x=EXP_CUR.filter(function(y){return y.c===c;})[0]; return x?x.s:c+' '; }
function expMoney(c,v){ return expSym(c)+Number(v||0).toFixed(2); }
function expGBP(v){ return '£'+Number(v||0).toFixed(2); }
function expStaffNames(){ var seen={}, out=[]; (T.staff||[]).forEach(function(s){ if(s.name&&!seen[s.name]){ seen[s.name]=1; out.push(s.name); } }); return out; }

/* ---------- list ---------- */
function openExpenses(){ EXP.rows=null; paintExpenses(false); loadExpenses(); }
function loadExpenses(){
  fetch(API+'?type=expenses',{headers:expKeyHdr(),cache:'no-store'}).then(function(r){return r.json();})
    .then(function(j){ EXP.rows=j; if($('expBox')) paintExpenses(true); })
    .catch(function(){ EXP.rows={ok:false,error:'Needs signal to load the expenses.'}; if($('expBox')) paintExpenses(true); });
}
function paintExpenses(keep){
  var j=EXP.rows, html='<p class="label">TCA Tours · tour expenses</p><h2>Expenses &amp; <em>receipts</em></h2>'+
    '<p class="small muted">Add each receipt as you go. The date and time it was submitted is recorded automatically. Download the spreadsheet and receipts at the end of the tour.</p>'+
    '<button class="btn gold" style="margin-bottom:14px" onclick="openExpenseForm()"><i class="ti ti-receipt"></i> Add an expense</button><div id="expBox">';
  if(!j) html+='<div class="card"><p class="small muted">Loading…</p></div>';
  else if(!j.ok) html+='<div class="card"><p class="small">'+esc(j.error||'Not allowed')+'</p></div>';
  else {
    var rows=j.rows||[], tot=0, by={};
    rows.forEach(function(r){ tot+=r.gbp; by[r.name]=(by[r.name]||0)+r.gbp; });
    html+='<div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile" style="min-height:0"><b class="num" style="font-size:28px">'+rows.length+'</b><span>expenses</span></div><div class="tile" style="min-height:0"><b class="num" style="font-size:28px">'+expGBP(tot)+'</b><span>total in pounds</span></div></div>';
    if(rows.length){
      html+='<p class="label">By staff member</p><table class="lb">'+Object.keys(by).sort().map(function(n){ return '<tr><td><b>'+esc(n)+'</b></td><td class="sc" style="text-align:right">'+expGBP(by[n])+'</td></tr>'; }).join('')+'</table>';
      html+='<div class="btnrow" style="margin:14px 0 4px"><button class="btn dark" onclick="expDownloadXlsx()"><i class="ti ti-table-down"></i> Spreadsheet</button><button class="btn line" onclick="expDownloadZip()"><i class="ti ti-file-zip"></i> Receipts</button></div>'+
        '<p class="small muted" style="margin-bottom:6px">Spreadsheet (.xlsx) for the tour accounts; Receipts downloads every photo and PDF in one .zip, each named by its Ref (e.g. EXP-001) to match the spreadsheet.</p>';
      html+=rows.slice().reverse().map(expCard).join('');
    } else html+='<div class="card"><p class="small">No expenses yet.</p></div>';
    html+='<p class="small muted" style="margin-top:10px"><button class="linkbtn" onclick="loadExpenses()">Refresh</button></p>';
  }
  html+='</div>';
  if(keep) rerenderPage(html); else openPage(html,openExpenses);
}
function expCard(r){
  return '<div class="card rule"><div class="cardhead"><h3 style="font-size:20px">'+esc(r.desc)+'</h3><span class="tag gold" style="margin:0">'+esc(r.ref)+'</span></div>'+
    '<dl class="kv"><dt>Staff</dt><dd><b>'+esc(r.name)+'</b></dd>'+
    '<dt>Amount</dt><dd><b>'+expMoney(r.currency,r.amount)+'</b>'+(r.currency!=='GBP'?' × '+r.rate+' = <b>'+expGBP(r.gbp)+'</b>':'')+'</dd>'+
    (r.currency!=='GBP'?'<dt>Rate</dt><dd>1 '+esc(r.currency)+' = £'+r.rate+'<div class="small muted">'+(r.rateEdited?'Typed in by staff':esc(r.rateSource||''))+(r.rateFetchedAt&&!r.rateEdited?' · fetched '+esc(expStamp(r.rateFetchedAt,NY))+' NY':'')+'</div></dd>':'')+
    '<dt>Spent</dt><dd>'+esc(r.spentOn||'—')+' · '+esc(r.category)+(r.paidBy?' · '+esc(r.paidBy):'')+'</dd>'+
    '<dt>Submitted</dt><dd><i class="ti ti-circle-check"></i> '+esc(expStamp(r.submittedAt,NY))+' NY<div class="small muted">'+esc(expStamp(r.submittedAt,UK))+' UK</div></dd>'+
    (r.notes?'<dt>Notes</dt><dd>'+esc(r.notes)+'</dd>':'')+
    '<dt>Receipts</dt><dd>'+((r.receipts||[]).length?(r.receipts||[]).map(function(f){ return '<button class="linkbtn" style="margin-right:10px" onclick="expDownloadOne('+jsArg(r.id)+','+f.n+')"><i class="ti ti-download"></i> '+esc(expFileName(r,f))+'</button>'; }).join(''):'<span class="tag alarm" style="margin:0">No receipt</span>')+'</dd></dl>'+
    '<p style="margin-top:8px"><button class="linkbtn" onclick="expDelete('+jsArg(r.id)+','+jsArg(r.ref)+')">Delete</button></p></div>';
}
function expDelete(id,ref){
  if(!confirm('Delete '+ref+' and its receipts? This can\'t be undone.')) return;
  fetch(API+'?type=expensedel',{method:'POST',headers:expKeyHdr({'content-type':'application/json'}),body:JSON.stringify({id:id})})
    .then(function(r){ if(r.ok){ toast(ref+' deleted'); loadExpenses(); } else toast('Could not delete ('+r.status+')'); }).catch(function(){ toast('Needs signal'); });
}

/* ---------- form ---------- */
function openExpenseForm(){
  var d=EXP.draft=EXP.draft||{name:lsGet('hny_expname')||'',currency:'USD',category:'Food & drink',paidBy:'Card',spentOn:expNYDate(),files:[],rate:'',rateInfo:null,rateEdited:false};
  var names=expStaffNames();
  var html='<p class="label">TCA Tours · tour expenses</p><h2>Add an <em>expense</em></h2>'+
    '<label class="label" for="exName">Staff member\'s name *</label><input class="field" id="exName" list="exNames" autocomplete="name" placeholder="e.g. Tony Curtis" value="'+esc(d.name)+'" oninput="EXP.draft.name=this.value">'+
    '<datalist id="exNames">'+names.map(function(n){return '<option value="'+esc(n)+'">';}).join('')+'</datalist>'+
    '<label class="label" for="exDesc" style="margin-top:14px">What was it for? *</label><input class="field" id="exDesc" placeholder="e.g. Subway top-up, water for the group" value="'+esc(d.desc||'')+'" oninput="EXP.draft.desc=this.value">'+
    '<div class="btnrow" style="margin-top:14px"><div style="flex:1"><label class="label" for="exCat">Type</label><select class="field" id="exCat" onchange="EXP.draft.category=this.value">'+EXP_CATS.map(function(c){return '<option'+(c===d.category?' selected':'')+'>'+esc(c)+'</option>';}).join('')+'</select></div>'+
    '<div style="flex:1"><label class="label" for="exPaid">Paid by</label><select class="field" id="exPaid" onchange="EXP.draft.paidBy=this.value">'+['Card','Cash','Other'].map(function(c){return '<option'+(c===d.paidBy?' selected':'')+'>'+c+'</option>';}).join('')+'</select></div></div>'+
    '<label class="label" for="exDate" style="margin-top:14px">Date of the expense</label><input class="field" id="exDate" type="date" value="'+esc(d.spentOn)+'" onchange="EXP.draft.spentOn=this.value">'+
    '<label class="label" style="margin-top:14px">Currency *</label><div class="seg">'+EXP_CUR.map(function(c){ return '<button class="'+(c.c===d.currency?'on':'')+'" onclick="expSetCur('+jsArg(c.c)+')">'+esc(c.s+' '+c.c)+'</button>'; }).join('')+'</div>'+
    '<label class="label" for="exAmt">Amount in '+esc(d.currency)+' *</label><input class="field" id="exAmt" inputmode="decimal" placeholder="0.00" value="'+esc(d.amount||'')+'" oninput="EXP.draft.amount=this.value;expCalc()">'+
    '<div id="exRateBox"></div>'+
    '<label class="label" style="margin-top:14px">Receipt photo or PDF</label><div id="exFiles"></div>'+
    '<label class="btn line" style="display:flex;justify-content:center;align-items:center;gap:8px;cursor:pointer"><i class="ti ti-camera"></i> Take photo / choose file<input type="file" id="exFile" accept="image/*,application/pdf" multiple style="display:none" onchange="expAddFiles(this)"></label>'+
    '<label class="label" for="exNotes" style="margin-top:14px">Notes (optional)</label><input class="field" id="exNotes" placeholder="e.g. no receipt given, tip included" value="'+esc(d.notes||'')+'" oninput="EXP.draft.notes=this.value">'+
    '<div class="err" id="exErr"></div>'+
    '<button class="btn gold" id="exSend" style="margin-top:16px" onclick="expSubmit()"><i class="ti ti-send"></i> Submit expense</button>'+
    '<p class="small muted">The date and time you press Submit is recorded by the server, with the rate used.</p>';
  openPage(html);
  expPaintRate(); expPaintFiles();
  if(d.currency!=='GBP' && !d.rateEdited && (!d.rateInfo || Date.now()-d.rateInfo.fetchedAt>10*60000)) expFetchRate();
}
function expSetCur(c){ var d=EXP.draft; d.currency=c; d.rate=''; d.rateInfo=null; d.rateEdited=false; openExpenseFormKeep(); if(c!=='GBP') expFetchRate(); }
function openExpenseFormKeep(){ pageStack.pop(); var top=$('screens').scrollTop; openExpenseForm(); $('screens').scrollTop=top; }
function expFetchRate(){
  var d=EXP.draft, cur=d.currency; if(cur==='GBP') return;
  d.rateLoading=true; expPaintRate();
  fetch(API+'?type=fxrate&cur='+cur,{headers:expKeyHdr(),cache:'no-store'}).then(function(r){return r.json();}).then(function(j){
    d.rateLoading=false; if(d.currency!==cur) return;
    if(j&&j.ok){ d.rateInfo=j; if(!d.rateEdited) d.rate=String(Math.round(j.rate*1e6)/1e6); }
    else d.rateErr=(j&&j.error)||'No live rate';
    expPaintRate();
  }).catch(function(){ d.rateLoading=false; d.rateErr='No signal for a live rate. Type the rate from your bank or card app.'; expPaintRate(); });
}
function expPaintRate(){
  var d=EXP.draft, box=$('exRateBox'); if(!box) return;
  if(d.currency==='GBP'){ box.innerHTML='<p class="small muted" style="margin-top:8px">Paid in pounds, so no conversion.</p>'; return; }
  var i=d.rateInfo;
  box.innerHTML='<label class="label" for="exRate" style="margin-top:14px">Conversion rate to pounds *</label>'+
    '<div style="display:flex;align-items:center;gap:8px"><span style="white-space:nowrap">1 '+esc(d.currency)+' = £</span><input class="field" id="exRate" inputmode="decimal" value="'+esc(d.rate)+'" placeholder="'+(d.rateLoading?'getting live rate…':'0.000000')+'" oninput="EXP.draft.rate=this.value;EXP.draft.rateEdited=true;expCalc(true)"></div>'+
    '<p class="small muted" id="exRateNote" style="margin-top:6px">'+expRateNote()+'</p>'+
    '<p class="small" style="margin-top:4px"><button class="linkbtn" onclick="EXP.draft.rateEdited=false;expFetchRate()"><i class="ti ti-refresh"></i> Use the live rate now</button></p>'+
    '<div class="card" style="margin-top:8px"><p class="small">In pounds: <b class="num" id="exGbp" style="font-size:22px">—</b></p><p class="small muted" id="exSum"></p></div>';
  expCalc();
}
function expRateNote(){
  var d=EXP.draft, i=d.rateInfo;
  if(d.rateLoading) return 'Getting the live rate…';
  if(d.rateEdited) return 'Your own rate. Use the exact rate from your bank or card app if you have it.';
  if(i) return 'Live rate at '+esc(expStamp(i.fetchedAt,NY))+' NY from '+esc(i.source)+(i.stale?' (last known; no fresh rate available)':'')+'. If your bank or card app shows a different rate, type the exact rate in.';
  return esc(d.rateErr||'Type the rate from your bank or card app.');
}
function expCalc(fromRate){
  var d=EXP.draft, a=parseFloat(String(d.amount||'').replace(/[^\d.]/g,'')), r=d.currency==='GBP'?1:parseFloat(d.rate);
  if(fromRate && $('exRateNote')) $('exRateNote').innerHTML=expRateNote();
  if(!$('exGbp')) return;
  if(a>0&&r>0){ $('exGbp').textContent=expGBP(Math.round(a*r*100)/100); $('exSum').textContent=expMoney(d.currency,a)+' × '+r+' = '+expGBP(Math.round(a*r*100)/100); }
  else { $('exGbp').textContent='—'; $('exSum').textContent='Enter the amount and rate.'; }
}
function expPaintFiles(){
  var d=EXP.draft, box=$('exFiles'); if(!box) return;
  box.innerHTML=d.files.length?d.files.map(function(f,i){
    if(!f.data) return '<div class="card" style="padding:10px"><p class="small muted">Reading '+esc(f.name)+'…</p></div>';
    return '<div class="card" style="display:flex;gap:10px;align-items:center;padding:10px">'+(/^data:image/.test(f.data)?'<img src="'+f.data+'" alt="" style="width:56px;height:56px;object-fit:cover;border:1px solid var(--hairline)">':'<i class="ti ti-file-type-pdf" style="font-size:36px"></i>')+
      '<span class="small" style="flex:1;overflow-wrap:anywhere">'+esc(f.name)+'<br><span class="muted">'+Math.round(f.data.length*0.75/1024)+' KB</span></span><button class="linkbtn" onclick="EXP.draft.files.splice('+i+',1);expPaintFiles()">Remove</button></div>'; }).join(''):
    '<p class="small muted">No receipt added yet.</p>';
}
function expAddFiles(input){
  var list=Array.prototype.slice.call(input.files||[]); input.value='';
  list.forEach(function(file){
    if(EXP.draft.files.length>=6){ toast('Up to 6 files per expense'); return; }
    /* keep the files in the order chosen, whichever finishes reading first */
    var slot={name:file.name,data:''}, add=function(){ EXP.draft.files.push(slot); }, done=function(){ expPaintFiles(); }, drop=function(){ var i=EXP.draft.files.indexOf(slot); if(i>=0) EXP.draft.files.splice(i,1); done(); };
    if(/^image\//.test(file.type)||/\.(heic|heif)$/i.test(file.name)){ add(); expShrink(file,function(data){ slot.name=file.name.replace(/\.(heic|heif|png|webp)$/i,'.jpg'); slot.data=data; done(); },drop); }
    else if(file.type==='application/pdf'){
      if(file.size>3.5*1024*1024){ toast('That PDF is too big (max 3.5 MB). Take a photo instead.'); return; }
      add(); var fr=new FileReader(); fr.onload=function(){ slot.data=fr.result; done(); }; fr.onerror=drop; fr.readAsDataURL(file);
    } else toast('Use a photo or a PDF');
  });
}
/* Shrink photos on the phone (max 1800px, JPEG) so they upload quickly on hostel wifi */
function expShrink(file,cb,fail){
  var url=URL.createObjectURL(file), img=new Image();
  img.onload=function(){
    var max=1800, w=img.naturalWidth, h=img.naturalHeight, s=Math.min(1,max/Math.max(w,h));
    var c=document.createElement('canvas'); c.width=Math.round(w*s); c.height=Math.round(h*s);
    var g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height);
    URL.revokeObjectURL(url); cb(c.toDataURL('image/jpeg',0.82));
  };
  img.onerror=function(){ URL.revokeObjectURL(url); toast('Couldn\'t read that photo. Try a screenshot of it instead.'); if(fail) fail(); };
  img.src=url;
}
function expSubmit(){
  var d=EXP.draft, err=$('exErr'); err.classList.remove('on');
  var amount=parseFloat(String(d.amount||'').replace(/[^\d.]/g,'')), rate=d.currency==='GBP'?1:parseFloat(d.rate);
  var bad=!String(d.name||'').trim()?'Put the staff member\'s name.':!String(d.desc||'').trim()?'Say what it was for.':!(amount>0)?'Enter the amount.':!(rate>0)?'Enter the conversion rate to pounds.':'';
  if(bad){ err.textContent=bad; err.classList.add('on'); return; }
  if(d.files.some(function(f){return !f.data;})){ err.textContent='Still reading the receipt. Try again in a second.'; err.classList.add('on'); return; }
  if(!d.files.length && !confirm('No receipt added. Submit without one?')) return;
  var body={name:d.name.trim(),desc:d.desc.trim(),category:d.category,paidBy:d.paidBy,spentOn:d.spentOn,currency:d.currency,amount:amount,rate:rate,notes:d.notes||'',
    rateEdited:!!d.rateEdited,rateSource:d.rateEdited?'Typed in by staff':(d.rateInfo&&d.rateInfo.source)||'',rateAsOf:d.rateInfo&&d.rateInfo.asOf,rateFetchedAt:d.rateEdited?null:(d.rateInfo&&d.rateInfo.fetchedAt),receipts:d.files};
  var json=JSON.stringify(body);
  if(json.length>5.4*1024*1024){ err.textContent='The receipts are too big to send together. Remove one and send it as a second expense.'; err.classList.add('on'); return; }
  var btn=$('exSend'); btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> Sending…';
  fetch(API+'?type=expense',{method:'POST',headers:expKeyHdr({'content-type':'application/json'}),body:json}).then(function(r){ return r.json().then(function(j){ return {r:r,j:j}; }); }).then(function(x){
    btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Submit expense';
    if(!x.r.ok||!x.j.ok){ err.textContent=(x.j&&x.j.error)||('Not sent ('+x.r.status+')'); err.classList.add('on'); return; }
    var e=x.j.expense; lsSet('hny_expname',e.name); EXP.draft=null;
    openModal('<p class="label">Submitted</p><h2 style="font-size:28px"><i class="ti ti-circle-check"></i> '+esc(e.ref)+'</h2>'+
      '<dl class="kv"><dt>Staff</dt><dd>'+esc(e.name)+'</dd><dt>For</dt><dd>'+esc(e.desc)+'</dd><dt>Amount</dt><dd>'+expMoney(e.currency,e.amount)+(e.currency!=='GBP'?' × '+e.rate+' = <b>'+expGBP(e.gbp)+'</b>':'')+'</dd>'+
      '<dt>Submitted</dt><dd>'+esc(expStamp(e.submittedAt,NY))+' NY<br><span class="small muted">'+esc(expStamp(e.submittedAt,UK))+' UK</span></dd><dt>Receipts</dt><dd>'+(e.receipts.length||'None')+'</dd></dl>'+
      '<button class="btn gold" style="margin-top:14px" onclick="closeModal();pageStack.pop();openExpenseForm()">Add another</button><button class="btn ghost" onclick="closeModal();pageStack.pop();pageStack.pop();openExpenses()">See all expenses</button>');
  }).catch(function(){ btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Submit expense'; err.textContent='No signal, so it wasn\'t sent. Your details are kept here: try again when you have signal.'; err.classList.add('on'); });
}

/* ---------- downloads ---------- */
function expSafe(s){ return String(s||'').replace(/[^\w]+/g,'-').replace(/^-|-$/g,'').slice(0,30); }
function expFileName(r,f){ var ext=f.type==='application/pdf'?'pdf':f.type==='image/png'?'png':'jpg'; return r.ref+'_'+expSafe(r.name)+(r.receipts.length>1?'_'+(f.n+1):'')+'.'+ext; }
function expGetReceipt(id,n){ return fetch(API+'?type=receipt&id='+encodeURIComponent(id)+'&n='+n,{headers:expKeyHdr(),cache:'no-store'}).then(function(r){ if(!r.ok) throw new Error(r.status); return r.json(); }); }
function expDataToBytes(data){ var b=atob(data.slice(data.indexOf(',')+1)), u=new Uint8Array(b.length); for(var i=0;i<b.length;i++) u[i]=b.charCodeAt(i); return u; }
function expSave(blob,name){ var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },4000); }
function expDownloadOne(id,n){
  var r=(EXP.rows.rows||[]).filter(function(x){return x.id===id;})[0], f=r&&r.receipts[n]; if(!f) return;
  toast('Downloading…');
  expGetReceipt(id,n).then(function(j){ expSave(new Blob([expDataToBytes(j.data)],{type:j.type}),expFileName(r,f)); }).catch(function(){ toast('Needs signal to download'); });
}
function expDlName(ext){ var v=(parseInt(lsGet('hny_expdl_'+ext),10)||0)+1; lsSet('hny_expdl_'+ext,String(v)); return 'Holmfirth_NYC_Expenses_v'+v+'_'+expNYDate()+'.'+ext; }
function expLoadXLSX(cb){
  if(window.XLSX) return cb();
  var s=document.createElement('script'); s.src='vendor/xlsx-0.18.5.full.min.js'; s.onload=cb; s.onerror=function(){ toast('Couldn\'t load the spreadsheet maker. Needs signal.'); }; document.head.appendChild(s);
}
function expDownloadXlsx(){
  var rows=(EXP.rows&&EXP.rows.rows)||[]; if(!rows.length) return;
  expLoadXLSX(function(){
    var X=window.XLSX, head=['Ref','Submitted (New York)','Submitted (UK)','Staff member','Date of expense','What for','Type','Paid by','Currency','Amount','Rate (1 unit = £)','Amount in £','How £ was worked out','Rate source','Rate time (New York)','Receipt files','Notes'];
    var aoa=[head];
    rows.forEach(function(r){ aoa.push([r.ref,expStamp(r.submittedAt,NY),expStamp(r.submittedAt,UK),r.name,r.spentOn,r.desc,r.category,r.paidBy,r.currency,r.amount,r.rate,r.gbp,
      expMoney(r.currency,r.amount)+' × '+r.rate+' = '+expGBP(r.gbp),r.rateEdited?'Typed in by staff':r.rateSource,r.rateFetchedAt&&!r.rateEdited?expStamp(r.rateFetchedAt,NY):'',
      (r.receipts||[]).map(function(f){return expFileName(r,f);}).join(', ')||'NO RECEIPT',r.notes||'']); });
    var last=rows.length+1;
    aoa.push(['','','','','','','','','','','Total £',0]);
    var ws=X.utils.aoa_to_sheet(aoa);
    for(var i=2;i<=last;i++){ ws['L'+i]={t:'n',v:rows[i-2].gbp,f:'ROUND(J'+i+'*K'+i+',2)',z:'"£"#,##0.00'}; ws['J'+i].z='#,##0.00'; ws['K'+i].z='0.000000'; }
    ws['L'+(last+1)]={t:'n',v:Math.round(rows.reduce(function(t,r){return t+r.gbp;},0)*100)/100,f:'SUM(L2:L'+last+')',z:'"£"#,##0.00'};
    ws['!cols']=[8,22,22,18,12,30,16,8,8,10,12,12,30,30,22,34,30].map(function(w){return {wch:w};});
    ws['!autofilter']={ref:'A1:Q'+last};
    var names=[]; rows.forEach(function(r){ if(names.indexOf(r.name)<0) names.push(r.name); }); names.sort();
    var by=[['Staff member','Number of expenses','Total £']];
    names.forEach(function(n){ var mine=rows.filter(function(r){return r.name===n;}); by.push([n,mine.length,Math.round(mine.reduce(function(t,r){return t+r.gbp;},0)*100)/100]); });
    var ws2=X.utils.aoa_to_sheet(by);
    names.forEach(function(n,k){ var i=k+2; ws2['B'+i].f='COUNTIF(Expenses!D:D,A'+i+')'; ws2['C'+i].f='SUMIF(Expenses!D:D,A'+i+',Expenses!L:L)'; ws2['C'+i].z='"£"#,##0.00'; });
    ws2['!cols']=[{wch:22},{wch:20},{wch:14}];
    var wb=X.utils.book_new(); X.utils.book_append_sheet(wb,ws,'Expenses'); X.utils.book_append_sheet(wb,ws2,'By staff member');
    X.writeFile(wb,expDlName('xlsx'));
  });
}
/* A plain .zip (stored, no compression: photos and PDFs are already compressed) */
var EXP_CRC=null;
function expCrc(u){ if(!EXP_CRC){ EXP_CRC=new Uint32Array(256); for(var n=0;n<256;n++){ var c=n; for(var k=0;k<8;k++) c=c&1?0xEDB88320^(c>>>1):c>>>1; EXP_CRC[n]=c>>>0; } }
  var crc=0xFFFFFFFF; for(var i=0;i<u.length;i++) crc=EXP_CRC[(crc^u[i])&0xFF]^(crc>>>8); return (crc^0xFFFFFFFF)>>>0; }
function expZip(files){
  var parts=[], central=[], off=0, enc=new TextEncoder();
  function le(n,b){ var a=[]; for(var i=0;i<b;i++) a.push((n>>>(8*i))&0xFF); return a; }
  files.forEach(function(f){
    var name=enc.encode(f.name), crc=expCrc(f.bytes), sz=f.bytes.length;
    var head=[].concat(le(0x04034b50,4),le(20,2),le(0x0800,2),le(0,2),le(0,2),le(0x21,2),le(crc,4),le(sz,4),le(sz,4),le(name.length,2),le(0,2));
    parts.push(new Uint8Array(head),name,f.bytes);
    central.push(new Uint8Array([].concat(le(0x02014b50,4),le(20,2),le(20,2),le(0x0800,2),le(0,2),le(0,2),le(0x21,2),le(crc,4),le(sz,4),le(sz,4),le(name.length,2),le(0,2),le(0,2),le(0,2),le(0,2),le(0,4),le(off,4))),name);
    off+=head.length+name.length+sz;
  });
  var csize=central.reduce(function(t,p){return t+p.length;},0);
  var end=new Uint8Array([].concat(le(0x06054b50,4),le(0,2),le(0,2),le(files.length,2),le(files.length,2),le(csize,4),le(off,4),le(0,2)));
  return new Blob(parts.concat(central,[end]),{type:'application/zip'});
}
function expDownloadZip(){
  var rows=(EXP.rows&&EXP.rows.rows)||[], jobs=[];
  rows.forEach(function(r){ (r.receipts||[]).forEach(function(f){ jobs.push({r:r,f:f}); }); });
  if(!jobs.length){ toast('No receipt files yet'); return; }
  toast('Getting '+jobs.length+' receipt'+(jobs.length>1?'s':'')+'…');
  var out=[], i=0;
  (function next(){
    if(i>=jobs.length){ expSave(expZip(out),expDlName('zip').replace('Expenses','Receipts')); return; }
    var j=jobs[i++];
    expGetReceipt(j.r.id,j.f.n).then(function(x){ out.push({name:expFileName(j.r,j.f),bytes:expDataToBytes(x.data)}); next(); })
      .catch(function(){ toast('Lost signal while downloading. Try again.'); });
  })();
}
