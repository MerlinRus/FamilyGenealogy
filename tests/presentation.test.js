import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateType,personContext,sourcePeople,sourceClaims,sourceMatches,artifactsForSource,familyPeople,displayClaims,validatePresentation} from '../web/model.js';

const data={
  people:[{id:'P1',name:'Ёлкина Анна'},{id:'P2',name:'Ёлкин Василий'},{id:'P3',name:'Алексей'},{id:'P4',name:'Алексей'}],
  sources:[{id:'S1',title:'Донесение',locator:'Строка 2'},{id:'S2',title:'Семейный рассказ',locator:'Сообщение'}],
  candidate_links:[{id:'H1',candidate_id:'P2',target_id:'P1',status:'unproven',relation_type:'possible_collateral'},{id:'H2',candidate_id:'P4',target_id:'P3',status:'strong'}],
  claims:[
    {id:'C1',person_id:'P1',fact:'birth_year',value:1905,source_ids:['S2']},
    {id:'C2',person_id:'P1',fact:'birth_date',value:'1905-04-12',source_ids:['S2']},
    {id:'C3',person_id:'P1',fact:'death_year',value:1950,source_ids:['S2']},
    {id:'C4',person_id:'P1',fact:'death_date',value:'1949-06-11',source_ids:['S2']},
  ],
  artifacts:[{name:'S1-original.jpg',url:'/sources/S1-original.jpg'}],
  presentation:{people:{P1:{relationship:'Бабушка',category:'family'},P3:{relationship:'Прадедушка',category:'family'}},candidates:{
    P2:{label:'Возможная боковая родня',record_label:'Военный список',conclusion:'Родство не установлено',matches:['Фамилия'],objections:['Нет родителей'],next_step:'Найти семью',document_ids:['S1'],comparison:[{}]},
    P4:{label:'Очень похоже',conclusion:'Совпали даты',matches:['Дата'],objections:['Нет дочери'],next_step:'Найти дочь',document_ids:['S1'],comparison:[{}]},
  },sources:{
    S1:{title:'Военный список Василия',summary:'Белянино, военная запись',limit:'Родители не названы',group:'record',kind_label:'Скан',person_ids:['P2'],primary_file:'S1-original.jpg'},
    S2:{title:'Рассказ семьи об Анне',summary:'Известные даты',limit:'Актов нет',group:'family',kind_label:'Семейный рассказ',person_ids:['P1']},
  }},
};

test('семейная запись отличается от сильного кандидата и бокового кандидата',()=>{
  assert.equal(personContext(data,'P1').label,'Известно семье');
  assert.equal(personContext(data,'P4').category,'candidate');
  assert.equal(candidateType(data,'P4'),'strong');
  assert.equal(candidateType(data,'P2'),'collateral');
  assert.match(personContext(data,'P2').relationship,/боковое родство/);
  assert.deepEqual(familyPeople(data).map(p=>p.id),['P1','P3']);
});
test('поиск документа учитывает фамилию с е/ё, человеческое название, человека и тип',()=>{
  assert.equal(sourceMatches(data,data.sources[0],'ЕЛКИН','P2','record'),true);
  assert.equal(sourceMatches(data,data.sources[0],'военный список','P2','record'),true);
  assert.equal(sourceMatches(data,data.sources[0],'Белянино','P1','record'),false);
  assert.equal(sourceMatches(data,data.sources[0],'','P2','family'),false);
});
test('документ кандидата не становится документом его предполагаемого родственника',()=>{
  assert.deepEqual(sourcePeople(data,'S1'),['P2']);
  assert.equal(sourcePeople(data,'S1').includes('P1'),false);
});
test('повторный согласованный год скрыт из основного вида, конфликтующий год сохранён',()=>{
  assert.deepEqual(displayClaims(data,'P1').map(c=>c.id),['C2','C3','C4']);
  assert.equal(data.claims.length,4);
});
test('проверка описаний требует существующую копию, объяснение и источники версии',()=>{
  assert.equal(validatePresentation(data),true);
  const broken=structuredClone(data);broken.presentation.sources.S1.primary_file='S1-missing.jpg';
  assert.throws(()=>validatePresentation(broken),/Нет копии/);
  const noReason=structuredClone(data);noReason.presentation.candidates.P2.objections=[];
  assert.throws(()=>validatePresentation(noReason),/Неполный разбор/);
});
test('все общие заметки нескольких источников остаются доступны',()=>{
  const combined={artifacts:[{name:'S017-S022-maternal-search-notes.md'},{name:'S020-page.png'}]};
  assert.equal(artifactsForSource(combined,'S019').length,1);
  assert.equal(artifactsForSource(combined,'S020').length,2);
});

test('переход к источнику сохраняет человека и точный факт, не подмешивает родственников',()=>{
  const scoped=structuredClone(data);
  scoped.claims.push({id:'C5',person_id:'P3',fact:'birth_place_reported',value:'Другой город',source_ids:['S2']});
  scoped.claims[0].current=false;
  assert.deepEqual(sourceClaims(scoped,'S2','P1','C2').map(c=>c.id),['C2']);
  assert.deepEqual(sourceClaims(scoped,'S2','P1').map(c=>c.id),['C2','C3','C4']);
  assert.deepEqual(sourceClaims(scoped,'S2','P1','C5').map(c=>c.id),['C2','C3','C4']);
  assert.deepEqual(sourceClaims(scoped,'S2','P1','C1').map(c=>c.id),['C1']);
  assert.equal(sourceClaims(scoped,'S2').length,4);
  assert.deepEqual(sourceClaims(scoped,'S1','P1','C2'),[]);
});
