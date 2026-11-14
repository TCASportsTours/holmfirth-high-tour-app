/* TCA Tours — testimonials & photos for tcatours.co.uk, v1.
   Paste once into the website, where they should appear:

     <div data-tca-testimonials></div>
     <div data-tca-photos></div>
     <script src="https://feedback.tcatours.co.uk/embed/tca-feedback.js" async></script>

   Whatever TCA adds on the feedback results page ("Add to website") shows here automatically; "Remove" takes it off.
   Options on the divs: data-limit="6" (how many to show). Styles are scoped to .tcafb-* so they don't affect the site. */
(function(){
  'use strict';
  var me = document.currentScript || [].slice.call(document.getElementsByTagName('script')).filter(function(s){ return /tca-feedback\.js/.test(s.src); })[0];
  var ORIGIN = me ? new URL(me.src).origin : 'https://feedback.tcatours.co.uk';
  var API = ORIGIN + '/.netlify/functions/tour';
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function css(){
    if(document.getElementById('tcafb-css')) return;
    var st=document.createElement('style'); st.id='tcafb-css';
    st.textContent=
      '.tcafb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:18px;margin:0;padding:0}'+
      '.tcafb-q{background:#fff;border:1px solid #DDDCDC;padding:22px 20px;position:relative;margin:0}'+
      '.tcafb-q:before{content:"";position:absolute;left:-1px;top:-1px;width:3px;height:52px;background:#EFCA50}'+
      '.tcafb-q blockquote{margin:0;font-family:"Cormorant Garamond",Garamond,Georgia,serif;font-size:21px;line-height:1.35;color:#414042;font-style:italic}'+
      '.tcafb-q figcaption{margin-top:12px;font-family:"Work Sans",system-ui,Arial,sans-serif;font-size:14px;font-weight:600;color:#414042}'+
      '.tcafb-q figcaption span{display:block;font-weight:400;font-size:12.5px;color:#6E6D70;margin-top:2px}'+
      '.tcafb-ph{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}'+
      '.tcafb-ph figure{margin:0;background:#fff;border:1px solid #DDDCDC}'+
      '.tcafb-ph img{display:block;width:100%;aspect-ratio:4/3;object-fit:cover;background:#F4F3F1}'+
      '.tcafb-ph figcaption{font-family:"Work Sans",system-ui,Arial,sans-serif;font-size:13px;color:#414042;padding:8px 10px}'+
      '.tcafb-ph figcaption span{display:block;color:#6E6D70;font-size:12px}';
    document.head.appendChild(st);
  }
  function load(type,cb){ fetch(API+'?type='+type,{cache:'no-cache'}).then(function(r){return r.json();}).then(function(j){ cb((j&&j.items)||[]); }).catch(function(){ cb([]); }); }
  function lim(el,list){ var n=parseInt(el.getAttribute('data-limit'),10); return n>0?list.slice(0,n):list; }
  var T=[].slice.call(document.querySelectorAll('[data-tca-testimonials]')), P=[].slice.call(document.querySelectorAll('[data-tca-photos]'));
  if(!T.length && !P.length) return;
  css();
  if(T.length) load('pubreviews',function(items){ T.forEach(function(el){ var l=lim(el,items);
    el.innerHTML=l.length?'<div class="tcafb-grid">'+l.map(function(x){
      return '<figure class="tcafb-q"><blockquote>“'+esc(x.quote)+'”</blockquote><figcaption>'+esc(x.credit)+(x.tour?'<span>'+esc(x.tour)+'</span>':'')+'</figcaption></figure>'; }).join('')+'</div>':''; }); });
  if(P.length) load('pubphotos',function(items){ P.forEach(function(el){ var l=lim(el,items);
    el.innerHTML=l.length?'<div class="tcafb-ph">'+l.map(function(x){
      return '<figure><img src="'+esc(x.src)+'" alt="'+esc(x.caption||('Photo from '+(x.tour||'a TCA Tours trip')))+'" loading="lazy"><figcaption>'+esc(x.caption||'')+(x.tour?'<span>'+esc(x.tour)+'</span>':'')+'</figcaption></figure>'; }).join('')+'</div>':''; }); });
})();
