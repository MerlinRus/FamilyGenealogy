const certainty = {known:'Знаю точно',hypothesis:'Предположение',unknown:'Пока неизвестно',documented:'Проверено по документу'};
const decisions = {review:'Проверяем',accepted:'Считаю совпадением',rejected:'Исключаю эту версию',paused:'Отложить проверку'};
const esc = s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = prefix=>prefix+crypto.randomUUID().replaceAll('-','');
const display = v=>v===null||v===undefined?'Не указано':v===true?'Да':v===false?'Нет':typeof v==='object'?JSON.stringify(v):String(v);
const change = (collection,id,fields)=>({collection,id,fields});
let dirty=false;
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
export function guardEditor(e){if(dirty&&e.target.closest('a[href^="#"]')&&!confirm('Есть несохранённые изменения. Уйти без сохранения?')){e.preventDefault();e.stopImmediatePropagation();}else if(e.target.closest('a[href^="#"]'))dirty=false;}
document.addEventListener('click',guardEditor,true);
function input(label,name,value='',type='text',help=''){return `<label class="edit-field">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}">${help?`<small>${esc(help)}</small>`:''}</label>`;}
function area(label,name,value='',help=''){return `<label class="edit-field">${esc(label)}<textarea name="${name}" rows="4">${esc(value)}</textarea>${help?`<small>${esc(help)}</small>`:''}</label>`;}
function select(label,name,values,current){return `<label class="edit-field">${label}<select name="${name}">${Object.entries(values).map(([v,t])=>`<option value="${esc(v)}" ${String(current)===v?'selected':''}>${esc(t)}</option>`).join('')}</select></label>`;}
function sourceNote(reason,personId){const id=uid('U');return {id,changes:[change('sources',id,{title:'Правка владельца: '+reason.slice(0,100),kind:'secondary',repository:'Семейный редактор',origin_id:id,locator:'Личный ввод владельца',url:'',date_accessed:new Date().toISOString().slice(0,10),viewed_original:false,notes:reason}),change('presentation.sources',id,{title:'Личные сведения: '+reason.slice(0,100),group:'family',kind_label:'Запись владельца',summary:reason,limit:'Личный ввод. Наличие отдельного архивного документа указывается независимо.',person_ids:personId?[personId]:[],primary_file:null,reading_hint:'',pdf_page:null})]};}
export async function renderEditor(view,id,data){
  const main=document.querySelector('#main');dirty=false;
  const person=data.people.find(p=>p.id===id),fact=data.claims.find(c=>c.id===id),source=data.sources.find(s=>s.id===id),relation=data.relationships.find(r=>r.id===id);
  const target=view==='edit-fact'?fact?.person_id:view==='add-fact'?id:view==='edit-relation'?relation?.child_id:id;
  const back=['edit-source'].includes(view)?'#source/'+id:target&&data.people.some(p=>p.id===target)?'#person/'+target:'#people';
  const titles={'edit-person':'Изменить человека','add-person':'Добавить человека','edit-fact':'Изменить сведения','add-fact':'Добавить факт','edit-source':'Изменить описание документа','add-source':'Добавить источник','edit-relation':'Изменить родственную связь','add-relation':'Добавить родственную связь',history:'История изменений'};
  if(!data.editing?.enabled){main.innerHTML='<h1>Редактор недоступен</h1><p>Не удалось подключиться к серверу сохранения. Обновите страницу; исходные сведения доступны для просмотра.</p>';return;}
  main.innerHTML=`<a class="back-link" href="${back}">← Вернуться к записи</a><h1>${titles[view]}</h1><p class="editor-intro">Изменения сохраняются в семейном архиве на сервере. Прежние значения остаются в истории.</p><div id="editor-content"></div>`;
  const content=document.querySelector('#editor-content');
  if(view==='history'){
    try{const r=await fetch('/api/history',{cache:'no-store'});if(!r.ok)throw Error();const events=await r.json();content.innerHTML=`${events.length?`<button class="button secondary" id="undo-edit">Отменить последнее изменение</button><p id="history-message" role="status"></p>`:'<p>Правок пока нет. Откройте человека и нажмите «Редактировать».</p>'}<div class="history-list">${events.map(e=>`<article><h2>${esc(e.reason)}</h2><p>${new Date(e.time).toLocaleString('ru-RU')} · Изменение ${e.revision}</p>${(e.changes||[]).map(c=>`<div class="history-change"><strong>${esc(c.label)}</strong><div>Было: ${esc(display(c.before))}</div><div>Стало: ${esc(display(c.after))}</div></div>`).join('')}</article>`).join('')}</div>`;document.querySelector('#undo-edit')?.addEventListener('click',async e=>{e.target.disabled=true;try{await save('/api/undo',{revision:data.editing.revision,reason:'Отмена последнего изменения'});dirty=false;location.reload();}catch(err){document.querySelector('#history-message').textContent=err.message;e.target.disabled=false;}});}catch{content.textContent='Не удалось загрузить историю. Обновите страницу.';}return;
  }
  const pu=data.presentation.people[id],cu=data.presentation.candidates[id],su=data.presentation.sources[id];
  const people=Object.fromEntries(data.people.map(p=>[p.id,p.name]));
  const facts={birth_date:'Дата рождения',birth_place_reported:'Место рождения',death_date:'Дата смерти',residence_reported:'Место проживания',maiden_name_reported:'Девичья фамилия',military_record:'Служба',personal_note:'Заметка / другие сведения'};
  let fields='';
  if(view==='edit-person'||view==='add-person'){
    fields=input('Фамилия, имя, отчество','name',person?.name)+select('Жив / умер','living',{'':'Не указано',yes:'Жив',no:'Умер'},person?.living===true?'yes':person?.living===false?'no':'')+area('Описание человека','description',cu?.conclusion||pu?.summary||'');
    if(cu){fields+=select('Моё решение по версии','decision',decisions,cu.decision||'review')+area('Что поддерживает версию — по одному пункту в строке','matches',cu.matches.join('\n'))+area('Что мешает подтвердить — по одному пункту в строке','objections',cu.objections.join('\n'))+area('Что проверить дальше','next_step',cu.next_step);}
    else fields+=input('Кто это для меня','relationship',pu?.relationship||'')+select('Насколько я уверен в родстве','certainty',certainty,pu?.certainty||(pu?.family_hypothesis?'hypothesis':'known'));
    if(view==='add-person')fields+=select('Куда добавить','category',{family:'В семейный список',candidate:'В версии для проверки'},'family')+select('С кем сравниваем кандидата','target',people,data.owner_id);
  } else if(view==='edit-fact'||view==='add-fact'){
    const choices={...facts};if(fact&&!choices[fact.fact])choices[fact.fact]='Текущие сведения';
    fields=select('Что это за сведения','fact',choices,fact?.fact||'personal_note')+(typeof fact?.value==='boolean'?select('Значение','value',{yes:'Да',no:'Нет'},fact.value?'yes':'no'):area('Значение','value',typeof fact?.value==='object'?JSON.stringify(fact.value):fact?.value||'', 'Дату вводите ГГГГ-ММ-ДД или ДД.ММ.ГГГГ; если известен только год — укажите год.'))+select('Моя уверенность','certainty',certainty,fact?.user_certainty||'known')+select('Документ, если он есть','source',{'':'Только мои сведения',...Object.fromEntries(data.sources.map(s=>[s.id,data.presentation.sources[s.id].title]))},'');
  } else if(view==='edit-source'||view==='add-source'){
    fields=select('Добавить связь источника с человеком','person',{'':'Сохранить текущие связи',...people},'')+input('Понятное название','title',su?.title)+input('Ссылка на запись или документ','url',source?.url,'url')+input('Архив / сайт / держатель','repository',source?.repository)+input('Фонд, опись, дело, лист или номер записи','locator',source?.locator)+area('Что здесь найдено','summary',su?.summary)+area('Ограничения: что этот материал не устанавливает','limit',su?.limit)+select('Тип материала','group',{record:'Документ или запись',family:'Семейные сведения',guide:'Указатель для поиска',research:'Заметки исследования'},su?.group||'record');
  } else if(view==='edit-relation'||view==='add-relation')fields=select('Родитель','parent',people,relation?.parent_id)+select('Ребёнок','child',people,relation?.child_id||id)+select('Моя уверенность в этой связи','certainty',certainty,relation?.user_certainty||'known');
  else {content.textContent='Запись не найдена';return;}
  if((view==='edit-person'&&!person)||(view==='edit-fact'&&!fact)||(view==='edit-source'&&!source)||(view==='edit-relation'&&!relation)){content.textContent='Запись не найдена';return;}
  content.innerHTML=`<form class="editor-form" id="edit-form"><div class="edit-fields">${fields}</div>${area('Почему меняю / откуда знаю','reason','','Например: «Это мой отец, знаю лично» или ссылка на найденную запись.')}<div class="editor-actions"><button class="button primary" type="submit">Сохранить изменения</button><a class="button secondary" href="${back}">Отмена</a></div><p role="status" id="save-message"></p></form>`;
  const form=document.querySelector('#edit-form');for(const key of ['name','title','summary','limit','matches','objections','next_step'])if(form.elements[key])form.elements[key].required=true;form.addEventListener('input',()=>dirty=true);
  form.elements.preset?.addEventListener('change',e=>{if(e.target.value)form.elements.fact.value=e.target.value;});
  form.addEventListener('submit',async e=>{
    e.preventDefault();const v=Object.fromEntries(new FormData(form));const message=document.querySelector('#save-message');
    if(!v.reason.trim()){message.textContent='Напишите коротко, откуда знаете эти сведения.';form.elements.reason.focus();return;}
    const button=form.querySelector('[type=submit]');button.disabled=true;message.textContent='Сохраняем…';
    try{
      let changes=[],destination=back;
      if(view==='edit-person'){
        changes.push(change('people',id,{name:v.name.trim(),living:v.living==='yes'?true:v.living==='no'?false:null}));
        if(cu)changes.push(change('presentation.candidates',id,{conclusion:v.description,label:decisions[v.decision],decision:v.decision,matches:v.matches.split('\n').filter(x=>x.trim()),objections:v.objections.split('\n').filter(x=>x.trim()),next_step:v.next_step}));
        else changes.push(change('presentation.people',id,{summary:v.description,relationship:v.relationship,certainty:v.certainty,family_hypothesis:v.certainty==='hypothesis'}));
      } else if(view==='add-person'){
        const pid=uid('P'),note=sourceNote(v.reason,pid);changes.push(...note.changes,change('people',pid,{name:v.name.trim(),living:v.living==='yes'?true:v.living==='no'?false:null,role:v.description}));
        if(v.category==='candidate')changes.push(change('candidate_links',uid('H'),{candidate_id:pid,target_id:v.target,status:'unproven',source_ids:[note.id],reasoning:v.reason,priority:'medium',relation_type:'possible_collateral'}),change('presentation.candidates',pid,{label:'Проверяем',decision:'review',question:'Как связан с нашей семьёй?',conclusion:v.description||v.reason,matches:[v.reason],objections:['Родство ещё нужно проверить.'],next_step:'Найти сведения о родстве и добавить источник.',document_ids:[note.id],comparison:[{label:'Родство',known:'Пока неизвестно',found:v.description||v.reason,result:'missing'}],record_label:'Добавлен владельцем'}));
        else changes.push(change('presentation.people',pid,{relationship:v.relationship||'Добавленный родственник',summary:v.description||v.reason,category:'family',certainty:v.certainty,family_hypothesis:v.certainty==='hypothesis'}));
        destination='#person/'+pid;
      } else if(view==='edit-fact'||view==='add-fact'){
        const note=sourceNote(v.reason,target);changes.push(...note.changes);
        if(fact)changes.push(change('claims',fact.id,{current:false}));
        let value=v.value.trim();if(fact&&typeof fact.value==='object')value=JSON.parse(value);
        if(!value||!v.fact.trim())throw Error('Заполните поле и его значение.');
        if(typeof fact?.value==='boolean')value=v.value==='yes';
        if(/date/.test(v.fact)&&/^\d{2}\.\d{2}\.\d{4}$/.test(value))value=value.split('.').reverse().join('-');
        changes.push(change('claims',uid('C'),{person_id:target,fact:v.fact.trim(),value,status:'unproven',user_certainty:v.certainty,source_ids:[note.id,...(v.source?[v.source]:[])],evidence_quote:v.reason,reasoning:'Внесено владельцем: '+v.reason,current:true}));
      } else if(view==='edit-source'||view==='add-source'){
        const sid=source?.id||uid('S');changes.push(change('sources',sid,{title:v.title,url:v.url,repository:v.repository,locator:v.locator,...(!source?{kind:'secondary',origin_id:sid,date_accessed:new Date().toISOString().slice(0,10),viewed_original:false,notes:v.reason}:{})}),change('presentation.sources',sid,{title:v.title,summary:v.summary,limit:v.limit,group:v.group,person_ids:[...new Set([...(su?.person_ids||[]),...(v.person?[v.person]:[])])],...(!source?{kind_label:'Добавлен владельцем',primary_file:null,reading_hint:'',pdf_page:null}:{})}));destination='#source/'+sid;
      } else {
        const note=sourceNote(v.reason,v.child);changes.push(...note.changes,change('relationships',relation?.id||uid('R'),{parent_id:v.parent,child_id:v.child,type:'parent-child',user_certainty:v.certainty,...(!relation?{status:'unproven',source_ids:[note.id],direct_evidence:false,evidence_quote:v.reason,reasoning:v.reason}:{})}));destination='#person/'+v.child;
      }
      await save('/api/edit',{revision:data.editing.revision,reason:v.reason,changes});dirty=false;location.hash=destination;location.reload();
    }catch(err){message.textContent=err.message;button.disabled=false;}
  });
}
async function save(url,payload){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Family-Edit':'1'},body:JSON.stringify(payload)});const result=await r.json();if(!r.ok)throw Error(result.error||'Не удалось сохранить');return result;}
