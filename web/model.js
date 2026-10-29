export const STATUS = {
  confirmed: 'Подтверждено документом',
  strong: 'Сильное косвенное совпадение',
  tentative: 'Рабочая гипотеза',
  unproven: 'Пока не подтверждено',
};

export function currentClaims(data, personId) {
  return data.claims.filter(c => c.person_id === personId && c.current !== false && !c.superseded_by_source_id);
}

export function field(data, personId, keys) {
  const claims = currentClaims(data, personId);
  for (const key of keys) {
    const matches = claims.filter(c => c.fact === key);
    if (matches.length) return matches.at(-1);
  }
  return null;
}

export function formatDate(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}.${match[2]}.${match[1]}` : str;
}

export function dates(data, personId) {
  const birth = field(data, personId, ['birth_date_reported', 'birth_date', 'birth_date_as_reported', 'rvk_birth_date', 'birth_year']);
  const death = field(data, personId, ['death_date_reported', 'death_date', 'death_date_reported_approximate', 'death_year', 'death_year_approximate']);
  const deathText = death ? formatDate(death.value) : '';
  return { birth: birth ? formatDate(birth.value) : '', death: death?.fact === 'death_year_approximate' && !/ок|прибл/i.test(deathText) ? `ок. ${deathText}` : deathText };
}

export function lineageSets(data) {
  function ancestors(start) {
    const found = new Set([start]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
      for (const edge of data.relationships.filter(r => r.child_id === queue[i])) {
        if (!found.has(edge.parent_id)) { found.add(edge.parent_id); queue.push(edge.parent_id); }
      }
    }
    return found;
  }
  const paternal = ancestors('P002');
  paternal.add('P016');
  const maternal = ancestors('P003');
  ['P020', 'P021', 'P022', 'P023'].forEach(id => maternal.add(id));
  return { paternal, maternal };
}

export function matchesSearch(person, query) {
  const normalize = s => s.toLocaleLowerCase('ru').replaceAll('ё', 'е');
  return normalize(`${person.name} ${person.role || ''} ${person.id}`).includes(normalize(query.trim()));
}

export function sourceIdsForPerson(data, personId) {
  return [...new Set([
    ...Object.entries(data.presentation?.sources||{}).filter(([,s])=>s.person_ids?.includes(personId)).map(([id])=>id),
    ...data.claims.filter(c => c.person_id === personId).flatMap(c => c.source_ids || []),
    ...data.relationships.filter(r => r.parent_id === personId || r.child_id === personId).flatMap(r => r.source_ids || []),
    ...(data.candidate_links || []).filter(h => h.candidate_id === personId || h.target_id === personId).flatMap(h => h.source_ids || []),
  ])];
}

export function validateData(data) {
  const people = new Set(data.people.map(p => p.id));
  const sources = new Set(data.sources.map(s => s.id));
  if (people.size !== data.people.length || sources.size !== data.sources.length) throw new Error('Повтор идентификатора');
  for (const c of data.claims) {
    if (!people.has(c.person_id) || !c.source_ids?.length || c.source_ids.some(id => !sources.has(id))) throw new Error(`Некорректное основание ${c.id}`);
  }
  for (const h of data.candidate_links || []) {
    if (!people.has(h.candidate_id) || !people.has(h.target_id)) throw new Error(`Неизвестный кандидат ${h.id}`);
  }
  return true;
}

export function candidateType(data, id) {
  const h = data.candidate_links.find(item => item.candidate_id === id);
  if (!h) return 'family';
  if(data.presentation?.candidates[id]?.decision==='rejected') return 'weak';
  if (h.status === 'strong' || h.status === 'confirmed') return 'strong';
  if (h.relation_type === 'possible_collateral') return 'collateral';
  if (h.status === 'tentative' || data.presentation?.candidates[id]?.label === 'Есть возражения') return 'conflict';
  return 'weak';
}

export function personContext(data, id) {
  const h = data.candidate_links.find(item => item.candidate_id === id);
  const ui = data.presentation?.people[id];
  const recordLabel=data.presentation?.candidates[id]?.record_label;
  return h ? {category:'candidate',label:data.presentation?.candidates[id]?.label || STATUS[h.status],relationship:(h.relation_type === 'possible_collateral' ? 'Проверяем боковое родство' : 'Проверяем совпадение личности')+(recordLabel?' · '+recordLabel:'')}
    : {category:ui?.category || 'family',label:ui?.certainty==='unknown'?'Родство уточняем':ui?.certainty==='documented'?'Есть документ':ui?.family_hypothesis||ui?.certainty==='hypothesis' ? 'Семейная версия' : ui?.category === 'mention' ? 'Родство неизвестно' : 'Известно семье',relationship:ui?.relationship || 'Семейные сведения'};
}

export function sourcePeople(data, sourceId) {
  return data.presentation?.sources[sourceId]?.person_ids || [...new Set(data.claims.filter(c=>c.source_ids.includes(sourceId)).map(c=>c.person_id))];
}

export function artifactsForSource(data, id) {
  return (data.artifacts || []).filter(a=>a.name.startsWith(id+'-') || a.name.startsWith(id+'_') ||
    (['S010','S011','S012'].includes(id) && a.name==='S010-S012-access-notes.md') ||
    (['S013','S014','S015'].includes(id) && a.name==='S013-S015-follow-up-notes.md') ||
    (['S017','S018','S019','S020','S021','S022'].includes(id) && a.name==='S017-S022-maternal-search-notes.md'));
}

export function sourceMatches(data, source, query='', personId='', group='all') {
  const ui=data.presentation?.sources[source.id] || {};
  if (group!=='all' && ui.group!==group) return false;
  if (personId && !sourcePeople(data,source.id).includes(personId)) return false;
  const names=sourcePeople(data,source.id).map(id=>data.people.find(p=>p.id===id)?.name || '').join(' ');
  const norm=s=>String(s).toLocaleLowerCase('ru').replaceAll('ё','е');
  return norm([source.title,source.locator,ui.title,ui.summary,names].join(' ')).includes(norm(query.trim()));
}

export function familyPeople(data) {
  const candidates=new Set(data.candidate_links.map(h=>h.candidate_id));
  return data.people.filter(p=>!candidates.has(p.id));
}

export function displayClaims(data, id) {
  const claims=currentClaims(data,id);
  const birth=field(data,id,['birth_date_reported','birth_date','birth_date_as_reported','rvk_birth_date']);
  const death=field(data,id,['death_date_reported','death_date']);
  return claims.filter(c=>{
    if(c.fact==='identity_match_rvk_candidate') return false; // Explained in the candidate comparison.
    if(c.fact==='birth_year' && birth && String(birth.value).startsWith(String(c.value))) return false;
    if(c.fact==='death_year' && death && String(death.value).startsWith(String(c.value))) return false;
    return true;
  });
}

export function validatePresentation(data) {
  const ui=data.presentation;
  if (!ui) throw new Error('Отсутствуют понятные описания');
  for (const p of data.people) {
    if (!ui.people[p.id] && !ui.candidates[p.id]) throw new Error('Нет пояснения человека '+p.id);
  }
  for (const h of data.candidate_links) {
    const item=ui.candidates[h.candidate_id];
    if (!item?.conclusion || !item.matches?.length || !item.objections?.length || !item.next_step || !item.comparison?.length) throw new Error('Неполный разбор версии '+h.id);
    if (item.document_ids.some(id=>!data.sources.some(s=>s.id===id))) throw new Error('Нет документа версии '+h.id);
  }
  for (const source of data.sources) {
    const item=ui.sources[source.id];
    if (!item?.title || !item.summary || !item.limit || !item.kind_label || !item.group) throw new Error('Неполное описание документа '+source.id);
    if (item.person_ids.some(id=>!data.people.some(p=>p.id===id))) throw new Error('Неизвестный человек в документе '+source.id);
    if (item.primary_file && !artifactsForSource(data,source.id).some(a=>a.name===item.primary_file)) throw new Error('Нет копии документа '+source.id);
  }
  return true;
}
