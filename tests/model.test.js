import test from 'node:test';
import assert from 'node:assert/strict';
import { currentClaims, dates, matchesSearch, lineageSets, validateData, sourceIdsForPerson } from '../web/model.js';

const data = {
  people: [{id:'P001',name:'Ребёнок'}, {id:'P002',name:'Отец'}, {id:'P003',name:'Мать'}, {id:'P004',name:'Предок'}, {id:'P024',name:'Кандидат'}],
  sources: [{id:'S1'}, {id:'S2'}],
  claims: [
    {id:'C1',person_id:'P004',fact:'death_date_reported_approximate',value:'январь 1980',source_ids:['S1'],current:false},
    {id:'C2',person_id:'P004',fact:'death_year',value:1980,source_ids:['S1']},
    {id:'C3',person_id:'P004',fact:'death_date_reported',value:'1979-11-24',source_ids:['S2']},
  ],
  relationships: [{parent_id:'P002',child_id:'P001'}, {parent_id:'P003',child_id:'P001'}, {parent_id:'P004',child_id:'P002'}],
  candidate_links: [{id:'H1',candidate_id:'P024',target_id:'P004',source_ids:['S2']}],
};
test('точная исправленная дата имеет приоритет над старым годом и воспоминанием', () => {
  assert.equal(dates(data,'P004').death,'24.11.1979');
  assert.equal(currentClaims(data,'P004').length,2);
});
test('кандидат не становится предком из-за гипотезы тождества', () => {
  const sets = lineageSets(data);
  assert.ok(sets.paternal.has('P004'));
  assert.ok(!sets.paternal.has('P024'));
  assert.ok(!sets.maternal.has('P004'));
});
test('поиск учитывает е/ё и регистр', () => {
  assert.ok(matchesSearch({id:'P1',name:'Печёнкина Анна'},'ПЕЧЕНКИНА'));
  assert.ok(!matchesSearch({id:'P1',name:'Анна'},'Дарья'));
});
test('источники кандидата сохраняются у целевого человека', () => {
  assert.deepEqual(sourceIdsForPerson(data,'P004'),['S1','S2']);
});
test('нарушенная ссылка на источник отклоняется', () => {
  assert.ok(validateData(data));
  const broken = structuredClone(data); broken.claims[0].source_ids=['NOPE'];
  assert.throws(() => validateData(broken), /основание/);
});
