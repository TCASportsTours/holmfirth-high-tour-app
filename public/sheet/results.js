/* TCA Tours — Feedback results page (/sheet), v2.
   Every teacher and student questionnaire (plus the Google Form history) behind its own password, with
   Download as Excel. No Google account or spreadsheet needed. The password is kept for this browser tab only. */
(function(){
'use strict';
var API='/.netlify/functions/tour', KEY='tca_sheet_key';
var D=null, VIEW='Website reviews', TOUR='', FIND='', IMG={};
var TABS=['Website reviews','Teachers','Students','Trip ratings','Photos'];

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function key(v){ try{ if(v===undefined) return sessionStorage.getItem(KEY)||''; if(v===null) sessionStorage.removeItem(KEY); else sessionStorage.setItem(KEY,v); }catch(e){ return ''; } }

/* ---------- password ---------- */
function gate(msg){
  $('main').innerHTML='<div class="card gate"><div class="head"><i class="ti ti-lock"></i><h3>Feedback <em>results</em></h3></div>'+
    '<p class="hint" style="font-size:13.5px">Every tour’s teacher and student questionnaires, in one place.</p>'+
    '<input class="field" id="pw" type="password" placeholder="Password" autocomplete="current-password">'+
    '<p class="err'+(msg?' on':'')+'" id="perr">'+esc(msg||'')+'</p>'+
    '<button class="btn gold" id="go" style="margin-top:12px"><i class="ti ti-lock-open"></i> Open</button></div>';
  $('go').onclick=function(){ key($('pw').value); load(); };
  $('pw').onkeydown=function(e){ if(e.key==='Enter') $('go').click(); };
  $('pw').focus();
}
function load(){
  if(!key()) return gate();
  $('main').innerHTML='<p class="intro">Loading the results…</p>';
  fetch(API+'?type=sheetdata',{headers:{'x-sheet-key':key()},cache:'no-store'}).then(function(r){ return r.json().then(function(j){ return {r:r,j:j}; }); }).then(function(x){
    if(x.r.status===401){ key(null); return gate('That password isn’t right.'); }
    if(x.r.status===429){ key(null); return gate('Too many wrong tries. Wait 15 minutes.'); }
    if(!x.j.ok){ return gate(x.j.error||('Could not load ('+x.r.status+').')); }
    D=x.j; paint();
  }).catch(function(){ $('main').innerHTML='<p class="err on">No connection. Try again when you have signal.</p>'; });
}

/* ---------- helpers ---------- */
function rows(tab){ var r=(D.tabs&&D.tabs[tab])||[], f=FIND.toLowerCase();
  return r.filter(function(x){ if(String(x['Test?']||'')==='Yes') return false; if(TOUR&&x['Tour']!==TOUR) return false;
    if(f && Object.keys(x).map(function(k){return x[k];}).join(' ').toLowerCase().indexOf(f)<0) return false; return true; }); }
function tours(){ var s={}; TABS.forEach(function(t){ ((D.tabs&&D.tabs[t])||[]).forEach(function(x){ if(x['Tour']) s[x['Tour']]=1; }); }); return Object.keys(s).sort(); }
function num(v){ var n=parseFloat(v); return isNaN(n)?null:n; }
function avg(list){ var n=list.map(num).filter(function(v){return v!==null;}); if(!n.length) return null; var t=n.reduce(function(a,b){return a+b;},0);
  return {avg:Math.round(t/n.length*10)/10, n:n.length, work:'('+n.join(' + ')+') ÷ '+n.length+' = '+(Math.round(t/n.length*100)/100)}; }
function copy(t){ try{ navigator.clipboard.writeText(t).then(function(){ flash('Copied'); },function(){ prompt('Copy this:',t); }); }catch(e){ prompt('Copy this:',t); } }
function flash(m){ var b=$('flash'); if(!b) return; b.textContent=m; setTimeout(function(){ b.textContent=''; },2000); }
var OVERALL_T='Overall, how satisfied were you with your TCA tour experience? (1 = Very Dissatisfied - 5 = Extremely satisfied)';

/* ---------- page ---------- */
function paint(){
  var T=rows('Teachers'), S=rows('Students'), tA=avg(T.map(function(r){return r[OVERALL_T];})), sA=avg(S.map(function(r){return r['Overall rating (1–5)'];}));
  var h='<p class="label">TCA Tours · every tour</p><h1>Feedback <em>results</em></h1>';
  h+='<div class="stat"><div><b>'+T.length+'</b><span>teacher responses</span></div><div><b>'+S.length+'</b><span>student responses</span></div>'+
    '<div><b>'+(tA?tA.avg:'—')+'</b><span>teachers’ overall (1–5)'+(tA?'<br>'+esc(tA.work):'')+'</span></div>'+
    '<div><b>'+(sA?sA.avg:'—')+'</b><span>students’ overall (1–5)'+(sA?'<br>'+esc(sA.work):'')+'</span></div></div>';
  h+='<div class="row" style="margin-top:14px"><select class="field" id="tour" style="max-width:340px"><option value="">All tours</option>'+tours().map(function(t){ return '<option'+(t===TOUR?' selected':'')+'>'+esc(t)+'</option>'; }).join('')+'</select>'+
    '<input class="field" id="find" placeholder="Search names, comments…" value="'+esc(FIND)+'"></div>';
  h+='<div class="tabsbar">'+TABS.map(function(t){ return '<button class="'+(t===VIEW?'on':'')+'" data-tab="'+esc(t)+'">'+esc(t)+'<b>'+rows(t).length+'</b></button>'; }).join('')+'</div>';
  h+='<div class="row" style="margin:6px 0 4px"><button class="lnk" id="xl"><i class="ti ti-table-down"></i> Download as Excel</button><span class="meta">(the tour and search shown)</span>'+
    '<button class="lnk" id="out"><i class="ti ti-logout"></i> Lock</button><span class="meta" id="flash"></span></div>';
  h+='<div id="view">'+view()+'</div>';
  $('main').innerHTML=h;
  $('tour').onchange=function(){ TOUR=this.value; paint(); };
  $('find').oninput=function(){ FIND=this.value; var p=this.selectionStart; $('view').innerHTML=view(); [].forEach.call(document.querySelectorAll('.tabsbar button'),function(b){ b.querySelector('b').textContent=rows(b.getAttribute('data-tab')).length; }); thumbs(); };
  [].forEach.call(document.querySelectorAll('.tabsbar button'),function(b){ b.onclick=function(){ VIEW=b.getAttribute('data-tab'); paint(); }; });
  $('xl').onclick=excel; $('out').onclick=function(){ key(null); D=null; gate(); };
  thumbs();
}
function card(r,lead,skip){
  var meta=[r['Tour'],r['Received']].filter(Boolean).join(' · ');
  var all=Object.keys(r).filter(function(k){ return r[k]!==''&&r[k]!=null&&skip.indexOf(k)<0; });
  return '<div class="card"><h3>'+esc(r['Name']||'—')+'</h3><p class="meta">'+esc(meta)+'</p>'+lead+
    '<details><summary>Every answer</summary><dl>'+all.map(function(k){ return '<dt>'+esc(k)+'</dt><dd>'+esc(r[k])+'</dd>'; }).join('')+'</dl></details></div>';
}
/* ---------- the website (tcatours.co.uk) ---------- */
function pub(){ return (D&&D.pub)||{reviews:{},photos:{}}; }
var SNIP='<div data-tca-testimonials></div>\n<div data-tca-photos></div>\n<script src="https://feedback.tcatours.co.uk/embed/tca-feedback.js" async><\/script>';
function webBtn(kind,id,on,can){
  if(on) return '<span class="tag gold" style="margin:0"><i class="ti ti-world-check"></i> On the website</span> <button class="lnk" data-web="'+kind+'" data-id="'+esc(id)+'" data-on="0">Remove</button>';
  if(!can) return '<span class="meta">Can’t go on the website: no permission</span>';
  return '<button class="lnk" data-web="'+kind+'" data-id="'+esc(id)+'" data-on="1"><i class="ti ti-world-upload"></i> Add to website</button>';
}
function webBar(kind,r){
  var p=pub(), waiting=kind==='review'?r.filter(function(x){ return !p.reviews[x['Response ID']]; }).length
    :r.filter(function(x){ return x['OK to post?']==='Yes'&&x['Others in photo have consent?']&&!p.photos[x['Photo ID']]; }).length;
  var live=Object.keys(kind==='review'?p.reviews:p.photos).length;
  return '<div class="card" style="padding:14px 16px"><div class="row" style="justify-content:space-between"><span><b>'+live+'</b> '+(kind==='review'?'testimonial':'photo')+(live===1?'':'s')+' on tcatours.co.uk</span>'+
    (waiting?'<button class="btn gold" style="width:auto;padding:11px 16px" data-weball="'+kind+'"><i class="ti ti-world-upload"></i> Add all '+waiting+' to the website</button>':'<span class="meta">Everything with permission is on the website.</span>')+'</div>'+
    (kind==='photo'?'<p class="meta" style="margin-top:6px">Only photos where the sender said yes <b>and</b> confirmed everyone in them has permission. Check against the school’s photo consent list first.</p>':'')+
    '<details style="margin-top:6px"><summary>Website code (paste once into tcatours.co.uk)</summary><p class="meta" style="margin-top:6px">Add an HTML / embed block where the testimonials and photos should appear, and paste this in. Anything you add here then shows on the website automatically.</p>'+
    '<pre style="white-space:pre-wrap;background:var(--stone);padding:10px;font-size:12.5px;margin-top:6px">'+esc(SNIP)+'</pre><button class="lnk" data-copy="'+esc(SNIP)+'"><i class="ti ti-copy"></i> Copy code</button></details></div>';
}
function setWeb(kind,id,on,all){
  if(kind==='photo'&&(on||all)&&!confirm('Put '+(all?'these photos':'this photo')+' on the public website? Make sure the school’s photo consent covers everyone in '+(all?'them':'it')+'.')) return;
  fetch(API+'?type=fbpublish',{method:'POST',headers:{'content-type':'application/json','x-sheet-key':key()},body:JSON.stringify(all?{kind:kind,all:true}:{kind:kind,id:id,on:on})})
    .then(function(r){ return r.json(); }).then(function(j){
      if(!j||!j.ok) return flash((j&&j.error)||'Not changed');
      D.pub=j.pub; paint(); flash(all?('Added '+j.added+' to the website'):(on?'Added to the website':'Removed from the website'));
    }).catch(function(){ flash('No connection'); });
}
function view(){
  var r=rows(VIEW);
  if(!r.length) return '<div class="card"><p class="hint" style="font-size:14px">Nothing here yet'+(TOUR||FIND?' for this filter':'')+'.</p></div>';
  if(VIEW==='Website reviews') return webBar('review',r)+r.slice().reverse().map(function(x){ var t='“'+x['Review']+'”\n— '+x['Credit line'], on=!!pub().reviews[x['Response ID']];
    return '<div class="card"><p class="quote">“'+esc(x['Review'])+'”</p><p style="margin-top:8px;font-weight:600">— '+esc(x['Credit line'])+'</p>'+
      '<p class="meta">'+esc([x['Who'],x['Tour'],x['Permission']].filter(Boolean).join(' · '))+'</p><p class="row" style="margin-top:8px"><button class="lnk" data-copy="'+esc(t)+'"><i class="ti ti-copy"></i> Copy review</button>'+webBtn('review',x['Response ID'],on,true)+'</p></div>'; }).join('');
  if(VIEW==='Teachers') return r.slice().reverse().map(function(x){
    return card(x,'<p style="margin-top:8px"><span class="tag gold">Overall '+esc(x[OVERALL_T]||'—')+'/5</span> <span class="tag">'+esc(x['School / Organisation']||'')+'</span></p>'+
      (x['Summary of the trip & working with TCA Tours']?'<p class="quote" style="font-size:18px;margin-top:8px">“'+esc(x['Summary of the trip & working with TCA Tours'])+'”</p>':''),[]); }).join('');
  if(VIEW==='Students') return r.slice().reverse().map(function(x){
    return card(x,'<p style="margin-top:8px"><span class="tag gold">Overall '+esc(x['Overall rating (1–5)']||'—')+'/5</span> <span class="tag">'+esc(x['School / Organisation']||'')+'</span></p>'+
      (x['Best bit of the trip']?'<p style="margin-top:8px"><b>Best bit:</b> '+esc(x['Best bit of the trip'])+'</p>':''),[]); }).join('');
  if(VIEW==='Trip ratings'){
    var g={}; r.forEach(function(x){ var k=x['Tour']+'\u0000'+x['Trip']; (g[k]=g[k]||{tour:x['Tour'],trip:x['Trip'],v:[],na:0,t:0,s:0}); var v=x['Rating (1–5)'];
      if(/didn/i.test(v)) g[k].na++; else g[k].v.push(v); if(x['Who']==='Teacher') g[k].t++; else g[k].s++; });
    var list=Object.keys(g).map(function(k){ var o=g[k]; o.a=avg(o.v); return o; }).sort(function(a,b){ return ((b.a&&b.a.avg)||0)-((a.a&&a.a.avg)||0); });
    return '<table><tr><th>Trip</th><th>Tour</th><th style="text-align:right">Average</th></tr>'+list.map(function(o){
      return '<tr><td><b>'+esc(o.trip)+'</b><div class="meta">'+(o.a?esc(o.a.work):'No ratings')+(o.na?' · '+o.na+' didn’t go':'')+' · '+o.t+' teacher'+(o.t===1?'':'s')+', '+o.s+' student'+(o.s===1?'':'s')+'</div></td><td class="meta">'+esc(o.tour)+'</td><td class="n">'+(o.a?o.a.avg:'—')+'</td></tr>'; }).join('')+'</table>';
  }
  if(VIEW==='Photos') return webBar('photo',r)+'<div class="grid">'+r.slice().reverse().map(function(x){ var ok=x['OK to post?']==='Yes', can=ok&&!!x['Others in photo have consent?'], on=!!pub().photos[x['Photo ID']];
    return '<div class="pc"><img data-ph="'+esc(x['Photo ID'])+'" alt="">'+
      '<span class="tag '+(ok?'gold':'')+'">'+(ok?'OK to post':'TCA Tours only')+'</span>'+(ok&&x['Others in photo have consent?']?' <span class="tag">Others consented</span>':'')+
      '<p style="font-size:13.5px;margin-top:6px"><b>'+esc(x['Name'])+'</b> · '+esc(x['Who'])+(x['Caption']?'<br>'+esc(x['Caption']):'')+'</p><p class="meta">'+esc(x['Tour'])+'</p>'+
      '<p style="margin-top:6px"><button class="lnk" data-dl="'+esc(x['Photo ID'])+'" data-name="'+esc((x['Name']||'photo')+'_'+x['Photo ID'])+'">Download</button></p><p style="margin-top:6px">'+webBtn('photo',x['Photo ID'],on,can)+'</p></div>'; }).join('')+'</div>';
  return '';
}
/* Photos load one by one through the password-protected backend */
function thumbs(){ [].forEach.call(document.querySelectorAll('img[data-ph]'),function(img){ var id=img.getAttribute('data-ph'); if(!id) return;
  if(IMG[id]){ img.src=IMG[id]; return; }
  fetch(API+'?type=sheetphoto&id='+encodeURIComponent(id),{headers:{'x-sheet-key':key()}}).then(function(r){return r.json();}).then(function(j){ if(j&&j.data){ IMG[id]=j.data; img.src=j.data; } }).catch(function(){}); }); }
document.addEventListener('click',function(e){
  var w=e.target.closest('[data-web]'); if(w){ setWeb(w.getAttribute('data-web'),w.getAttribute('data-id'),w.getAttribute('data-on')==='1'); return; }
  var wa=e.target.closest('[data-weball]'); if(wa){ setWeb(wa.getAttribute('data-weball'),null,true,true); return; }
  var c=e.target.closest('[data-copy]'); if(c){ copy(c.getAttribute('data-copy')); return; }
  var d=e.target.closest('[data-dl]'); if(d){ var id=d.getAttribute('data-dl'); if(!IMG[id]){ flash('Still loading'); return; } var a=document.createElement('a'); a.href=IMG[id]; a.download=String(d.getAttribute('data-name')).replace(/[^\w-]+/g,'_')+'.jpg'; document.body.appendChild(a); a.click(); a.remove(); }
});
/* Excel: the same tabs and columns as the master spreadsheet, for the tour / search shown */
function excel(){
  var go=function(){ var X=window.XLSX, wb=X.utils.book_new(), any=false;
    TABS.forEach(function(t){ var r=rows(t); if(!r.length) return; var head=[]; r.forEach(function(x){ Object.keys(x).forEach(function(k){ if(head.indexOf(k)<0) head.push(k); }); });
      X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([head].concat(r.map(function(x){ return head.map(function(k){ return x[k]==null?'':x[k]; }); }))),t); any=true; });
    if(!any) return flash('Nothing to download');
    var v=1; try{ v=(parseInt(localStorage.getItem('tca_sheet_dl'),10)||0)+1; localStorage.setItem('tca_sheet_dl',String(v)); }catch(e){}
    X.writeFile(wb,'TCA_Tours_Feedback'+(TOUR?'_'+TOUR.replace(/[^\w]+/g,'_'):'')+'_v'+v+'.xlsx'); };
  if(window.XLSX) go(); else { var s=document.createElement('script'); s.src='/vendor/xlsx-0.18.5.full.min.js'; s.onload=go; s.onerror=function(){ flash('Couldn’t load the spreadsheet maker'); }; document.head.appendChild(s); }
}
load();
})();
