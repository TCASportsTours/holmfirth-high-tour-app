/* TCA Tours — questionnaires inside the tour app, v3 (app v24).
   The questionnaires themselves live on their own links: /feedback/teachers and /feedback/students (feedback/feedback.js).
   Teachers: a pop-up as soon as the app opens (until they've sent it) and a "Tour questionnaire" tile, both opening the
   teacher link with their name filled in. TCA Tours staff: More → Questionnaire results (teachers + students, website
   reviews, photos, ratings with the working) and More → Questionnaire links (copy / preview the two links).
   The full results (every tour, plus the Google Form history) are at /sheet behind their own password, with Download as Excel.
   Answers teachers sent inside the app before the links existed (v22/v23) are included.
   Uses helpers from index.html: API, LS, lsGet, lsSet, esc, jsArg, $, toast, openPage, rerenderPage, openModal, closeModal, me, isTeacher, isTcaStaff, ago. */
'use strict';
var FB_TEACH = '/feedback/teachers/', FB_STUD = '/feedback/students/';
/* The generic TCA Tours address for feedback (a domain alias of this site). Used once it's live; until then, this site's own links. */
var FB_HOME = 'https://feedback.tcatours.co.uk', FB_LIVE = null;
function fbCheckHome(cb){
  if(location.origin===FB_HOME) FB_LIVE=true;
  if(FB_LIVE!==null){ if(cb) cb(FB_LIVE); return; }
  fetch(FB_HOME+'/feedback/feedback.css',{mode:'no-cors',cache:'no-store'}).then(function(){ FB_LIVE=true; },function(){ FB_LIVE=false; }).then(function(){ if(cb) cb(FB_LIVE); });
}
function fbLink(kind){ /* 'teachers' | 'students' | 'results' */
  if(FB_LIVE) return FB_HOME+'/'+(kind==='results'?'':kind);
  return location.origin+(kind==='results'?'/sheet':'/feedback/'+kind+'/');
}
function openFbResults(){ fbCheckHome(function(){ window.open(fbLink('results'),'_blank','noopener'); }); }

function tqWho(){ return isTeacher()&&me()?me():(isTcaStaff()?'TCA Tours (test)':''); }
function tqKey(k){ return 'hny_tq_'+k+'_'+(tqWho()||'x'); }
function tqDone(){ return !!lsGet(tqKey('done')); }
function openQuestionnaire(){
  if(isTeacher()&&me()) location.href=FB_TEACH+'?t='+encodeURIComponent(me());
  else location.href=FB_TEACH+'?test=1';
}

/* Shows straight away every time a teacher opens the app, until they've sent it. "Later" hides it until the next open
   (the app coming back after more than 10 minutes in the background counts as opening it again). */
var TQ_LATER=0;
function maybeAskQuestionnaire(){
  if(!isTeacher()||!me()||tqDone()) return;
  if(TQ_LATER && Date.now()-TQ_LATER<10*60000) return;
  if($('modal').classList.contains('on')) return;
  openModal('<p class="label">Thank you for travelling with us</p><h2 style="font-size:28px">Tour <em>questionnaire</em></h2>'+
    '<p class="small muted" style="margin:8px 0 14px">How did New York go? A few minutes of feedback from each teacher helps us make the next trip even better.</p>'+
    '<button class="btn gold" onclick="closeModal();openQuestionnaire()"><i class="ti ti-pencil"></i> Start · about 3 minutes</button><button class="btn ghost" onclick="TQ_LATER=Date.now();closeModal()">Later</button>');
}

/* ---------- the two links (TCA Tours staff) ---------- */
function openFbLinks(){ fbCheckHome(fbPaintLinks); }
function fbPaintLinks(){
  var row=function(title,sub,kind){ var u=fbLink(kind), path=u;
    return '<div class="card rule"><h3 style="font-size:21px">'+esc(title)+'</h3><p class="small muted" style="margin-top:4px">'+esc(sub)+'</p>'+
      '<p class="small" style="margin-top:8px;overflow-wrap:anywhere"><b>'+esc(u)+'</b></p>'+
      '<div class="btnrow" style="margin-top:10px"><button class="btn dark" onclick="tqCopy('+jsArg(u)+',\'Link copied\')"><i class="ti ti-copy"></i> Copy link</button>'+
      (kind==='results'?'<a class="btn line" href="'+esc(path)+'" target="_blank" rel="noopener"><i class="ti ti-lock-open"></i> Open</a>':'<a class="btn line" href="'+esc(path)+'?test=1" target="_blank" rel="noopener"><i class="ti ti-eye"></i> Preview</a>')+'</div></div>'; };
  openPage('<p class="label">TCA Tours · feedback</p><h2>Questionnaire <em>links</em></h2>'+
    '<p class="small muted">Send these to the school. No sign-in needed.</p>'+
    (FB_LIVE?'':'<p class="small" style="background:var(--stone);padding:8px 10px;margin-top:8px"><i class="ti ti-info-circle"></i> The TCA Tours address <b>feedback.tcatours.co.uk</b> isn’t live yet, so these are this site’s links. They’ll switch automatically once it is.</p>')+
    row('Teachers','About 3 minutes, plus optional detail. Built on the TCA feedback form; asks permission to use their review on the website.','teachers')+
    row('Students','About 2 minutes: overall rating, each trip, best bit, a comment, and optional photos with permission to post.','students')+
    row('Results (password)','Every tour’s answers, photos and Download as Excel. For TCA Tours only.','results')+
    '<p class="small muted">Preview sends are marked as tests and left out of the results. Everything is collected at /sheet (password), with Download as Excel.</p>');
}

/* ---------- results (TCA Tours staff) ---------- */
var FBR=null, FBF={kind:'all',test:false};
function openTqResults(){ FBR=null; fbPaint(false); fbLoad(); }
function fbLoad(){ fetch(API+'?type=fb',{headers:{'x-staff-key':lsGet(LS.key)||''},cache:'no-store'}).then(function(r){return r.json();})
  .then(function(j){ FBR=j; if($('tqRes')) fbPaint(true); }).catch(function(){ FBR={ok:false,error:'Needs signal to load the answers.'}; if($('tqRes')) fbPaint(true); }); }
/* Average with the working shown: "(5 + 4) ÷ 2 = 4.5" */
function tqAvg(vals){ var n=vals.filter(function(v){return typeof v==='number';}); if(!n.length) return null; var t=n.reduce(function(a,b){return a+b;},0);
  return {avg:Math.round(t/n.length*10)/10, n:n.length, work:'('+n.join(' + ')+') ÷ '+n.length+' = '+(Math.round(t/n.length*100)/100)}; }
/* This tour only: the Google Form history from earlier tours shows on /sheet, not here */
function fbMine(){ return ((FBR&&FBR.rows)||[]).filter(function(r){ return r.source!=='Google Form'; }); }
function fbRows(){ return fbMine().filter(function(r){ return (FBF.test||!r.test)&&(FBF.kind==='all'||r.kind===FBF.kind); }); }
function fbCredit(r){ var a=r.a||{}, q=a.quoteOk||'', school=a.school||(r.tour&&r.tour.school)||'', dest=String((r.tour&&r.tour.destination)||'').split(',')[0];
  if(!/^Yes/.test(q)) return '';
  if(r.kind==='student') return /first name/.test(q)?String(a.name||'').trim().split(/\s+/)[0]+', '+school:'A student on the '+dest+' trip';
  if(/name and school/.test(q)) return [a.name,school].filter(Boolean).join(', ');
  if(/school name only/.test(q)) return 'A teacher at '+school;
  return 'A teacher on the '+dest+' trip'; }
function fbQuote(r){ var a=r.a||{}; return r.kind==='teacher'?(a.summary||a.say||a.stoodOut):(a.summary||a.best); }
function fbPaint(keep){
  var j=FBR, h='<p class="label">TCA Tours · feedback</p><h2>Questionnaire <em>results</em></h2><div id="tqRes">';
  if(!j) h+='<div class="card"><p class="small muted">Loading…</p></div>';
  else if(!j.ok) h+='<div class="card"><p class="small">'+esc(j.error||'Not allowed')+'</p></div>';
  else {
    var all=fbMine().filter(function(r){return FBF.test||!r.test;}), rows=fbRows();
    var T_=all.filter(function(r){return r.kind==='teacher';}), S_=all.filter(function(r){return r.kind==='student';});
    var answered={}; T_.forEach(function(r){ answered[String(r.a.name||'')]=1; });
    h+='<div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile" style="min-height:0"><b class="num" style="font-size:28px">'+T_.length+'</b><span>teacher'+(T_.length===1?'':'s')+' answered</span></div>'+
      '<div class="tile" style="min-height:0"><b class="num" style="font-size:28px">'+S_.length+'</b><span>student'+(S_.length===1?'':'s')+' answered</span></div></div>';
    h+='<button class="btn dark" onclick="openFbResults()" style="margin-top:4px"><i class="ti ti-table"></i> Full results: every tour + Excel</button>';
    h+='<div class="seg" style="margin-top:6px">'+[['all','Everyone'],['teacher','Teachers'],['student','Students']].map(function(x){ return '<button class="'+(FBF.kind===x[0]?'on':'')+'" onclick="FBF.kind=\''+x[0]+'\';fbPaint(true)">'+x[1]+'</button>'; }).join('')+'</div>';
    var tests=(j.rows||[]).filter(function(r){return r.test;}).length;
    if(tests) h+='<p class="small"><label><input type="checkbox" '+(FBF.test?'checked':'')+' onchange="FBF.test=this.checked;fbPaint(true)"> Include '+tests+' test answer'+(tests>1?'s':'')+'</label></p>';
    var waiting=(j.teachers||[]).filter(function(t){ return !answered[t]&&!Object.keys(answered).some(function(n){ return n.toLowerCase().indexOf(t.replace(/^(Mrs|Mr|Miss|Ms|Dr)\s+/,'').toLowerCase())>=0; }); });
    if(FBF.kind!=='student'&&waiting.length) h+='<p class="small muted">Teachers not heard from yet: '+waiting.map(esc).join(', ')+'</p>';
    if(rows.length){
      h+='<button class="btn line" style="margin:10px 0" onclick="fbExport()"><i class="ti ti-table-down"></i> Export to Excel</button>';
      var ok=rows.filter(function(r){ return fbCredit(r)&&fbQuote(r); });
      h+='<p class="label">For the website · '+ok.length+'</p>'+(ok.length?ok.map(function(r){ var qt=fbQuote(r), cr=fbCredit(r);
          return '<div class="card rule"><p style="font-family:var(--display);font-size:19px;line-height:1.35">“'+esc(qt)+'”</p><p class="small" style="margin-top:8px"><b>— '+esc(cr)+'</b></p>'+
            '<p class="small muted" style="margin-top:4px">'+(r.kind==='teacher'?'Teacher':'Student')+' · '+esc(r.a.quoteOk)+(r.test?' · TEST':'')+'</p><p style="margin-top:8px"><button class="linkbtn" onclick="tqCopy('+jsArg('“'+qt+'”\n— '+cr)+')"><i class="ti ti-copy"></i> Copy review</button></p></div>'; }).join('')
        :'<div class="card"><p class="small">No reviews cleared for the website yet.</p></div>');
      /* photos */
      var phs=[]; rows.forEach(function(r){ (r.photos||[]).forEach(function(p){ phs.push({r:r,p:p}); }); });
      if(phs.length){ h+='<p class="label">Photos · '+phs.length+'</p><div class="fbgrid">'+phs.map(function(x){ var ok2=x.r.a.photoOk==='Yes';
          return '<div class="fbph"><img data-ph="'+esc(x.p.id)+'" alt=""><div class="small"><span class="tag '+(ok2?'gold':'')+'" style="margin:0">'+(ok2?'OK to post':'TCA only')+'</span>'+
            (ok2&&x.r.a.othersOk?' <span class="small muted">others consented</span>':'')+'<div class="muted" style="margin-top:2px">'+esc(x.r.a.name||'')+(x.p.cap?': '+esc(x.p.cap):'')+'</div>'+
            '<button class="linkbtn" onclick="fbPhotoSave('+jsArg(x.p.id)+','+jsArg((x.r.a.name||'photo')+'_'+x.p.id)+')">Download</button></div></div>'; }).join('')+'</div>'; }
      /* ratings */
      var rk=[['r_overall','Overall'],['r_objectives','Objectives achieved (teachers)'],['r_support','Communication & on-tour support (teachers)'],['r_itin','Itinerary & pace'],['r_hostel','Accommodation'],['r_flights','Flights'],['r_coach','Coach transfers'],['r_value','Value for money'],['r_app','Tour app']];
      h+='<p class="label">Ratings · 1 to 5</p><table class="lb">'+rk.map(function(q){ var vals=rows.map(function(r){return r.a[q[0]];}), s=tqAvg(vals);
          if(!s) return ''; return '<tr><td>'+esc(q[1])+'<div class="small muted">'+esc(s.work)+'</div></td><td class="sc" style="text-align:right">'+s.avg+'<div class="small muted">'+s.n+' answer'+(s.n>1?'s':'')+'</div></td></tr>'; }).join('')+'</table>';
      var tn=[]; rows.forEach(function(r){ Object.keys(r.a.trips||{}).forEach(function(t){ if(tn.indexOf(t)<0) tn.push(t); }); });
      if(tn.length) h+='<p class="label">The trips</p><table class="lb">'+tn.map(function(t){ var vals=rows.map(function(r){return (r.a.trips||{})[t];}); return {t:t,s:tqAvg(vals),na:vals.filter(function(v){return v==='na';}).length}; })
        .sort(function(a,b){ return ((b.s&&b.s.avg)||0)-((a.s&&a.s.avg)||0); }).map(function(x){
          return '<tr><td>'+esc(x.t)+(x.s?'<div class="small muted">'+esc(x.s.work)+'</div>':'')+(x.na?'<div class="small muted">'+x.na+' didn’t go</div>':'')+'</td><td class="sc" style="text-align:right">'+(x.s?x.s.avg:'—')+'</td></tr>'; }).join('')+'</table>';
      /* every response */
      h+='<p class="label">Every response</p>'+rows.slice().reverse().map(function(r){ var a=r.a;
        var bits=(r.kind==='teacher'?[['Sum up',a.summary],['Stood out',a.stoodOut],['Biggest impact',a.impact],['Would say to another school',a.say],['Comments & suggestions',a.improve]]
          :[['Describe it to a friend',a.summary],['Best bit',a.best],['Would change',a.change]]).filter(function(x){return x[1];});
        return '<div class="card rule"><div class="cardhead"><h3 style="font-size:19px">'+esc(a.name||'—')+' <span class="tag">'+(r.kind==='teacher'?'Teacher':'Student')+'</span>'+(r.test?' <span class="tag">Test</span>':'')+'</h3><span class="small muted">'+esc(ago(r.ts))+'</span></div>'+
          '<p class="small muted">'+esc(['Overall '+(a.r_overall||'—')+'/5','Recommend: '+(a.recommend||'—'),'Quote: '+(a.quoteOk||'not answered'),(r.photos||[]).length?(r.photos.length+' photo'+(r.photos.length>1?'s':'')):'',r.source].filter(Boolean).join(' · '))+'</p>'+
          (bits.length?bits.map(function(x){ return '<p class="small" style="margin-top:6px"><b>'+esc(x[0])+':</b> '+esc(x[1])+'</p>'; }).join(''):'<p class="small muted">No comments.</p>')+
          (/^g-/.test(r.id)?'':'<p style="margin-top:8px"><button class="linkbtn" onclick="fbDelete('+jsArg(r.id)+','+jsArg(a.name||'this')+')">Delete</button></p>')+'</div>'; }).join('');
    } else h+='<div class="card"><p class="small">No answers yet. Send the links from More → Questionnaire links.</p></div>';
    h+='<p class="small muted" style="margin-top:10px"><button class="linkbtn" onclick="fbLoad()">Refresh</button></p>';
  }
  h+='</div>';
  if(keep) rerenderPage(h); else openPage(h,openTqResults);
  fbThumbs();
}
/* Photos need the staff password, so they're fetched and shown one by one */
var FB_IMG={};
function fbThumbs(){ [].forEach.call(document.querySelectorAll('img[data-ph]'),function(img){ var id=img.getAttribute('data-ph');
  if(FB_IMG[id]){ img.src=FB_IMG[id]; return; }
  fetch(API+'?type=fbphoto&id='+encodeURIComponent(id),{headers:{'x-staff-key':lsGet(LS.key)||''}}).then(function(r){return r.json();}).then(function(j){ if(j&&j.data){ FB_IMG[id]=j.data; img.src=j.data; } }).catch(function(){}); }); }
function fbPhotoSave(id,name){ var d=FB_IMG[id]; if(!d){ toast('Still loading'); return; } var a=document.createElement('a'); a.href=d; a.download=String(name).replace(/[^\w-]+/g,'_')+'.jpg'; document.body.appendChild(a); a.click(); a.remove(); }
function tqCopy(t,msg){ try{ navigator.clipboard.writeText(t).then(function(){ toast(msg||'Review copied'); },function(){ prompt('Copy this:',t); }); }catch(e){ prompt('Copy this:',t); } }
function fbDelete(id,name){
  if(!confirm('Delete '+name+'’s answers? This can’t be undone.')) return;
  fetch(API+'?type=fbdel',{method:'POST',headers:{'content-type':'application/json','x-staff-key':lsGet(LS.key)||''},body:JSON.stringify({id:id})})
    .then(function(r){ if(r.ok){ toast('Deleted'); fbLoad(); } else toast('Could not delete ('+r.status+')'); }).catch(function(){ toast('Needs signal'); });
}
/* Every response as spreadsheet tabs (Website reviews, Teachers, Students, Trip ratings, Photos) */
function fbExport(){
  fetch(API+'?type=fbrows',{headers:{'x-staff-key':lsGet(LS.key)||''},cache:'no-store'}).then(function(r){return r.json();}).then(function(j){
    if(!j||!j.ok) return toast('Couldn’t get the answers');
    var go=function(){ var X=window.XLSX, wb=X.utils.book_new();
      ['Website reviews','Teachers','Students','Trip ratings','Photos'].forEach(function(tab){ var rows=(j.tabs[tab]||[]).filter(function(r){ return FBF.test||r['Test?']!=='Yes'; });
        if(!rows.length) return; var head=[]; rows.forEach(function(r){ Object.keys(r).forEach(function(k){ if(head.indexOf(k)<0) head.push(k); }); });
        X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet([head].concat(rows.map(function(r){ return head.map(function(k){ return r[k]==null?'':r[k]; }); }))),tab); });
      var v=(parseInt(lsGet('hny_fbdl'),10)||0)+1; lsSet('hny_fbdl',String(v)); X.writeFile(wb,'Holmfirth_NYC_Feedback_v'+v+'.xlsx'); };
    if(window.XLSX) go(); else { var s=document.createElement('script'); s.src='vendor/xlsx-0.18.5.full.min.js'; s.onload=go; s.onerror=function(){ toast('Couldn’t load the spreadsheet maker'); }; document.head.appendChild(s); }
  }).catch(function(){ toast('Needs signal'); });
}

/* This script loads after the app has started, so ask now if a teacher is already signed in */
if(!$('app').classList.contains('locked')) maybeAskQuestionnaire();
if(isTcaStaff()) fbCheckHome();
document.addEventListener('visibilitychange',function(){
  if(document.hidden){ window._tqHiddenAt=Date.now(); return; }
  if(window._tqHiddenAt && Date.now()-window._tqHiddenAt>10*60000){ TQ_LATER=0; maybeAskQuestionnaire(); }
});
