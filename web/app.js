import { STATUS, currentClaims, dates, field, formatDate, lineageSets, matchesSearch, sourceIdsForPerson, validateData } from './model.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const iconPaths = {
  tree:'M12 21v-8M4 4v7h16V4M12 4v7M2 2h4v4H2zM10 2h4v4h-4zM18 2h4v4h-4zM10 19h4v4h-4z',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  candidate:'M9 18h6M10 22h4M8 14a7 7 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3',
  source:'M6 3h10l4 4v14H6zM16 3v5h4M9 12h8M9 16h6M3 7v16',
  close:'M6 6l12 12M18 6L6 18', plus:'M12 5v14M5 12h14', minus:'M5 12h14',
  fit:'M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5M8 12h8M12 8v8',
  lock:'M5 10h14v12H5zM8 10V6a4 4 0 0 1 8 0v4', arrow:'M7 17L17 7M7 7h10v10',
  back:'M15 18l-6-6 6-6', check:'M5 12l4 4L20 5', pin:'M12 22s8-8 8-14a8 8 0 0 0-16 0c0 6 8 14 8 14M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
};
const icon = (name, cls='') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[name] || iconPaths.source}"/></svg>`;
const safeUrl = url => { try { const u = new URL(url, location.origin); return ['https:','http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };
const valueText = value => typeof value === 'object' ? JSON.stringify(value, null, 2) : formatDate(value);
const factLabels = {
  name_as_shown:'Имя в исходной схеме',name_reported:'Имя по семейным сведениям',name_reported_corrected:'Уточнённое имя',
  birth_date_reported:'Дата рождения по семейным сведениям',birth_date_as_reported:'Дата рождения по семейным сведениям',birth_date:'Дата рождения',birth_year:'Год рождения',death_year:'Год смерти',death_date:'Дата смерти',death_year_approximate:'Приблизительный год смерти',
  death_date_reported:'Дата смерти по семейным сведениям',death_date_reported_approximate:'Приблизительная дата смерти',
  birth_place_reported:'Место рождения',birth_place_as_reported:'Место рождения по семейным сведениям',birth_place_reported_uncertain:'Предполагаемое место рождения',birth_place_tentative:'Предполагаемое место рождения',
  residence_reported:'Проживание',residence_reported_uncertain:'Предполагаемое проживание',maiden_name_reported:'Девичья фамилия',
  living_reported:'Сведения о жизни',death_cause_reported:'Семейные сведения о смерти',health_history_reported:'Семейные сведения о здоровье',
  surname_search_hypothesis:'Вариант фамилии для поиска',given_name_search_variants:'Варианты имени для поиска',
  wartime_fate_reported:'Военная судьба со слов семьи',name_and_wartime_history_reported:'Семейное упоминание о фронтовике',
  name_and_place_reported:'Семейное упоминание и место',children_reported:'Дети по семейным сведениям',
  birth_date_document_variants:'Разные датировки в записях',capture_record:'Запись о пленении',
  birth_place_index_variants:'Разные варианты места',relatives_in_document:'Родные, названные в записи',
  rvk_departure_field:'Поле «выбытие» в карточке',rvk_birth_date:'Рождение в карточке военкомата',rvk_record:'Сведения военкомата',
  identity_match_rvk_candidate:'Сопоставление с кандидатом',burial_list_entry:'Запись в списке захоронения',
  inventory_entry:'Заголовок архивного дела',military_departure_approximate:'Примерное время ухода на службу',military_role_tentative:'Предполагаемая военная специальность',missing_reported:'Сведения о пропаже',origin_reported:'Происхождение по семейным сведениям',sibling_reported:'Упоминание брата или сестры',death_period_tentative:'Предполагаемый период смерти',
};

const positions = {
  P014:[50,50],P015:[650,50],P012:[50,250],P013:[350,250],P018:[1130,250],P019:[1430,250],P008:[1830,250],P009:[2130,250],
  P005:[250,490],P004:[650,490],P020:[1130,490],P006:[1430,490],P007:[1970,490],
  P002:[740,730],P003:[1500,730],P001:[1120,970],P016:[50,730],P021:[50,1140],P022:[350,1140],P023:[650,1140],
  P024:[2470,250],P026:[2470,460],P010:[2470,670],P011:[2470,880],P025:[2470,1090],P017:[350,730],
};
const NODE_W=252, NODE_H=140, WORLD_W=2760, WORLD_H=1340;
const state={view:'tree',branch:'all',candidates:true,query:'',scale:.72,x:0,y:0,focused:null};
let data, sets, people, hypotheses, scene, viewport, resizeObserver;
const app=document.querySelector('#app');

function branchOf(id) { return sets.paternal.has(id) ? 'paternal' : sets.maternal.has(id) ? 'maternal' : 'root'; }
function candidateFor(id) { return hypotheses.find(h=>h.candidate_id===id); }
function candidateCount() { return hypotheses.length; }
function visible(id) {
  const h=candidateFor(id);
  if(h && !state.candidates) return false;
  if(state.branch==='all' || id==='P001') return true;
  return sets[state.branch].has(h?.target_id || id);
}
function shortDates(id) {
  const d=dates(data,id), p=people.get(id);
  if(d.birth || d.death) return `${d.birth || '?'}${d.death ? ' — '+d.death : p.living===true ? ' · живёт' : ''}`;
  return candidateFor(id) ? 'Даты требуют проверки' : 'Даты пока неизвестны';
}
function nameParts(person) {
  const parts=person.name.split(' ');
  if(parts.length<2 || person.name.startsWith('Неизвестный')) return [person.name,''];
  return [parts.shift(),parts.join(' ')];
}
function initials(person) { return person.name.split(' ').filter(x=>/^[А-ЯЁA-Z]/.test(x)).slice(0,2).map(x=>x[0]).join(''); }
function badge(h) { return `<span class="badge ${h?.status==='strong'?'strong':'candidate'}">${h?.status==='strong'?'Вероятное совпадение':'Кандидат'}</span>`; }
function sourceChips(ids) { return ids.map(id=>`<button class="source-chip" data-source="${escape(id)}" title="Открыть источник ${escape(id)}">${escape(id)}</button>`).join(''); }

function shell() {
  app.innerHTML=`<aside class="sidebar"><a class="brand" href="#tree" data-nav="tree"><span class="brand-mark">${icon('tree')}</span><span>Семейный<span class="brand-second">атлас</span></span></a>
  <p class="sidebar-caption">История складывается<br>из людей и свидетельств.</p><nav aria-label="Главная навигация">${[['tree','tree','Древо'],['people','people','Люди'],['candidates','candidate','Кандидаты'],['sources','source','Источники']].map(([id,i,label])=>`<button class="nav-item" data-nav="${id}">${icon(i)}<span>${label}</span><span class="nav-count">${id==='people'?data.people.length:id==='candidates'?candidateCount():id==='sources'?data.sources.length:''}</span></button>`).join('')}</nav>
  <div class="sidebar-bottom"><div class="privacy-label">${icon('lock')}<span>Для нашей семьи</span></div><div class="owner"><span class="avatar">${escape(initials(people.get('P001')))}</span><span>${escape(people.get('P001').name.split(' ').slice(1,2).join(' '))}<small>Семейный архив</small></span></div></div></aside>
  <div class="workspace"><header class="page-header"><div><div class="breadcrumb">Семейный архив <span>/</span> <span id="crumb">Древо</span></div><h1 id="page-title">Наши корни</h1></div><div class="search-wrap">${icon('search')}<input id="global-search" type="search" placeholder="Найти человека…" aria-label="Поиск человека" autocomplete="off"><div id="search-results" class="search-results" hidden></div></div></header>
  <main id="main" tabindex="-1"></main><footer class="app-footer"><span>${icon('lock')} Закрытый семейный архив</span><span>Сведения обновлены ${escape(data.updated_label)}</span></footer></div>
  <dialog id="details" aria-label="Сведения из семейного архива"><div id="details-content"></div></dialog><div class="toast" role="status" id="toast" hidden></div>`;
  document.querySelector('#global-search').addEventListener('input',e=>{state.query=e.target.value; renderSearch(); if(state.view==='people') renderPeople();});
  document.querySelector('#global-search').addEventListener('keydown',e=>{if(e.key==='Escape'){document.querySelector('#search-results').hidden=true;} if(e.key==='Enter'){const match=data.people.find(p=>matchesSearch(p,state.query)); if(match) openPerson(match.id);}});
  const dialog=document.querySelector('#details');
  dialog.addEventListener('click',e=>{if(e.target===dialog) dialog.close();});
  document.addEventListener('click',onClick);
  renderMain();
}

function renderSearch() {
  const target=document.querySelector('#search-results');
  if(!state.query.trim()){target.hidden=true; return;}
  const matches=data.people.filter(p=>matchesSearch(p,state.query));
  target.innerHTML=matches.length?matches.slice(0,8).map(p=>`<button data-person="${p.id}"><span>${escape(p.name)}</span><small>${escape(shortDates(p.id))}</small></button>`).join(''):`<p>Совпадений нет. Попробуйте фамилию или имя.</p>`;
  target.hidden=false;
}
function renderMain() {
  const titles={tree:['Древо','Наши корни'],people:['Люди','Люди нашей истории'],candidates:['Кандидаты','Возможные родные'],sources:['Источники','На чём основана история']};
  document.querySelector('#crumb').textContent=titles[state.view][0]; document.querySelector('#page-title').textContent=titles[state.view][1];
  document.querySelectorAll('[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===state.view));
  if(resizeObserver){resizeObserver.disconnect();resizeObserver=null;}
  if(state.view==='tree') renderTree(); else if(state.view==='people') renderPeople(); else if(state.view==='candidates') renderCandidates(); else renderSources();
}
function treeNode(person) {
  const [surname,rest]=nameParts(person),h=candidateFor(person.id),[x,y]=positions[person.id]||[0,0],branch=branchOf(h?.target_id||person.id);
  return `<button class="person-node ${branch} ${h?'is-candidate':''} ${person.id==='P001'?'is-root':''}" style="left:${x}px;top:${y}px" data-person="${person.id}" data-node="${person.id}" aria-label="${escape(person.name)}, ${escape(shortDates(person.id))}${h?', кандидат':''}"><div class="node-heading"><span class="node-portrait">${escape(initials(person))}</span><span class="node-tag">${h?(h.status==='strong'?'Совпадение':'Кандидат'):person.id==='P001'?'Это я':'Семейные сведения'}</span></div><strong>${escape(surname)}</strong>${rest?`<span class="given-name">${escape(rest)}</span>`:''}<span class="node-dates">${escape(shortDates(person.id))}</span><span class="node-open">${icon('source')} ${sourceIdsForPerson(data,person.id).length} ист.</span></button>`;
}
function pathBetween(parent,child) {
  const a=positions[parent],b=positions[child];if(!a||!b)return '';
  const x1=a[0]+NODE_W/2,y1=a[1]+NODE_H,x2=b[0]+NODE_W/2,y2=b[1],mid=(y1+y2)/2;
  return `M${x1},${y1} V${mid} H${x2} V${y2}`;
}
function renderTree() {
  const main=document.querySelector('#main');
  main.innerHTML=`<div class="tree-tools"><div class="segmented" aria-label="Ветвь семьи">${[['all','Вся семья'],['paternal','По отцу'],['maternal','По маме']].map(([id,label])=>`<button data-branch="${id}" aria-pressed="${state.branch===id}" class="${state.branch===id?'selected':''}">${label}</button>`).join('')}</div><label class="toggle-label"><input type="checkbox" id="candidate-toggle" ${state.candidates?'checked':''}><span class="toggle-track"></span>Показать кандидатов <span class="small-count">${candidateCount()}</span></label></div>
  <section class="tree-card" aria-label="Интерактивное семейное древо"><div class="map-caption"><span class="live-dot"></span><span>Рабочая семейная схема</span><span class="map-caption-detail">Пять поколений. Каждая связь хранит своё основание.</span></div>
  <div id="tree-viewport" tabindex="0" role="region" aria-label="Холст древа. Перетаскивайте или используйте стрелки. Плюс и минус меняют масштаб."><div class="world" id="tree-world" style="width:${WORLD_W}px;height:${WORLD_H}px"><svg class="connections" width="${WORLD_W}" height="${WORLD_H}" aria-hidden="true">${data.relationships.filter(r=>visible(r.parent_id)&&visible(r.child_id)).map(r=>`<path class="family-edge ${branchOf(r.child_id)}" d="${pathBetween(r.parent_id,r.child_id)}"/>`).join('')}${hypotheses.filter(h=>visible(h.candidate_id)&&visible(h.target_id)).map(h=>{const a=positions[h.candidate_id],b=positions[h.target_id];return `<path class="identity-edge ${h.candidate_id===state.focused?'is-active':''}" data-link="${h.candidate_id}" d="M${a[0]},${a[1]+70} C${a[0]-130},${a[1]+70} ${b[0]+NODE_W+150},${b[1]+70} ${b[0]+NODE_W},${b[1]+70}"/>`;}).join('')}</svg>
  <span class="world-label" style="left:50px;top:1100px">Родство уточняем</span>${state.candidates?'<span class="world-label candidate-label" style="left:2470px;top:200px">Возможные совпадения</span>':''}${data.people.filter(p=>visible(p.id)).map(treeNode).join('')}</div></div>
  <div class="map-bottom"><div class="legend"><span><i class="legend-line"></i>Со слов семьи</span><span><i class="legend-line candidate-line"></i>Гипотеза совпадения</span></div><div class="zoom-controls"><button data-action="out" aria-label="Уменьшить">${icon('minus')}</button><span id="zoom-value">72%</span><button data-action="in" aria-label="Увеличить">${icon('plus')}</button><span class="control-divider"></span><button data-action="fit" aria-label="Показать всю схему" title="Вся схема">${icon('fit')}</button><button class="to-me" data-action="home">К себе</button></div></div></section>
  <div class="below-map"><p>${icon('source')} Нажмите на человека, чтобы увидеть сведения и источники. Пунктирные семейные связи ещё требуют документальной проверки.</p><button class="text-button" data-nav="candidates">Открыть ${candidateCount()} кандидатов ${icon('arrow')}</button></div>`;
  scene=document.querySelector('#tree-world');viewport=document.querySelector('#tree-viewport');
  document.querySelector('#candidate-toggle').addEventListener('change',e=>{state.candidates=e.target.checked;renderTree();});
  bindMap();
  resizeObserver=new ResizeObserver(()=>transform());resizeObserver.observe(viewport);
  if(!state.initialized){state.initialized=true;requestAnimationFrame(()=>homeView());} else transform();
}
function transform(){if(scene){scene.style.transform=`translate(${state.x}px,${state.y}px) scale(${state.scale})`;const label=document.querySelector('#zoom-value');if(label)label.textContent=`${Math.round(state.scale*100)}%`;}}
function zoom(mult,cx=viewport?.clientWidth/2,cy=viewport?.clientHeight/2){const old=state.scale;state.scale=Math.min(1.6,Math.max(.2,old*mult));state.x=cx-(cx-state.x)*state.scale/old;state.y=cy-(cy-state.y)*state.scale/old;transform();}
function homeView(){if(!viewport)return;const mobile=viewport.clientWidth<600;state.scale=mobile?.55:Math.min(.7,(viewport.clientWidth-70)/1012);state.x=viewport.clientWidth/2-1246*state.scale;state.y=viewport.clientHeight/2-(mobile?870:820)*state.scale;transform();}
function fitView(){const nodes=data.people.filter(p=>visible(p.id)).map(p=>positions[p.id]);const x=Math.min(...nodes.map(p=>p[0])),y=Math.min(...nodes.map(p=>p[1])),w=Math.max(...nodes.map(p=>p[0]))+NODE_W-x,h=Math.max(...nodes.map(p=>p[1]))+NODE_H-y;state.scale=Math.min((viewport.clientWidth-64)/w,(viewport.clientHeight-60)/h,1);state.x=(viewport.clientWidth-w*state.scale)/2-x*state.scale;state.y=(viewport.clientHeight-h*state.scale)/2-y*state.scale;transform();}
function bindMap(){
  let drag=null;
  viewport.addEventListener('pointerdown',e=>{if(e.target.closest('button'))return;drag={x:e.clientX,y:e.clientY,tx:state.x,ty:state.y};viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');});
  viewport.addEventListener('pointermove',e=>{if(!drag)return;state.x=drag.tx+e.clientX-drag.x;state.y=drag.ty+e.clientY-drag.y;transform();});
  const stop=()=>{drag=null;viewport.classList.remove('dragging');};viewport.addEventListener('pointerup',stop);viewport.addEventListener('pointercancel',stop);
  viewport.addEventListener('wheel',e=>{e.preventDefault();if(e.ctrlKey||e.metaKey){const rect=viewport.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.006),e.clientX-rect.left,e.clientY-rect.top);}else{state.x-=e.deltaX;state.y-=e.deltaY;transform();}},{passive:false});
  viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;const moves={ArrowLeft:[45,0],ArrowRight:[-45,0],ArrowUp:[0,45],ArrowDown:[0,-45]};if(moves[e.key]){e.preventDefault();state.x+=moves[e.key][0];state.y+=moves[e.key][1];transform();}if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.2);}if(e.key==='-'){e.preventDefault();zoom(1/1.2);}});
  scene.querySelectorAll('[data-node]').forEach(node=>{const toggle=active=>scene.querySelector(`[data-link="${node.dataset.node}"]`)?.classList.toggle('is-active',active||state.focused===node.dataset.node);node.addEventListener('mouseenter',()=>toggle(true));node.addEventListener('mouseleave',()=>toggle(false));node.addEventListener('focus',()=>toggle(true));node.addEventListener('blur',()=>toggle(false));});
}
function renderPeople(){const entries=data.people.filter(p=>matchesSearch(p,state.query));document.querySelector('#main').innerHTML=`<div class="section-intro"><p>У каждого человека — своя история и основания для проверки.</p><span>${entries.length} записей</span></div><div class="people-grid">${entries.length?entries.map(p=>{const h=candidateFor(p.id);return `<button class="directory-person ${branchOf(h?.target_id||p.id)}" data-person="${p.id}"><span class="directory-avatar">${escape(initials(p))}</span><span class="directory-info"><strong>${escape(p.name)}</strong><small>${escape(shortDates(p.id))}</small><span class="person-context">${h?STATUS[h.status]:'Семейные сведения'}</span></span>${icon('arrow')}</button>`;}).join(''):'<div class="empty-state">Человек не найден. Измените текст поиска.</div>'}</div>`;}
function renderCandidates(){document.querySelector('#main').innerHTML=`<div class="section-intro"><p>Сохраняем каждую возможность. Совпадение проверяем по датам, местам и родным.</p><span>${candidateCount()} кандидатов</span></div><div class="candidate-list">${[...hypotheses].sort((a,b)=>({strong:0,tentative:1,unproven:2}[a.status]-{strong:0,tentative:1,unproven:2}[b.status])).map(h=>`<article class="candidate-card"><div class="candidate-top">${badge(h)}<span class="subtle">${escape(h.candidate_id)}</span></div><h2><button data-person="${h.candidate_id}">${escape(people.get(h.candidate_id).name)}</button></h2><p class="candidate-target">Возможное совпадение с <button data-person="${h.target_id}">${escape(people.get(h.target_id).name)}</button></p><p>${escape(h.reasoning)}</p><div class="candidate-bottom"><div>${sourceChips(h.source_ids)}</div><button class="text-button" data-person="${h.candidate_id}">Открыть досье ${icon('arrow')}</button></div></article>`).join('')}</div>`;}
function renderSources(){document.querySelector('#main').innerHTML=`<div class="section-intro"><p>Семейные рассказы, архивные индексы и просмотренные оригиналы.</p><span>${data.sources.length} источника</span></div><div class="source-directory">${data.sources.map(s=>`<button class="source-row" data-source="${s.id}"><span class="source-symbol">${icon('source')}</span><span class="source-row-copy"><span class="source-kind">${escape(s.id)} <span>·</span> ${s.kind==='primary'?'Первичный источник':s.kind==='derivative'?'Индекс или производная запись':'Рассказ или публикация'}</span><strong>${escape(s.title)}</strong><small>${escape(s.locator||s.repository)}</small></span><span class="source-availability ${s.viewed_original?'viewed':''}">${s.viewed_original?'Оригинал просмотрен':'См. пределы проверки'}</span>${icon('arrow')}</button>`).join('')}</div>`;}

function showDialog(html){const dialog=document.querySelector('#details');document.querySelector('#details-content').innerHTML=html;if(!dialog.open)dialog.showModal();document.querySelector('#details-content').scrollTop=0;document.querySelector('#details-close')?.focus();}
function detailTop(label){return `<div class="detail-toolbar"><span>${escape(label)}</span><button id="details-close" data-action="close" aria-label="Закрыть досье">${icon('close')}</button></div>`;}
function openPerson(id){
  const p=people.get(id);if(!p)return;
  state.focused=id;document.querySelector('#search-results').hidden=true;
  if(scene)scene.querySelectorAll('[data-link]').forEach(el=>el.classList.toggle('is-active',el.dataset.link===id));
  const h=candidateFor(id), claims=currentClaims(data,id), old=data.claims.filter(c=>c.person_id===id&&!claims.includes(c));
  const relationships=data.relationships.filter(r=>r.parent_id===id||r.child_id===id),conflicts=(data.conflicts||[]).filter(x=>x.person_id===id);
  const place=field(data,id,['birth_place_reported','birth_place_as_reported','birth_place_tentative','birth_place_reported_uncertain','residence_reported','residence_reported_uncertain']);
  const displayClaims=claims.filter(c=>!['name_as_shown','name_reported','name_reported_corrected'].includes(c.fact));
  showDialog(`${detailTop(h?'Кандидат для проверки':'Карточка человека')}<div class="person-detail"><div class="detail-avatar ${branchOf(h?.target_id||id)}">${escape(initials(p))}</div>${h?badge(h):'<span class="badge family">Со слов семьи</span>'}<h2>${escape(p.name)}</h2><p class="detail-dates">${escape(shortDates(id))}</p>${place?`<p class="place-line">${icon('pin')}${escape(valueText(place.value))}</p>`:''}${p.name_notes?`<p class="detail-note">${escape(p.name_notes)}</p>`:''}${p.role?`<p class="detail-note">${escape(p.role)}</p>`:''}
  ${h?`<section class="identity-note"><h3>${escape(STATUS[h.status])}</h3><p>Сопоставляется с <button class="inline-person" data-person="${h.target_id}">${escape(people.get(h.target_id).name)}</button></p><p>${escape(h.reasoning)}</p><div>${sourceChips(h.source_ids)}</div></section>`:''}
  ${relationships.length?`<section class="detail-section"><h3>Семейные связи</h3><p class="section-hint">Заявлены семьёй; документальная цепочка пока не установлена.</p>${relationships.map(r=>{const other=r.parent_id===id?r.child_id:r.parent_id;return `<div class="relative-row"><button data-person="${other}"><small>${r.parent_id===id?'Ребёнок':'Родитель'}</small><strong>${escape(people.get(other).name)}</strong></button><div>${sourceChips(r.source_ids)}</div></div>`;}).join('')}</section>`:''}
  <section class="detail-section"><h3>Сведения и основания</h3>${displayClaims.length?displayClaims.map(c=>`<article class="fact"><h4>${escape(factLabels[c.fact]||'Сведения из источника')}</h4><p>${escape(c.value===true?'Живёт':valueText(c.value))}</p><div class="fact-meta"><span>${escape(STATUS[c.status]||c.status)}</span>${sourceChips(c.source_ids)}</div><details><summary>Почему мы так считаем</summary><blockquote>${escape(c.evidence_quote)}</blockquote><p>${escape(c.reasoning)}</p></details></article>`).join(''):'<p class="section-hint">Биографических сведений пока мало. Все найденные основания сохранены ниже.</p>'}</section>
  ${conflicts.length?`<section class="detail-section"><h3>Расхождения и уточнения</h3>${conflicts.map(c=>`<div class="conflict ${c.resolved?'resolved':''}"><strong>${c.resolved?'Уточнено':'Требует проверки'}</strong><p>${escape(c.description)}</p>${c.resolution?`<p>${escape(c.resolution)}</p>`:''}${sourceChips(c.source_ids||[])}</div>`).join('')}</section>`:''}
  ${old.length?`<details class="history"><summary>Прежние версии сведений (${old.length})</summary>${old.map(c=>`<div class="fact"><h4>${escape(factLabels[c.fact]||'Прежние сведения')}</h4><p>${escape(valueText(c.value))}</p>${sourceChips(c.source_ids)}</div>`).join('')}</details>`:''}
  <section class="detail-section"><h3>Все источники этой записи</h3><div class="source-links">${sourceIdsForPerson(data,id).map(sid=>`<button data-source="${sid}"><span>${sid}</span>${escape(data.sources.find(s=>s.id===sid)?.title||sid)}${icon('arrow')}</button>`).join('')}</div></section><p class="record-id">Запись ${escape(id)} · сведения обновляются по мере проверки</p></div>`);
}
function artifactsFor(s){return (data.artifacts||[]).filter(a=>a.name.startsWith(s.id+'-')||a.name.startsWith(s.id+'_')||(s.id>='S017'&&s.id<='S022'&&a.name==='S017-S022-maternal-search-notes.md'));}
function bytes(n){return n>1048576?`${(n/1048576).toFixed(1)} МБ`:`${Math.max(1,Math.round(n/1024))} КБ`;}
function openSource(id){const s=data.sources.find(s=>s.id===id);if(!s)return;const files=artifactsFor(s),url=safeUrl(s.url),used=data.claims.filter(c=>c.source_ids?.includes(id));
  showDialog(`${detailTop('Источник '+id)}<div class="source-detail"><span class="detail-document">${icon('source')}</span><p class="source-kind">${s.kind==='primary'?'Первичный источник':s.kind==='derivative'?'Индекс или производная запись':'Семейный рассказ или публикация'}</p><h2>${escape(s.title)}</h2><dl class="source-metadata"><dt>Где хранится</dt><dd>${escape(s.repository)}</dd><dt>Запись / шифр</dt><dd>${escape(s.locator)}</dd><dt>Дата просмотра</dt><dd>${escape(s.date_accessed)}</dd><dt>Проверка оригинала</dt><dd>${s.viewed_original?'Оригинальное изображение или документ просмотрены; подробности ниже.':'Оригинал исследователем не просмотрен. Сведения известны из индекса, публикации или семейного сообщения.'}</dd></dl>${s.notes?`<div class="source-limits"><h3>Пределы проверки</h3><p>${escape(s.notes)}</p></div>`:''}${url?`<a class="primary-button" href="${escape(url)}" target="_blank" rel="noopener noreferrer">Открыть исходную страницу ${icon('arrow')}</a>`:''}
  <section class="detail-section"><h3>Сохранённые материалы <span class="count-inline">${files.length}</span></h3>${files.length?files.map(f=>`<a class="artifact" href="${escape(encodeURI(f.url))}" target="_blank" rel="noopener noreferrer">${icon('source')}<span>${escape(f.name)}<small>${bytes(f.bytes)} · ${escape(f.name.split('.').at(-1).toUpperCase())}</small></span>${icon('arrow')}</a>`).join(''):'<p class="section-hint">Отдельный файл не получен. Ссылка, реквизиты и выдержки сохранены в реестре.</p>'}</section>
  ${used.length?`<section class="detail-section"><h3>Выдержки и связанные люди</h3>${used.map(c=>`<article class="source-excerpt"><button class="inline-person" data-person="${c.person_id}">${escape(people.get(c.person_id).name)}</button><blockquote>${escape(c.evidence_quote)}</blockquote></article>`).join('')}</section>`:''}<p class="record-id">${escape(s.origin_id)}<br>Повторения одного происхождения не считаются независимыми свидетельствами.</p></div>`);
}
function onClick(e){const target=e.target.closest('[data-nav],[data-person],[data-source],[data-action],[data-branch]');if(!target)return;
  if(target.dataset.nav){e.preventDefault();document.querySelector('#details')?.close();state.view=target.dataset.nav;history.replaceState(null,'','#'+state.view);document.querySelector('#search-results').hidden=true;renderMain();}
  else if(target.dataset.person)openPerson(target.dataset.person);
  else if(target.dataset.source)openSource(target.dataset.source);
  else if(target.dataset.branch){state.branch=target.dataset.branch;renderTree();}
  else if(target.dataset.action==='close')document.querySelector('#details').close();
  else if(target.dataset.action==='in')zoom(1.2);
  else if(target.dataset.action==='out')zoom(1/1.2);
  else if(target.dataset.action==='fit')fitView();
  else if(target.dataset.action==='home')homeView();
}

try{
  const response=await fetch('/data/family.json',{cache:'no-store'});if(!response.ok)throw new Error('Данные недоступны');
  data=await response.json();validateData(data);people=new Map(data.people.map(p=>[p.id,p]));hypotheses=data.candidate_links||[];sets=lineageSets(data);
  const requested=location.hash.slice(1);if(['tree','people','candidates','sources'].includes(requested))state.view=requested;
  shell();
}catch(error){app.innerHTML=`<div class="load-error"><h1>Не удалось открыть семейный архив</h1><p>Проверьте подключение и доступ к сайту, затем обновите страницу.</p><button id="reload">Попробовать ещё раз</button></div>`;document.querySelector('#reload').addEventListener('click',()=>location.reload());}
