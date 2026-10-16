/* TCA Tours — tour expenses: the SUBMIT form for TCA Tours staff on tour. v2
   Staff add a receipt photo/PDF, their name, the amount, the currency (search by country) and the rate to pounds.
   The server stamps the date and time it was submitted. Staff can't see the list of expenses:
   that, and the spreadsheet / receipts downloads, are in admin.html behind the expenses password (js/expenses-admin.js).
   Uses helpers from index.html: API, lsGet, lsSet, esc, jsArg, $, toast, openPage, rerenderPage, openModal, closeModal, T, NY, UK. */
'use strict';
var EXP = { draft: null };
var EXP_CATS = ['Food & drink','Subway & transport','Taxi / Uber','Tickets & entry','Supplies','Tips','Phone & data','Other'];

function expKeyHdr(extra){ var h={'x-staff-key':lsGet('hny_staffkey')||''}; if(extra) for(var k in extra) h[k]=extra[k]; return h; }
function expStamp(ts,tz){ if(!ts) return '—'; return new Intl.DateTimeFormat('en-GB',{timeZone:tz,weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(ts)); }
function expNYDate(ts){ var p=new Intl.DateTimeFormat('en-CA',{timeZone:NY,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ts||Date.now())); return p; }
function expMoney(c,v){ try{ return new Intl.NumberFormat('en-GB',{style:'currency',currency:c,currencyDisplay:'narrowSymbol'}).format(Number(v||0)); }catch(e){ return c+' '+Number(v||0).toFixed(2); } }
function expCountries(){ return window.EXP_COUNTRIES||[['United States','USD'],['United Kingdom','GBP']]; }
function expGBP(v){ return '£'+Number(v||0).toFixed(2); }
function expStaffNames(){ var seen={}, out=[]; (T.staff||[]).forEach(function(s){ if(s.name&&!seen[s.name]){ seen[s.name]=1; out.push(s.name); } }); return out; }

/* ---------- form ---------- */
function openExpenseForm(){
  var d=EXP.draft=EXP.draft||{name:lsGet('hny_expname')||'',currency:'USD',country:'United States',category:'Food & drink',paidBy:'Card',spentOn:expNYDate(),files:[],rate:'',rateInfo:null,rateEdited:false};
  var names=expStaffNames();
  var html='<p class="label">TCA Tours · tour expenses</p><h2>Add an <em>expense</em></h2>'+
    '<label class="label" for="exName">Staff member\'s name *</label><input class="field" id="exName" list="exNames" autocomplete="name" placeholder="e.g. Tony Curtis" value="'+esc(d.name)+'" oninput="EXP.draft.name=this.value">'+
    '<datalist id="exNames">'+names.map(function(n){return '<option value="'+esc(n)+'">';}).join('')+'</datalist>'+
    '<label class="label" for="exDesc" style="margin-top:14px">What was it for? *</label><input class="field" id="exDesc" placeholder="e.g. Subway top-up, water for the group" value="'+esc(d.desc||'')+'" oninput="EXP.draft.desc=this.value">'+
    '<div class="btnrow" style="margin-top:14px"><div style="flex:1"><label class="label" for="exCat">Type</label><select class="field" id="exCat" onchange="EXP.draft.category=this.value">'+EXP_CATS.map(function(c){return '<option'+(c===d.category?' selected':'')+'>'+esc(c)+'</option>';}).join('')+'</select></div>'+
    '<div style="flex:1"><label class="label" for="exPaid">Paid by</label><select class="field" id="exPaid" onchange="EXP.draft.paidBy=this.value">'+['Card','Cash','Other'].map(function(c){return '<option'+(c===d.paidBy?' selected':'')+'>'+c+'</option>';}).join('')+'</select></div></div>'+
    '<label class="label" for="exDate" style="margin-top:14px">Date of the expense</label><input class="field" id="exDate" type="date" value="'+esc(d.spentOn)+'" onchange="EXP.draft.spentOn=this.value">'+
    '<label class="label" for="exCurQ" style="margin-top:14px">Country &amp; currency *</label>'+
    '<div class="combo"><button class="field combo-cur" id="exCurBtn" onclick="expCurOpen()" aria-haspopup="listbox"><span>'+esc(d.country+' ('+d.currency+')')+'</span><i class="ti ti-selector"></i></button>'+
    '<div class="combo-pop" id="exCurPop" hidden><input class="field" id="exCurQ" placeholder="Search a country or currency, e.g. Spain or EUR" autocomplete="off" oninput="expCurList()" onkeydown="if(event.key===\'Enter\'){var b=document.querySelector(\'#exCurOpts button\');if(b)b.click();}"><div id="exCurOpts" role="listbox"></div></div></div>'+
    '<label class="label" for="exAmt" style="margin-top:14px">Amount in '+esc(d.currency)+' *</label><input class="field" id="exAmt" inputmode="decimal" placeholder="0.00" value="'+esc(d.amount||'')+'" oninput="EXP.draft.amount=this.value;expCalc()">'+
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
function expCurOpen(){ var p=$('exCurPop'); p.hidden=!p.hidden; if(!p.hidden){ $('exCurQ').value=''; expCurList(); $('exCurQ').focus(); } }
function expCurList(){
  var q=$('exCurQ').value.trim().toLowerCase(), all=expCountries();
  var hits=q?all.filter(function(x){ return x[0].toLowerCase().indexOf(q)>=0||x[1].toLowerCase().indexOf(q)===0; }):all;
  if(q) hits=hits.slice().sort(function(a,b){ return (a[0].toLowerCase().indexOf(q)===0?0:1)-(b[0].toLowerCase().indexOf(q)===0?0:1); });
  $('exCurOpts').innerHTML=hits.length?hits.slice(0,q?40:400).map(function(x){ return '<button role="option" onclick="expSetCur('+jsArg(x[1])+','+jsArg(x[0])+')">'+esc(x[0])+' <b>('+esc(x[1])+')</b></button>'; }).join(''):'<p class="small muted" style="padding:10px">No country matches “'+esc(q)+'”.</p>';
}
function expSetCur(c,country){ var d=EXP.draft; d.country=country||d.country; d.currency=c; d.rate=''; d.rateInfo=null; d.rateEdited=false; openExpenseFormKeep(); if(c!=='GBP') expFetchRate(); }
function openExpenseFormKeep(){ pageStack.pop(); var top=$('screens').scrollTop; openExpenseForm(); $('screens').scrollTop=top; }
function expFetchRate(){
  var d=EXP.draft, cur=d.currency; if(cur==='GBP') return;
  d.rateLoading=true; expPaintRate();
  fetch(API+'?type=fxrate&cur='+cur,{headers:expKeyHdr(),cache:'no-store'}).then(function(r){return r.json();}).then(function(j){
    d.rateLoading=false; if(d.currency!==cur) return;
    if(j&&j.ok){ d.rateInfo=j; if(!d.rateEdited) d.rate=String(Number(j.rate.toPrecision(6))); }
    else d.rateErr=(j&&j.error)||'No live rate';
    expPaintRate();
  }).catch(function(){ d.rateLoading=false; d.rateErr='No signal for a live rate. Type the rate from your bank or card app.'; expPaintRate(); });
}
function expPaintRate(){
  var d=EXP.draft, box=$('exRateBox'); if(!box) return;
  if(d.currency==='GBP'){ box.innerHTML='<p class="small muted" style="margin-top:8px">Paid in pounds, so no conversion.</p>'; return; }
  var i=d.rateInfo;
  box.innerHTML='<label class="label" for="exRate" style="margin-top:14px">Conversion rate to pounds *</label>'+
    '<div style="display:flex;align-items:center;gap:8px"><span style="white-space:nowrap">1 '+esc(d.currency)+' = £</span><input class="field" id="exRate" inputmode="decimal" value="'+esc(d.rate)+'" placeholder="'+(d.rateLoading?'getting live rate…':'e.g. 0.75')+'" oninput="EXP.draft.rate=this.value;EXP.draft.rateEdited=true;expCalc(true)"></div>'+
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
  var body={name:d.name.trim(),desc:d.desc.trim(),category:d.category,paidBy:d.paidBy,spentOn:d.spentOn,currency:d.currency,country:d.country,amount:amount,rate:rate,notes:d.notes||'',
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
      '<p class="small muted" style="margin-top:10px">Sent to TCA Tours. Keep the paper receipt too, in case it\'s needed.</p>'+
      '<button class="btn gold" style="margin-top:14px" onclick="closeModal();pageStack.pop();openExpenseForm()">Add another</button><button class="btn ghost" onclick="closeModal();pageBack()">Done</button>');
  }).catch(function(){ btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Submit expense'; err.textContent='No signal, so it wasn\'t sent. Your details are kept here: try again when you have signal.'; err.classList.add('on'); });
}

