/* TCA Tours — tour questionnaires on their own links, v1.
   /feedback/teachers  (window.FB_KIND = 'teacher')  ·  /feedback/students  (window.FB_KIND = 'student')
   No sign-in. Answers go to the tour app's backend (?type=feedback) and are collected on the password-protected
   results page /sheet (with Download as Excel).
   Photos are optional: shrunk on the phone, uploaded as soon as they're picked, then sent with the answers.
   A draft is kept on the device, so half-finished answers survive closing the page.
   Link options: ?t=<teacher name> (from inside the tour app: fills in the name and marks it done in the app),
   ?test=1 (TCA preview: marked as a test).
   v2: past tours get their own links (e.g. /sallynook/teachers/). The page sets window.FB_PAST = {key, tour, trips, noApp}
   and the answers are filed under that tour in the same master results (feedback.tcatours.co.uk). */
(function(){
'use strict';
var KIND = window.FB_KIND === 'teacher' ? 'teacher' : 'student';
var API = '/.netlify/functions/tour';
var MAX_PHOTOS = 6;
var Q = new URLSearchParams(location.search);
var APP_TEACHER = Q.get('t') || '';
var TEST = Q.get('test') === '1';
var PAST = window.FB_PAST || null;
var DRAFT = 'tcafb_' + (PAST ? PAST.key + '_' : '') + KIND + '_draft';
var A = {}, PHOTOS = [], TOUR = null, EVENTS = [];

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
function ls(k,v){ try{ if(v===undefined) return localStorage.getItem(k); if(v===null) localStorage.removeItem(k); else localStorage.setItem(k,v); }catch(e){ return null; } }

/* ---------- questions ---------- */
var CORE_T = [['r_overall','Overall, how satisfied were you with your TCA Tours experience?','',true],
  ['r_objectives','How satisfied are you that the trip achieved its objectives?','For example student development, business learning, cultural experiences'],
  ['r_support','How satisfied were you with our communication, organisation and on-tour support?','']];
var DETAIL_T = [['r_itin','The itinerary & pace of each day'],['r_hostel','Accommodation'],['r_flights','Flights'],['r_coach','Coach transfers'],['r_value','Value for money'],['r_app','The tour app']];
var QUOTE_T = ['Yes, with my name and school','Yes, with the school name only','Yes, but anonymously','No thanks'];
var QUOTE_S = ['Yes, with my first name and school','Yes, but anonymously','No thanks'];

/* The trips worth rating: activities, events, free time and dinner venues (not travel, notes, breakfasts or staff-only rows) */
function trips(){
  var seen={}, out=[];
  EVENTS.forEach(function(e){
    if(e.staffOnly||e.tcaOnly) return;
    var ok=/^(Activity|Event|Free time)$/i.test(e.type||'') || (/^Food$/i.test(e.type||'') && !/breakfast|lunch|eat locally/i.test(e.title||''));
    if(!ok || /^arrive at/i.test(e.title||'')) return;
    var k=String(e.title).toLowerCase(); if(seen[k]) return; seen[k]=1; out.push({title:e.title, day:e.day});
  });
  return out;
}

/* ---------- building blocks ---------- */
function card(icon,title,body,opts){ opts=opts||{}; return '<section class="card"'+(opts.id?' id="'+opts.id+'"':'')+'><div class="head"><i class="ti '+icon+'"></i><h3>'+title+(opts.optional?' <span class="opt">Optional</span>':'')+'</h3></div>'+body+'</section>'; }
function q(text,hint,req){ return '<p class="q">'+esc(text)+(req?' <span class="req">*</span>':'')+'</p>'+(hint?'<p class="hint">'+esc(hint)+'</p>':''); }
function get(k){ var p=k.split('.'), o=A; for(var i=0;i<p.length;i++){ if(o==null) return undefined; o=o[p[i]]; } return o; }
function set(k,v){ var p=k.split('.'), o=A; for(var i=0;i<p.length-1;i++){ if(!o[p[i]]||typeof o[p[i]]!=='object') o[p[i]]={}; o=o[p[i]]; } if(v===undefined) delete o[p[p.length-1]]; else o[p[p.length-1]]=v; }
function stars(k,na){ var v=get(k), h='<div class="stars" data-k="'+k+'">';
  for(var i=1;i<=5;i++){ var on=typeof v==='number'&&v>=i; h+='<button type="button" data-s="'+i+'" aria-label="'+i+' out of 5" class="'+(on?'on':'')+'"><i class="ti ti-star'+(on?'-filled':'')+'"></i></button>'; }
  if(na) h+='<button type="button" data-s="na" class="na'+(v==='na'?' on':'')+'">'+esc(na)+'</button>';
  return h+'</div>'; }
/* Teachers: an optional comment under a rating. Opens by itself for 1 or 2 stars. Saved as cm_<rating> (trips: cm_trip_<n>). */
function cmKey(k){ return 'cm_'+String(k).replace(/\./g,'_'); }
function cmt(k){ var ck=cmKey(k), v=get(ck)||'', low=typeof get(k)==='number'&&get(k)<=2, open=!!v||low;
  return '<div class="cmt" data-for="'+k+'"><button type="button" class="cmtbtn" data-cmt="'+k+'"'+(open?' hidden':'')+'><i class="ti ti-message-plus"></i> Add a comment (optional)</button>'+
    '<textarea class="field" data-t="'+ck+'" rows="2" maxlength="1000"'+(open?'':' hidden')+' placeholder="'+(low?'Sorry to hear that. What went wrong?':'Optional: anything you’d like to add?')+'">'+esc(v)+'</textarea></div>'; }
function openCmt(k,low){ var box=document.querySelector('.cmt[data-for="'+k+'"]'); if(!box) return; var t=box.querySelector('textarea'), b=box.querySelector('button');
  if(low) t.placeholder='Sorry to hear that. What went wrong?'; t.hidden=false; b.hidden=true; return t; }
function chips(k,opts,multi){ var v=get(k); return '<div class="chips" data-k="'+k+'"'+(multi?' data-multi="1"':'')+'>'+opts.map(function(o){
  var on=multi?(Array.isArray(v)&&v.indexOf(o)>=0):v===o; return '<button type="button" class="'+(on?'on':'')+'" data-v="'+esc(o)+'">'+esc(o)+'</button>'; }).join('')+'</div>'; }
function text(k,ph,rows){ var v=get(k)||''; return rows?'<textarea class="field" data-t="'+k+'" rows="'+rows+'" placeholder="'+esc(ph)+'">'+esc(v)+'</textarea>':'<input class="field" data-t="'+k+'" placeholder="'+esc(ph)+'" value="'+esc(v)+'">'; }

/* ---------- the form ---------- */
function render(){
  var t=TOUR||{}, school=t['School']||'Holmfirth High School', tl=trips(), h='';
  if(A.school==null) A.school=school;
  if(KIND==='teacher' && !A.name && APP_TEACHER) A.name=APP_TEACHER;
  h+='<p class="label">'+esc(t['Tour Name']||'Your trip')+'</p>'+
    '<h1>'+(KIND==='teacher'?'Teacher <em>questionnaire</em>':'How was <em>your trip?</em>')+'</h1>'+
    '<p class="intro">'+(KIND==='teacher'
      ?'Thank you for travelling with TCA Tours. About three minutes; the optional details take another two. Only the starred questions are needed.'
      :'Tell us what you thought of the trip. It takes about two minutes. Only the starred questions are needed.')+'</p>'+
    (TEST?'<p class="banner"><i class="ti ti-eye"></i> Preview: anything you send is marked as a test.</p>':'');

  if(KIND==='teacher'){
    h+=card('ti-user','About you', q('Your name','As you’d like it shown if we quote you',true)+text('name','e.g. Alexander Hamilton')+q('School','')+text('school','School name'));
    h+=card('ti-star','Your rating','<p class="hint">1 = very dissatisfied, 5 = extremely satisfied.</p>'+CORE_T.map(function(r){ return q(r[1],r[2],r[3])+stars(r[0])+cmt(r[0]); }).join(''),{id:'cRating'});
    h+=card('ti-school','The trip',q('What stood out about this trip for you and your students?','')+text('stoodOut',PAST?'e.g. a place, a moment, a person you met…':'e.g. the business tour, the hockey game…',3)+
      q('What was the biggest impact of this trip on your students?','')+text('impact','What did they take away from it?',3));
    h+=card('ti-message-heart','Your review',q('Would you recommend TCA Tours to another school?','')+chips('recommend',['Yes','No'])+
      '<div id="wSay">'+q('What would you say to another school considering this trip?','')+text('say','e.g. Use TCA Tours because…',3)+'</div>'+
      q('Sum up the trip and working with TCA Tours in a few sentences','This is the comment we’d love to use on our website')+text('summary','Your thoughts on the trip, and on working with TCA Tours',5)+
      q('Are you happy for us to use your comments on our website and social media?','')+chips('quoteOk',QUOTE_T));
    h+=card('ti-adjustments','More detail','<p class="hint">For the TCA Tours team only: none of this goes on the website.</p>'+
      DETAIL_T.filter(function(r){ return !(PAST&&PAST.noApp&&r[0]==='r_app'); }).map(function(r){ return q(r[1],'')+stars(r[0],'Not for me')+cmt(r[0]); }).join('')+
      (tl.length?q('Rate the trips and venues','Tap “Didn’t go” for any your group missed')+tl.map(function(x,i){ return '<div class="trip"><p>'+esc(x.title)+(x.day?'<span>Day '+esc(x.day)+'</span>':'')+'</p>'+stars('trip.'+i,'Didn’t go')+cmt('trip.'+i)+'</div>'; }).join(''):'')+
      q('How much spending money would you recommend for students next time?','For the whole trip')+chips('spend',['Under $100','$100–$200','$200–$300','$300–$400','Over $400'])+
      q('Any additional comments or suggestions?','Anything we could do better: it helps')+text('improve','Be honest',3)+
      q('Would you book another trip with TCA Tours?','')+chips('again',['Yes','Maybe','No'])+
      q('Where might your school like to go next?','Pick New York, or tell us where')+chips('dests',['New York again','Other'],true)+
      '<div id="wDest">'+text('destsOther','Where would you like to go?')+'</div>'+
      q('When might that be?','')+chips('when',['2027–28','2028–29','Later','Not sure']),{optional:true});
  } else {
    h+=card('ti-user','About you', q('Your name','First name and surname',true)+text('name','e.g. Alexander Hamilton')+q('School','')+text('school','School name'));
    h+=card('ti-star','The trip',q('How would you rate the trip overall?','1 = poor, 5 = amazing',true)+stars('r_overall')+
      (tl.length?q('Rate the trips and places you visited','Tap “Didn’t go” for any you missed')+tl.map(function(x,i){ return '<div class="trip"><p>'+esc(x.title)+(x.day?'<span>Day '+esc(x.day)+'</span>':'')+'</p>'+stars('trip.'+i,'Didn’t go')+'</div>'; }).join(''):'')+
      q('What was the best bit?','')+text('best','The thing you’ll remember most',3)+
      q('Is there anything you’d change?','')+text('change','Be honest: it helps us',2)+
      q('Would you recommend this trip to a friend?','')+chips('recommend',['Yes','Maybe','No']),{id:'cRating'});
    h+=card('ti-message-heart','Your comment',q('How would you describe the trip to a friend?','A sentence or two')+text('summary','e.g. The best week ever because…',3)+
      q('Can we use your comment on our website and social media?','Please check with your parent or guardian first')+chips('quoteOk',QUOTE_S));
  }
  h+=card('ti-photo','Your photos',
    '<p class="hint" style="font-size:13.5px;color:var(--charcoal)">Totally optional: share up to '+MAX_PHOTOS+' of your best photos from the trip, if you’d like to. You can skip this.</p>'+
    '<div class="photos" id="phList"></div>'+
    '<label class="addph" id="phAdd"><i class="ti ti-camera-plus"></i> Add photos<input type="file" id="phFile" accept="image/*" multiple hidden></label>'+
    '<div id="phPerm"></div>',{optional:true});
  h+='<div class="err" id="err"></div><button class="btn gold" id="send" style="margin-top:16px"><i class="ti ti-send"></i> Send my answers</button>'+
    '<p class="hint" style="text-align:center;margin-top:10px">Your answers go to TCA Tours only.</p>';
  $('main').innerHTML=h;
  paintPhotos(); conditionals();
}
function conditionals(){
  var show=function(id,on){ var o=$(id); if(o) o.style.display=on?'':'none'; };
  show('wSay',A.recommend!=='No'); show('wDest',Array.isArray(A.dests)&&A.dests.indexOf('Other')>=0);
}
function save(){ ls(DRAFT,JSON.stringify({a:A,photos:PHOTOS.filter(function(p){return p.id;}).map(function(p){ return {id:p.id,cap:p.cap,thumb:p.thumb}; })})); }

/* ---------- photos ---------- */
function paintPhotos(){
  var list=$('phList'); if(!list) return;
  list.innerHTML=PHOTOS.map(function(p,i){
    var st=p.st==='up'?'Uploading…':p.st==='bad'?'Didn’t upload: remove it and try again':'Added';
    return '<div class="ph'+(p.st==='bad'?' bad':'')+'"><img src="'+p.thumb+'" alt=""><div><div class="st"><span>'+st+'</span><button type="button" data-rm="'+i+'">Remove</button></div>'+
      '<input class="field" data-cap="'+i+'" placeholder="Caption (optional)" value="'+esc(p.cap||'')+'" maxlength="300"></div></div>'; }).join('');
  $('phAdd').style.display=PHOTOS.length>=MAX_PHOTOS?'none':'';
  var perm=$('phPerm');
  if(!PHOTOS.length){ perm.innerHTML=''; return; }
  var kidNote=KIND==='student'?'Please check with your parent or guardian before saying yes.':'';
  perm.innerHTML=q('Can we post your photos on our website and social media?',kidNote,true)+chips('photoOk',['Yes','No'])+
    '<div id="wOthers"'+(A.photoOk==='Yes'?'':' style="display:none"')+'><label class="tick"><input type="checkbox" id="othersOk"'+(A.othersOk?' checked':'')+'><span>'+
    (KIND==='student'
      ?'If there’s anyone else in my photos, I have permission from them and their parents for the photos to be used.'
      :'If there’s anyone else in my photos, including students, I have permission for the photos to be used (for example, through the school’s photo consent list).')+
    '</span></label></div>';
}
function shrink(file,cb,fail){
  var url=URL.createObjectURL(file), img=new Image();
  img.onload=function(){
    var draw=function(max,qual){ var s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)), c=document.createElement('canvas');
      c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s); var g=c.getContext('2d'); g.fillStyle='#fff'; g.fillRect(0,0,c.width,c.height); g.drawImage(img,0,0,c.width,c.height); return c.toDataURL('image/jpeg',qual); };
    var big=draw(1600,0.82), thumb=draw(200,0.7); URL.revokeObjectURL(url); cb(big,thumb);
  };
  img.onerror=function(){ URL.revokeObjectURL(url); fail(); };
  img.src=url;
}
function addFiles(files){
  Array.prototype.slice.call(files||[]).forEach(function(f){
    if(PHOTOS.length>=MAX_PHOTOS) return;
    if(!/^image\//.test(f.type) && !/\.(heic|heif)$/i.test(f.name)) return;
    var p={st:'up',cap:'',thumb:''}; PHOTOS.push(p);
    shrink(f,function(big,thumb){ p.thumb=thumb; paintPhotos();
      fetch(API+'?type=fbphoto',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:KIND,name:f.name.replace(/\.(heic|heif|png|webp)$/i,'.jpg'),data:big})})
        .then(function(r){ return r.json(); }).then(function(j){ if(j&&j.ok){ p.id=j.id; p.st='ok'; } else p.st='bad'; paintPhotos(); save(); })
        .catch(function(){ p.st='bad'; paintPhotos(); });
    },function(){ PHOTOS.splice(PHOTOS.indexOf(p),1); paintPhotos(); alert('That photo couldn’t be read. Try a different one, or a screenshot of it.'); });
  });
  paintPhotos();
}

/* ---------- events ---------- */
function onClick(e){
  var b=e.target.closest('button'); if(!b) return;
  if(b.id==='send'){ submit(); return; }
  if(b.hasAttribute('data-cmt')){ var tx=openCmt(b.getAttribute('data-cmt')); if(tx) tx.focus(); return; }
  if(b.hasAttribute('data-rm')){ PHOTOS.splice(Number(b.getAttribute('data-rm')),1); paintPhotos(); save(); return; }
  var box=b.parentNode, k=box.getAttribute('data-k'); if(!k) return;
  if(box.classList.contains('stars')){ var s=b.getAttribute('data-s'), v=s==='na'?'na':Number(s); set(k,get(k)===v?undefined:v); var cur=get(k);
    [].forEach.call(box.querySelectorAll('button'),function(x){ var xs=x.getAttribute('data-s'), on=xs==='na'?cur==='na':(typeof cur==='number'&&cur>=Number(xs)); x.classList.toggle('on',on); var i=x.querySelector('i'); if(i) i.className='ti ti-star'+(on?'-filled':''); });
    if(typeof cur==='number'&&cur<=2) openCmt(k,true); }
  else if(box.classList.contains('chips')){ var val=b.getAttribute('data-v');
    if(box.getAttribute('data-multi')){ var arr=Array.isArray(get(k))?get(k).slice():[], i2=arr.indexOf(val); if(i2>=0) arr.splice(i2,1); else arr.push(val); set(k,arr); b.classList.toggle('on',i2<0); }
    else { var nv=get(k)===val?undefined:val; set(k,nv); [].forEach.call(box.querySelectorAll('button'),function(x){ x.classList.toggle('on',x.getAttribute('data-v')===nv); }); }
    if(k==='photoOk'){ var w=$('wOthers'); if(w) w.style.display=A.photoOk==='Yes'?'':'none'; } }
  save(); conditionals();
}
function onInput(e){
  var t=e.target;
  if(t.hasAttribute('data-t')){ set(t.getAttribute('data-t'),String(t.value||'')); save(); }
  else if(t.hasAttribute('data-cap')){ var p=PHOTOS[Number(t.getAttribute('data-cap'))]; if(p){ p.cap=t.value; save(); } }
  else if(t.id==='othersOk'){ A.othersOk=t.checked; save(); }
}
function fail(msg,scrollTo){ var e=$('err'); e.textContent=msg; e.classList.add('on'); var el=scrollTo&&$(scrollTo); (el||e).scrollIntoView({behavior:'smooth',block:'center'}); }
function submit(){
  [].forEach.call(document.querySelectorAll('[data-t]'),function(el){ set(el.getAttribute('data-t'),String(el.value||'')); });
  var oc=$('othersOk'); if(oc) A.othersOk=oc.checked;
  $('err').classList.remove('on');
  if(!String(A.name||'').trim()) return fail('Please put your name (in “About you”).');
  if(typeof A.r_overall!=='number') return fail('Please give the trip an overall rating.','cRating');
  if(PHOTOS.some(function(p){return p.st==='up';})) return fail('Hang on: your photos are still uploading.');
  if(PHOTOS.some(function(p){return p.st==='bad';})) return fail('A photo didn’t upload. Remove it, or add it again.');
  var ph=PHOTOS.filter(function(p){return p.id;});
  if(ph.length && !A.photoOk) return fail('Please say whether we can post your photos (or remove them).','phPerm');
  if(ph.length && A.photoOk==='Yes' && !A.othersOk) return fail('Please tick the box about anyone else in your photos, or choose No.','phPerm');
  var a=JSON.parse(JSON.stringify(A)), tl=trips();
  var tr={}; Object.keys(a.trip||{}).forEach(function(i){ var v=a.trip[i]; if(tl[i]&&(v==='na'||typeof v==='number')) tr[tl[i].title]=v; }); a.trips=tr; delete a.trip;
  var tc={}; Object.keys(a).forEach(function(k){ var m=k.match(/^cm_trip_(\d+)$/); if(m){ if(tl[m[1]]&&String(a[k]).trim()) tc[tl[m[1]].title]=String(a[k]).trim(); delete a[k]; } });
  if(Object.keys(tc).length) a.tripComments=tc;
  Object.keys(a).forEach(function(k){ if(/^cm_/.test(k)) a[k]=String(a[k]).trim(); });
  if(!(Array.isArray(a.dests)&&a.dests.indexOf('Other')>=0)) delete a.destsOther;
  if(a.recommend==='No') delete a.say;
  if(!ph.length){ delete a.photoOk; delete a.othersOk; } else if(a.photoOk!=='Yes') delete a.othersOk;
  Object.keys(a).forEach(function(k){ if(a[k]===''||a[k]==null||(Array.isArray(a[k])&&!a[k].length)) delete a[k]; });
  var btn=$('send'); btn.disabled=true; btn.innerHTML='<i class="ti ti-loader"></i> Sending…';
  fetch(API+'?type=feedback',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({kind:KIND,a:a,photos:ph.map(function(p){return {id:p.id,cap:String(p.cap||'').trim()};}),source:APP_TEACHER?'App':'Link',test:TEST,tourKey:PAST?PAST.key:undefined})})
    .then(function(r){ return r.json().then(function(j){ return {r:r,j:j}; }); }).then(function(x){
      btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Send my answers';
      if(!x.r.ok||!x.j.ok) return fail((x.j&&x.j.error)||('Not sent ('+x.r.status+'). Please try again.'));
      ls(DRAFT,null); ls('tcafb_'+(PAST?PAST.key+'_':'')+KIND+'_sent',String(Date.now()));
      if(APP_TEACHER) ls('hny_tq_done_'+APP_TEACHER,'1');   /* the tour app stops asking this teacher */
      $('main').innerHTML='<section class="card done"><div class="ic"><i class="ti ti-check"></i></div><h1>Thank <em>you</em></h1>'+
        '<p class="intro">Your answers are with TCA Tours.'+(ph.length?' So are your '+ph.length+' photo'+(ph.length>1?'s':'')+'.':'')+'</p>'+
        (APP_TEACHER?'<a class="btn line" href="/">Back to the tour app</a>':'')+'</section>';
      window.scrollTo(0,0);
    }).catch(function(){ btn.disabled=false; btn.innerHTML='<i class="ti ti-send"></i> Send my answers'; fail('No connection, so it wasn’t sent. Your answers are saved on this device: try again when you have signal.'); });
}

/* ---------- start ---------- */
try{ var d=JSON.parse(ls(DRAFT)||'null'); if(d){ A=d.a||{}; PHOTOS=(d.photos||[]).map(function(p){ return {id:p.id,cap:p.cap,thumb:p.thumb,st:'ok'}; }); } }catch(e){}
document.addEventListener('click',onClick); document.addEventListener('input',onInput); document.addEventListener('change',function(e){ if(e.target.id==='phFile'){ addFiles(e.target.files); e.target.value=''; } else onInput(e); });
if(PAST){ TOUR=PAST.tour||{}; EVENTS=(PAST.trips||[]).map(function(t){ return {title:t,type:'Activity',day:''}; }); render(); }
else fetch(API,{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){ if(j&&j.tour){ TOUR=j.tour; EVENTS=j.events||[]; } })
  .catch(function(){})
  .then(function(){ if(!TOUR&&window.TOUR_DEFAULT){ TOUR=window.TOUR_DEFAULT.tour; EVENTS=window.TOUR_DEFAULT.events||[]; } render(); });
})();
