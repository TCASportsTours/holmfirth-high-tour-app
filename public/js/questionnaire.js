/* TCA Tours — post-tour TEACHER questionnaire, v2 (app v22). Built on TCA's own Google Form (Skinners' / Wycombe Abbey feedback)
   plus optional detail modelled on the GCS Tour App v48/v49 questionnaire. Main purpose: reviews for the TCA Tours website.
   Teachers: More → Tour questionnaire (and a pop-up, at most once a day, until they send it).
   TCA Tours staff: More → Questionnaire results, with the working beside every number, and Export to Excel.
   Answers go to the backend slot ?type=tq, one entry per teacher (sending again replaces it).
   Only "The tour overall" is required. A draft is kept on the phone, so half-finished answers survive closing the app.
   Uses helpers from index.html: API, lsGet, lsSet, esc, jsArg, $, toast, openPage, rerenderPage, openModal, closeModal, T, NY, me, isTeacher, isTcaStaff, isStaff, ago. */
'use strict';
var TQ_VERSION = 2;
var TQ = {};   // the answers being filled in

/* The three ratings from TCA's Google Form (1 = very dissatisfied, 5 = extremely satisfied) */
var TQ_CORE = [['r_overall','Overall, how satisfied were you with your TCA Tours experience?',''],
  ['r_objectives','How satisfied are you that the trip achieved its objectives?','For example student development, business learning, cultural experiences'],
  ['r_support','How satisfied were you with our communication, organisation and on-tour support?','']];
/* Optional detail */
var TQ_DETAIL = [['r_itin','The itinerary & pace of each day'],['r_hostel','Accommodation: HI New York City Hostel'],['r_flights','Flights'],['r_coach','Coach transfers'],['r_value','Value for money'],['r_app','The tour app']];
var TQ_SPEND = ['Under $100','$100–$200','$200–$300','$300–$400','Over $400'];
var TQ_WHEN = ['2027–28','2028–29','Later','Not sure'];
var TQ_QUOTE = ['Yes, with my name and school','Yes, with the school name only','Yes, but anonymously','No thanks'];
var TQ_SCHOOL = 'Holmfirth High School';

function tqWho(){ return isTeacher()&&me()?me():(isTcaStaff()?'TCA Tours (test)':''); }
function tqKey(k){ return 'hny_tq_'+k+'_'+(tqWho()||'x'); }
function tqDone(){ return !!lsGet(tqKey('done')); }
function tqSave(){ lsSet(tqKey('draft'),JSON.stringify(TQ)); }

/* The trips on the itinerary that are worth rating: activities, events, free time and the two dinner venues.
   Leaves out travel, info notes, breakfasts/lunches, "Arrive at…" rows and anything Staff/TCA only. */
function tqTrips(){
  var seen={}, out=[];
  (T.events||[]).forEach(function(e){
    if(e.staffOnly||e.tcaOnly) return;
    var ok=/^(Activity|Event|Free time)$/i.test(e.type||'') || (/^Food$/i.test(e.type||'') && !/breakfast|lunch|eat locally/i.test(e.title||''));
    if(!ok || /^arrive at/i.test(e.title||'')) return;
    var k=String(e.title).toLowerCase(); if(seen[k]) return; seen[k]=1;
    out.push({title:e.title, day:e.day});
  });
  return out;
}

/* ---------- small building blocks ---------- */
function tqCard(icon,title,body,id){ return '<div class="card rule tqcard"'+(id?' id="'+id+'"':'')+'><div class="tqhead"><i class="ti '+icon+'"></i><h3>'+title+'</h3></div>'+body+'</div>'; }
function tqQ(q,hint,req){ return '<p class="tqq">'+esc(q)+(req?' <span class="tqreq">*</span>':'')+'</p>'+(hint?'<p class="tqhint">'+esc(hint)+'</p>':''); }
function tqGet(path){ var p=path.split('.'), o=TQ; for(var i=0;i<p.length;i++){ if(o==null) return undefined; o=o[p[i]]; } return o; }
function tqSetV(path,v){ var p=path.split('.'), o=TQ; for(var i=0;i<p.length-1;i++){ if(typeof o[p[i]]!=='object'||!o[p[i]]) o[p[i]]={}; o=o[p[i]]; } o[p[p.length-1]]=v; }
function tqStars(k,na){
  var v=tqGet(k), h='<div class="tqstars" data-k="'+k+'">';
  for(var i=1;i<=5;i++) h+='<button type="button" data-s="'+i+'" aria-label="'+i+' star'+(i>1?'s':'')+'" class="'+(typeof v==='number'&&v>=i?'on':'')+'"><i class="ti ti-star'+(typeof v==='number'&&v>=i?'-filled':'')+'"></i></button>';
  if(na) h+='<button type="button" data-s="na" class="tqna'+(v==='na'?' on':'')+'">'+esc(na)+'</button>';
  return h+'</div>';
}
function tqChips(k,opts,multi){
  var v=tqGet(k); return '<div class="seg tqchips" data-k="'+k+'"'+(multi?' data-multi="1"':'')+'>'+opts.map(function(o){
    var on=multi?(Array.isArray(v)&&v.indexOf(o)>=0):v===o; return '<button type="button" class="'+(on?'on':'')+'" data-v="'+esc(o)+'">'+esc(o)+'</button>'; }).join('')+'</div>';
}
function tqText(k,ph,rows){ var v=tqGet(k)||''; return rows?'<textarea class="field tqtext" data-t="'+k+'" rows="'+rows+'" placeholder="'+esc(ph)+'">'+esc(v)+'</textarea>':'<input class="field tqtext" data-t="'+k+'" placeholder="'+esc(ph)+'" value="'+esc(v)+'">'; }
function tqNps(k){ var v=tqGet(k), h='<div class="tqnps" data-k="'+k+'">'; for(var i=0;i<=10;i++) h+='<button type="button" data-n="'+i+'" class="'+(v===i?'on':'')+'">'+i+'</button>'; return h+'</div><div class="tqnpsends"><span>Not at all</span><span>Definitely</span></div>'; }

/* ---------- the form ---------- */
function openQuestionnaire(){
  if(!tqWho()){ toast('Sign in as a teacher first'); return; }
  TQ={}; try{ TQ=JSON.parse(lsGet(tqKey('draft'))||lsGet(tqKey('sent'))||'{}')||{}; }catch(e){ TQ={}; }
  if(TQ.v!==TQ_VERSION) TQ={v:TQ_VERSION};
  if(TQ.name==null) TQ.name=isTeacher()?(me()||''):''; if(TQ.school==null) TQ.school=TQ_SCHOOL;
  var trips=tqTrips(), h='';
  h+='<p class="label">Holmfirth High · New York 2026</p><h2>Tour <em>questionnaire</em></h2>'+
    '<p class="small muted" style="margin:6px 0 4px">For the teachers on the trip. The first page takes about three minutes; the optional details another two. Only the starred question is needed.</p>'+
    (isTcaStaff()?'<p class="small" style="background:var(--stone);padding:8px 10px;margin-top:8px"><i class="ti ti-eye"></i> TCA preview: anything you send is marked as a test.</p>':'');

  h+=tqCard('ti-star','Your rating',
    '<p class="tqhint">1 = very dissatisfied, 5 = extremely satisfied.</p>'+
    TQ_CORE.map(function(r){ return tqQ(r[1],r[2],r[0]==='r_overall')+tqStars(r[0]); }).join(''),'tqTourCard');

  h+=tqCard('ti-school','The trip',
    tqQ('What stood out about this trip for you and your students?','')+tqText('stoodOut','e.g. the Hershey’s business tour, the Rangers game…',3)+
    tqQ('What was the biggest impact of this trip on your students?','')+tqText('impact','What did they take away from it?',3));

  h+=tqCard('ti-message-heart','Your review',
    tqQ('Would you recommend TCA Tours to another school?','')+tqChips('recommend',['Yes','No'])+
    '<div id="tqSayWrap">'+tqQ('What would you say to another school considering this trip?','')+tqText('say','e.g. Use TCA Tours because…',3)+'</div>'+
    tqQ('Sum up the trip and working with TCA Tours in a few sentences','This is the comment we’d love to use on our website')+tqText('summary','Your thoughts on the trip, and on working with TCA Tours',5)+
    tqQ('Are you happy for us to use your comments on our website and social media?','')+tqChips('quoteOk',TQ_QUOTE)+
    '<div id="tqNameWrap">'+tqQ('Your name, as you’d like it shown','')+tqText('name','e.g. Erin Lees')+'</div>'+
    '<div id="tqSchoolWrap">'+tqQ('School','')+tqText('school','School name')+'</div>');

  h+=tqCard('ti-adjustments','More detail (optional)',
    '<p class="tqhint">For the TCA Tours team only: none of this goes on the website.</p>'+
    TQ_DETAIL.map(function(r){ return tqQ(r[1],'')+tqStars(r[0],'Not for me'); }).join('')+
    tqQ('Rate the trips and venues','Tap “Didn’t go” for any your group missed')+
    trips.map(function(x,i){ return '<div class="tqtrip"><p class="tqtripname">'+esc(x.title)+'<span>Day '+esc(x.day)+'</span></p>'+tqStars('trip.'+i,'Didn’t go')+'</div>'; }).join('')+
    tqQ('How much spending money would you recommend for students next time?','For the whole trip')+tqChips('spend',TQ_SPEND)+
    tqQ('Any additional comments or suggestions?','Anything we could do better: it helps')+tqText('improve','Be honest',3));

  h+=tqCard('ti-plane-departure','Next time',
    tqQ('Would you book another trip with TCA Tours?','')+tqChips('again',['Yes','Maybe','No'])+
    tqQ('Where might your school like to go next?','Pick New York, or tell us where')+tqChips('dests',['New York again','Other'],true)+
    '<div id="tqDestOther">'+tqText('destsOther','Where would you like to go?')+'</div>'+
    tqQ('When might that be?','')+tqChips('when',TQ_WHEN));

  h+='<div class="err" id="tqErr"></div><button class="btn gold" id="tqSend" style="margin:14px 0 26px" onclick="tqSubmit()"><i class="ti ti-send"></i> Send my answers</button>';
  openPage('<div id="tqWrap">'+h+'</div>');
  var w=$('tqWrap'); w.addEventListener('click',tqClick); w.addEventListener('input',tqInput); tqConditionals();
}
function tqClick(e){
  var b=e.target.closest('button'); if(!b) return;
  var box=b.parentNode, k=box.getAttribute('data-k'); if(!k) return;
  if(box.classList.contains('tqstars')){ var s=b.getAttribute('data-s'); var v=s==='na'?'na':Number(s); tqSetV(k,tqGet(k)===v?undefined:v);
    var cur=tqGet(k); [].forEach.call(box.querySelectorAll('button'),function(x){ var xs=x.getAttribute('data-s'); var on=xs==='na'?cur==='na':(typeof cur==='number'&&cur>=Number(xs)); x.classList.toggle('on',on); var i=x.querySelector('i'); if(i) i.className='ti ti-star'+(on?'-filled':''); }); }
  else if(box.classList.contains('tqchips')){ var val=b.getAttribute('data-v');
    if(box.getAttribute('data-multi')){ var arr=Array.isArray(tqGet(k))?tqGet(k).slice():[]; var i2=arr.indexOf(val); if(i2>=0) arr.splice(i2,1); else arr.push(val); tqSetV(k,arr); b.classList.toggle('on',i2<0); }
    else { var nv=tqGet(k)===val?undefined:val; tqSetV(k,nv); [].forEach.call(box.querySelectorAll('button'),function(x){ x.classList.toggle('on',x.getAttribute('data-v')===nv); }); } }
  else if(box.classList.contains('tqnps')){ var n=Number(b.getAttribute('data-n')); tqSetV(k,tqGet(k)===n?undefined:n); [].forEach.call(box.querySelectorAll('button'),function(x){ x.classList.toggle('on',Number(x.getAttribute('data-n'))===tqGet(k)); }); }
  else return;
  tqSave(); tqConditionals();
}
function tqInput(e){ var k=e.target.getAttribute('data-t'); if(!k) return; tqSetV(k,String(e.target.value||'')); tqSave(); }
function tqConditionals(){
  var show=function(id,on){ var o=$(id); if(o) o.style.display=on?'':'none'; };
  show('tqSayWrap',TQ.recommend!=='No'); show('tqDestOther',Array.isArray(TQ.dests)&&TQ.dests.indexOf('Other')>=0);
  show('tqNameWrap',!TQ.quoteOk||TQ.quoteOk==='Yes, with my name and school');
  show('tqSchoolWrap',!TQ.quoteOk||/school/.test(TQ.quoteOk));
}

function tqSubmit(){
  [].forEach.call(document.querySelectorAll('#tqWrap [data-t]'),function(el){ tqSetV(el.getAttribute('data-t'),String(el.value||'')); });
  var err=$('tqErr'); err.classList.remove('on');
  if(typeof TQ.r_overall!=='number'){ err.textContent='Please give the tour an overall rating (in “The tour”).'; err.classList.add('on'); var c=$('tqTourCard'); if(c) c.scrollIntoView({behavior:'smooth',block:'center'}); return; }
  var a=JSON.parse(JSON.stringify(TQ)), trips=tqTrips();
  if(!(Array.isArray(a.dests)&&a.dests.indexOf('Other')>=0)) delete a.destsOther;
  if(a.recommend==='No') delete a.say;
  var tr={}; Object.keys(a.trip||{}).forEach(function(i){ var v=a.trip[i]; if(trips[i]&&(v==='na'||typeof v==='number')) tr[trips[i].title]=v; }); a.trips=tr; delete a.trip;
  Object.keys(a).forEach(function(k){ if(a[k]===''||a[k]==null||(Array.isArray(a[k])&&!a[k].length)) delete a[k]; });
  a.v=TQ_VERSION; var body={v:TQ_VERSION, teacher:isTeacher()?me():'', a:a};
  var btn=$('tqSend'); btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> Sending…';
  fetch(API+'?type=tq',{method:'POST',headers:{'content-type':'application/json','x-staff-key':lsGet(LS.key)||''},body:JSON.stringify(body)})
    .then(function(r){ return r.json().then(function(j){ return {r:r,j:j}; }); }).then(function(x){
      btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Send my answers';
      if(!x.r.ok||!x.j.ok){ err.textContent=(x.j&&x.j.error)||('Not sent ('+x.r.status+')'); err.classList.add('on'); return; }
      lsSet(tqKey('done'),'1'); lsSet(tqKey('sent'),JSON.stringify(TQ)); lsSet(tqKey('draft'),null);
      rerenderPage('<div class="card rule" style="text-align:center;padding:28px 18px;margin-top:10px"><div class="tqthanks"><i class="ti ti-check"></i></div>'+
        '<h2>Thank <em>you</em></h2><p class="small muted" style="margin-top:8px">Your answers are with TCA Tours. Changed your mind about something? Open the questionnaire again from More and send it again: it replaces what you sent before.</p>'+
        '<button class="btn line" style="margin-top:16px" onclick="pageBack()">Back to More</button></div>');
    }).catch(function(){ btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Send my answers'; err.textContent='No signal, so it wasn’t sent. Your answers are saved on this phone: try again when you have signal.'; err.classList.add('on'); });
}

/* Pop-up for teachers: on opening the app, at most once a day, until they've sent it */
/* Shows straight away every time a teacher opens the app, until they've sent it. "Later" hides it until the next open
   (the app coming back after more than 10 minutes in the background counts as opening it again). */
var TQ_LATER=0;
function maybeAskQuestionnaire(){
  if(!isTeacher()||!me()||tqDone()) return;
  if(TQ_LATER && Date.now()-TQ_LATER<10*60000) return;
  if($('modal').classList.contains('on')) return;
  if($('s-page').classList.contains('active') && $('tqWrap')) return;   /* already filling it in */
  openModal('<p class="label">Thank you for travelling with us</p><h2 style="font-size:28px">Tour <em>questionnaire</em></h2>'+
    '<p class="small muted" style="margin:8px 0 14px">How did New York go? A few minutes of feedback from each teacher helps us make the next trip even better.</p>'+
    '<button class="btn gold" onclick="closeModal();openQuestionnaire()"><i class="ti ti-pencil"></i> Start · about 3 minutes</button><button class="btn ghost" onclick="TQ_LATER=Date.now();closeModal()">Later</button>');
}

/* ---------- results (TCA Tours staff) ---------- */
var TQR=null;
function openTqResults(){ TQR=null; tqPaintResults(false); fetch(API+'?type=tq',{headers:{'x-staff-key':lsGet(LS.key)||''},cache:'no-store'}).then(function(r){return r.json();}).then(function(j){ TQR=j; if($('tqRes')) tqPaintResults(true); }).catch(function(){ TQR={ok:false,error:'Needs signal to load the answers.'}; if($('tqRes')) tqPaintResults(true); }); }
function tqLabel(k){ var all=TQ_CORE.concat(TQ_DETAIL); for(var i=0;i<all.length;i++) if(all[i][0]===k) return all[i][1]; return k; }
/* Average with the working shown: "4.5 — (5 + 4) ÷ 2" */
function tqAvg(vals){ var n=vals.filter(function(v){return typeof v==='number';}); if(!n.length) return null; var t=n.reduce(function(a,b){return a+b;},0); return {avg:Math.round(t/n.length*10)/10, n:n.length, work:'('+n.join(' + ')+') ÷ '+n.length+' = '+(Math.round(t/n.length*100)/100)}; }
function tqRows(){ var j=TQR||{}; return (j.rows||[]).filter(function(r){ return TQR.showTest||!r.test; }); }
/* How a review is credited on the website, from the teacher's own permission answer */
function tqCredit(a){ var q=a.quoteOk||''; if(/name and school/.test(q)) return [a.name,a.school].filter(Boolean).join(', ');
  if(/school name only/.test(q)) return 'A teacher at '+(a.school||TQ_SCHOOL); if(/anonymous/.test(q)) return 'A teacher on the New York trip'; return ''; }
function tqCanUse(a){ return /^Yes/.test(a.quoteOk||''); }
function tqPaintResults(keep){
  var j=TQR, h='<p class="label">TCA Tours · teachers</p><h2>Questionnaire <em>results</em></h2><div id="tqRes">';
  if(!j) h+='<div class="card"><p class="small muted">Loading…</p></div>';
  else if(!j.ok) h+='<div class="card"><p class="small">'+esc(j.error||'Not allowed')+'</p></div>';
  else {
    var rows=tqRows(), teachers=j.teachers||[], answered={}; rows.forEach(function(r){ answered[r.teacher]=1; });
    var tests=(j.rows||[]).filter(function(r){return r.test;}).length, real=rows.filter(function(r){return !r.test;}).length;
    var rec=rows.filter(function(r){return r.a.recommend;}), recYes=rec.filter(function(r){return r.a.recommend==='Yes';}).length;
    h+='<div class="tiles" style="grid-template-columns:1fr 1fr"><div class="tile" style="min-height:0"><b class="num" style="font-size:28px">'+real+' of '+teachers.length+'</b><span>teachers answered</span></div>'+
      '<div class="tile" style="min-height:0"><b class="num" style="font-size:28px">'+(rec.length?recYes+' of '+rec.length:'—')+'</b><span>would recommend us</span></div></div>';
    var waiting=teachers.filter(function(t){return !answered[t];}); if(waiting.length) h+='<p class="small muted">Waiting for: '+waiting.map(esc).join(', ')+'</p>';
    if(tests) h+='<p class="small"><label><input type="checkbox" '+(j.showTest?'checked':'')+' onchange="TQR.showTest=this.checked;tqPaintResults(true)"> Include '+tests+' TCA test answer'+(tests>1?'s':'')+'</label></p>';
    if(rows.length){
      h+='<button class="btn dark" style="margin:10px 0" onclick="tqExport()"><i class="ti ti-table-down"></i> Export to Excel</button>'+
        '<p class="small muted">The first sheet has the same columns as the TCA feedback Google Form, so it pastes straight under the Skinners’ and Wycombe Abbey rows.</p>';
      /* Website reviews first: the main purpose */
      var ok=rows.filter(function(r){ return tqCanUse(r.a)&&(r.a.summary||r.a.say||r.a.stoodOut); });
      h+='<p class="label">For the website · '+ok.length+'</p>';
      h+=ok.length?ok.map(function(r){ var a=r.a, quote=a.summary||a.say||a.stoodOut;
          return '<div class="card rule"><p style="font-family:var(--display);font-size:19px;line-height:1.35">“'+esc(quote)+'”</p><p class="small" style="margin-top:8px"><b>— '+esc(tqCredit(a))+'</b></p>'+
            '<p class="small muted" style="margin-top:4px">'+esc(a.quoteOk)+(r.test?' · TEST':'')+'</p><p style="margin-top:8px"><button class="linkbtn" onclick="tqCopy('+jsArg('“'+quote+'”\n— '+tqCredit(a))+')"><i class="ti ti-copy"></i> Copy review</button></p></div>'; }).join('')
        :'<div class="card"><p class="small">No reviews cleared for the website yet.</p></div>';
      h+='<p class="label">Ratings · 1 to 5</p><table class="lb">'+TQ_CORE.concat(TQ_DETAIL.map(function(x){return [x[0],x[1]];})).map(function(q){
          var vals=rows.map(function(r){return r.a[q[0]];}), s=tqAvg(vals), na=vals.filter(function(v){return v==='na';}).length;
          return '<tr><td>'+esc(q[1])+(s?'<div class="small muted">'+esc(s.work)+'</div>':'')+(na?'<div class="small muted">'+na+' not for me</div>':'')+'</td><td class="sc" style="text-align:right">'+(s?s.avg+'<div class="small muted">'+s.n+' answer'+(s.n>1?'s':'')+'</div>':'—')+'</td></tr>'; }).join('')+'</table>';
      var tnames=[]; rows.forEach(function(r){ Object.keys(r.a.trips||{}).forEach(function(t){ if(tnames.indexOf(t)<0) tnames.push(t); }); });
      if(tnames.length){ h+='<p class="label">The trips</p><table class="lb">'+tnames.map(function(t){ var vals=rows.map(function(r){return (r.a.trips||{})[t];}), s=tqAvg(vals), na=vals.filter(function(v){return v==='na';}).length;
          return {t:t,s:s,na:na}; }).sort(function(a,b){ return ((b.s&&b.s.avg)||0)-((a.s&&a.s.avg)||0); }).map(function(x){
          return '<tr><td>'+esc(x.t)+(x.s?'<div class="small muted">'+esc(x.s.work)+'</div>':'')+(x.na?'<div class="small muted">'+x.na+' didn’t go</div>':'')+'</td><td class="sc" style="text-align:right">'+(x.s?x.s.avg:'—')+'</td></tr>'; }).join('')+'</table>'; }
      h+=tqCountBlock('Book again?',rows,'again')+tqCountBlock('Recommended spending money',rows,'spend')+tqCountBlock('Where next?',rows,'dests',true)+tqCountBlock('When?',rows,'when');
      var other=rows.filter(function(r){return r.a.destsOther;}); if(other.length) h+='<div class="card"><p class="small"><b>Other places:</b> '+other.map(function(r){ return esc(r.a.destsOther)+' <span class="muted">('+esc(r.teacher)+')</span>'; }).join('; ')+'</p></div>';
      h+='<p class="label">Every response</p>'+rows.map(function(r){ var a=r.a, bits=[['Sum up',a.summary],['Stood out',a.stoodOut],['Biggest impact',a.impact],['Would say to another school',a.say],['Comments & suggestions',a.improve]].filter(function(x){return x[1];});
        return '<div class="card rule"><div class="cardhead"><h3 style="font-size:19px">'+esc(r.teacher)+(r.test?' <span class="tag">Test</span>':'')+'</h3><span class="small muted">'+esc(ago(r.ts))+'</span></div>'+
          '<p class="small muted">'+esc(['Overall '+(a.r_overall||'—')+'/5','Recommend: '+(a.recommend||'—'),'Quote: '+(a.quoteOk||'not answered')].join(' · '))+'</p>'+
          (bits.length?bits.map(function(x){ return '<p class="small" style="margin-top:6px"><b>'+esc(x[0])+':</b> '+esc(x[1])+'</p>'; }).join(''):'<p class="small muted">No comments.</p>')+
          '<p style="margin-top:8px"><button class="linkbtn" onclick="tqDelete('+jsArg(r.key)+','+jsArg(r.teacher)+')">Delete this response</button></p></div>'; }).join('');
    } else h+='<div class="card"><p class="small">No answers yet. Teachers see the questionnaire under More, and a reminder when they open the app.</p></div>';
    h+='<p class="small muted" style="margin-top:10px"><button class="linkbtn" onclick="openTqResults()">Refresh</button></p>';
  }
  h+='</div>';
  if(keep) rerenderPage(h); else openPage(h,openTqResults);
}
function tqCopy(t){ try{ navigator.clipboard.writeText(t).then(function(){ toast('Review copied'); },function(){ prompt('Copy this review:',t); }); }catch(e){ prompt('Copy this review:',t); } }
function tqCountBlock(title,rows,k,multi){
  var c={}, n=0; rows.forEach(function(r){ var v=r.a[k]; if(v==null) return; n++; (multi?v:[v]).forEach(function(x){ c[x]=(c[x]||0)+1; }); });
  if(!n) return ''; return '<p class="label">'+esc(title)+'</p><div class="card"><p class="small">'+Object.keys(c).sort(function(a,b){return c[b]-c[a];}).map(function(x){ return esc(x)+' <b>'+c[x]+'</b>'; }).join(' · ')+'</p><p class="small muted">from '+n+' answer'+(n>1?'s':'')+'</p></div>';
}
function tqDelete(key,name){
  if(!confirm('Delete '+name+'’s answers? They can send them again.')) return;
  fetch(API+'?type=tqdel',{method:'POST',headers:{'content-type':'application/json','x-staff-key':lsGet(LS.key)||''},body:JSON.stringify({key:key})})
    .then(function(r){ if(r.ok){ toast('Deleted'); openTqResults(); } else toast('Could not delete ('+r.status+')'); }).catch(function(){ toast('Needs signal'); });
}
function tqExport(){
  var rows=tqRows(); if(!rows.length) return;
  var go=function(){
    var X=window.XLSX;
    /* Sheet 1: the same columns, in the same order, as TCA's feedback Google Form */
    var head=['Timestamp','Overall, how satisfied were you with your TCA tour experience? (1 = Very Dissatisfied - 5 = Extremely satisfied)',
      'How satisfied are you that the tour achieved its objectives? For example, player / student development, cultural experiences etc. (1 = Very Dissatisfied - 5 = Extremely satisfied)',
      'How satisfied were you with our communication, organisation and on-tour support? (1 = Very Dissatisfied - 5 = Very Satisfied)',
      'What stood out about this tour for you and your players / students?','What was the biggest impact of this trip on your players / students?',
      'Would you recommend TCA Sports Tours to another school or club?','If yes, what would you say to another school / club considering this tour?',
      'Do you have any additional comments or suggestions about the tour or your experience?',
      'Are you happy for us to use your comments in our promotional material (website, social media, brochure, etc).?','Name','School / Organisation',
      'Summary of the trip and working with TCA Tours (website review)','Credit line for the website','Test?'];
    var aoa=[head].concat(rows.map(function(r){ var a=r.a; return [new Date(r.ts).toLocaleString('en-GB',{timeZone:'Europe/London'}),a.r_overall||'',a.r_objectives||'',a.r_support||'',
      a.stoodOut||'',a.impact||'',a.recommend||'',a.say||'',a.improve||'',a.quoteOk||'',a.name||r.teacher,a.school||'',a.summary||'',tqCanUse(a)?tqCredit(a):'Not for the website',r.test?'Yes':'']; }));
    /* Sheet 2: the optional detail */
    var det=[['Teacher'].concat(TQ_DETAIL.map(function(q){return q[1]+' (1–5)';}),['Spending money','Book again?','Where next','Other places','When'])].concat(rows.map(function(r){ var a=r.a;
      return [r.teacher].concat(TQ_DETAIL.map(function(q){ var v=a[q[0]]; return v==='na'?'n/a':(v==null?'':v); }),[a.spend||'',a.again||'',(a.dests||[]).join(', '),a.destsOther||'',a.when||'']); }));
    var tnames=[]; rows.forEach(function(r){ Object.keys(r.a.trips||{}).forEach(function(t){ if(tnames.indexOf(t)<0) tnames.push(t); }); });
    var trips=[['Trip'].concat(rows.map(function(r){return r.teacher;}),['Average','Working'])].concat(tnames.map(function(t){
      var vals=rows.map(function(r){ var v=(r.a.trips||{})[t]; return v==='na'?'Didn’t go':(v==null?'':v); }), s=tqAvg(rows.map(function(r){return (r.a.trips||{})[t];}));
      return [t].concat(vals,[s?s.avg:'',s?s.work:'']); }));
    var wb=X.utils.book_new(); X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(aoa),'Form Responses'); X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(det),'Detail'); X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(trips),'Trips');
    var v=(parseInt(lsGet('hny_tqdl'),10)||0)+1; lsSet('hny_tqdl',String(v));
    X.writeFile(wb,'Holmfirth_NYC_Teacher_Questionnaire_v'+v+'.xlsx');
  };
  if(window.XLSX) go(); else { var s2=document.createElement('script'); s2.src='vendor/xlsx-0.18.5.full.min.js'; s2.onload=go; s2.onerror=function(){ toast('Couldn’t load the spreadsheet maker'); }; document.head.appendChild(s2); }
}

/* This script loads after the app has started, so ask now if a teacher is already signed in */
if(!$('app').classList.contains('locked')) maybeAskQuestionnaire();
document.addEventListener('visibilitychange',function(){
  if(document.hidden){ window._tqHiddenAt=Date.now(); return; }
  if(window._tqHiddenAt && Date.now()-window._tqHiddenAt>10*60000){ TQ_LATER=0; maybeAskQuestionnaire(); }
});
