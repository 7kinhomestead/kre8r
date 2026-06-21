/* =============================================================
   7 KIN HOMESTEAD — Course XP Engine (reusable / data-driven)
   Config is injected by theme.liquid as window.RR_COURSE, built
   from the course's OWN modules + lessons. Works on any course,
   no per-course editing. Accent color comes from --accent.
   ============================================================= */
(function(){
  var C        = window.RR_COURSE || { storeKey:'7kin_course', xpPerLesson:40, lessons:[], modules:[] };
  var STORE_KEY= C.storeKey || '7kin_course';
  var XP_PER   = C.xpPerLesson || 40;
  var EMOJIS   = ['🌱','⛏️','🧭','🔋','🏆','⚡','🛠️','🌾','🏡','🔥','🚜','🪵'];
  var ACCENT   = (getComputedStyle(document.documentElement).getPropertyValue('--accent')||'').trim() || '#ffb400';

  /* Build lookup tables from the injected config */
  var LESSON_MAP = {}, MOD_COUNTS = {};
  (C.lessons||[]).forEach(function(l){
    LESSON_MAP[String(l.id)] = { mod:l.mod, xp:XP_PER, label:l.label };
    MOD_COUNTS[l.mod] = (MOD_COUNTS[l.mod]||0) + 1;
  });
  var TOTAL_XP = (C.lessons||[]).length * XP_PER;
  var BADGES = {};
  (C.modules||[]).forEach(function(name, i){ BADGES[i] = { name:name, em:EMOJIS[i % EMOJIS.length] }; });

  function getS(){ try{ return JSON.parse(localStorage.getItem(STORE_KEY)||'{}'); }catch(e){ return {}; } }
  function setS(s){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(s)); }catch(e){} }

  function syncNav(){
    var s=getS(); var xp=s.xp||0;
    var pct = TOTAL_XP ? Math.min(100,(xp/TOTAL_XP)*100).toFixed(1) : 0;
    var fill=document.getElementById('nav-xp-fill'),
        label=document.getElementById('nav-xp-label'),
        badgeEl=document.getElementById('nav-badge-count');
    if(fill)  fill.style.width = pct + '%';
    if(label) label.textContent = xp + ' / ' + TOTAL_XP + ' XP';
    if(badgeEl){ var b=(s.badges||[]).length; badgeEl.textContent = '🏅 ' + b + ' badge' + (b===1?'':'s'); }
  }

  function toast(html, dur){
    var el=document.getElementById('xp-toast'); if(!el) return;
    el.style.borderColor = ACCENT;
    el.innerHTML = html;
    el.classList.add('show');
    setTimeout(function(){ el.classList.remove('show'); }, dur||4000);
  }

  function awardXP(postId){
    var entry = LESSON_MAP[String(postId)];
    if(!entry) return;
    var s=getS(); var done=s.done||{}; var modKey='m'+entry.mod;
    if(!done[modKey]) done[modKey]=[];
    if(done[modKey].indexOf(String(postId))>-1) return; // already awarded
    done[modKey].push(String(postId));
    s.done=done; s.xp=(s.xp||0)+entry.xp; setS(s); syncNav();
    toast(
      '<div style="font-size:10px;color:'+ACCENT+';letter-spacing:.08em;text-transform:uppercase;margin-bottom:4px">XP Earned</div>'+
      '<div style="font-size:13px;margin-bottom:2px">'+entry.label+'</div>'+
      '<div style="font-size:22px;font-weight:700;color:'+ACCENT+'">+'+entry.xp+' XP</div>'+
      '<div style="font-size:10px;color:rgba(255,255,255,.45);margin-top:3px">Total: '+s.xp+' / '+TOTAL_XP+' XP</div>',
      4000
    );
    checkBadge(entry.mod, s);
  }

  function checkBadge(modIdx, s){
    var done = (s.done && s.done['m'+modIdx]) ? s.done['m'+modIdx].length : 0;
    if(done < (MOD_COUNTS[modIdx]||Infinity)) return;
    var badge=BADGES[modIdx]; if(!badge) return;
    var badges=s.badges||[]; if(badges.indexOf(badge.name)>-1) return;
    badges.push(badge.name); s.badges=badges; setS(s);
    setTimeout(function(){
      toast(
        '<div style="font-size:10px;color:'+ACCENT+';letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px">Badge Unlocked!</div>'+
        '<div style="font-size:36px;margin-bottom:6px">'+badge.em+'</div>'+
        '<div style="font-size:15px;font-weight:600;color:'+ACCENT+'">'+badge.name+'</div>',
        5000
      );
      syncNav();
    }, 1500);
  }

  function getPostId(){ var m=window.location.href.match(/\/posts\/(\d+)/); return m?m[1]:null; }

  function markSidebarActive(){
    var postId=getPostId(); var s=getS();
    document.querySelectorAll('.sl-item').forEach(function(el){
      var id=el.getAttribute('data-post-id'); if(!id) return;
      if(id===postId) el.classList.add('active');
      if(s.done){ Object.keys(s.done).forEach(function(k){ if(s.done[k].indexOf(id)>-1) el.classList.add('completed'); }); }
    });
  }

  function init(){
    syncNav(); markSidebarActive();
    document.addEventListener('click', function(e){
      var btn = e.target.closest('.btn--completion,[data-post-completion-toggle],.mark-as-complete');
      if(!btn) return;
      var completing = btn.getAttribute('data-post-completion-toggle')==='false' ||
                       (btn.textContent||'').indexOf('Mark As Complete')>-1;
      if(!completing) return;
      var pid=getPostId();
      setTimeout(function(){
        awardXP(pid);
        var el=document.querySelector('.sl-item[data-post-id="'+pid+'"]'); if(el) el.classList.add('completed');
      }, 600);
    }, true);
    console.log('[7 Kin] Course XP engine active — '+(C.lessons||[]).length+' lessons, '+(C.modules||[]).length+' badges, store '+STORE_KEY);
  }

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
