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
