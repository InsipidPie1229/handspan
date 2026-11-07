// Theme: follows the OS until the viewer picks one; the pick is remembered in this browser.
(()=>{
  const root=document.documentElement,KEY='hs-theme';
  let saved=null;try{saved=localStorage.getItem(KEY)}catch(e){}
  if(saved==='dark'||saved==='light')root.dataset.theme=saved;
  const isDark=()=>root.dataset.theme?root.dataset.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches;
  function label(btn){const d=isDark();btn.textContent=d?root.dataset.tLight:root.dataset.tDark;btn.setAttribute('aria-label',d?root.dataset.tToLight:root.dataset.tToDark)}
  addEventListener('DOMContentLoaded',()=>{
    const btn=document.getElementById('themeBtn');
    if(btn){
      label(btn);
      btn.addEventListener('click',()=>{const next=isDark()?'light':'dark';root.dataset.theme=next;try{localStorage.setItem(KEY,next)}catch(e){};label(btn);dispatchEvent(new Event('themechange'))});
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{label(btn);dispatchEvent(new Event('themechange'))});
    }
    document.querySelectorAll('.lang a').forEach(a=>{
      if(a.getAttribute('aria-current')==='true')return;
      a.addEventListener('click',e=>{
        if(!location.search)return;
        e.preventDefault();
        location.href=a.href+location.search;
      });
    });
  });
})();
