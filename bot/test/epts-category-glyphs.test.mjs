import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVehicleDocument, calculateUtil } from '../src/document-processing.js';
const row=(label,value,y)=>({y,text:`${label} ${value}`,items:[{x:77,str:label},{x:395,str:value}]});
function document(category) {
  return {text:'Выписка из электронного паспорта транспортного средства\nДвигатель внутреннего сгорания',pages:[[
    row('Марка','TEST',700),row('Коммерческое наименование','CAR',680),
    row('Категория транспортного средства в соответствии с Конвенцией о дорожном движении','категория В',650),
    row('Категория в соответствии с ТР ТС 018/2011',category,620),
    row('Месяц и год изготовления','Январь 2025',580),
    row('- рабочий объем цилиндров (см³)','1997',500),
    row('- максимальная мощность (кВт) (мин-1)','184 (5500)',480),
    row('Технически допустимая максимальная масса','2550',460)
  ]]};
}

test('EPTS category Ml is M1 despite the font mapping; all engine data remains intact',()=>{
  const vehicle=parseVehicleDocument(document('Ml'));
  assert.deepEqual({category:vehicle.category,ccm:vehicle.ccm,power:vehicle.totalKw,maxMass:vehicle.maxMass,year:vehicle.year,month:vehicle.manufactureMonth},
    {category:'M1',ccm:1997,power:184,maxMass:2550,year:2025,month:1});
  const standard=parseVehicleDocument(document('M1'));
  assert.deepEqual(calculateUtil(vehicle,new Date('2026-11-06')),calculateUtil(standard,new Date('2026-11-06')));
});

test('only category-field glyph variants are normalized; cargo codes remain distinct',()=>{
  for(const [input,expected] of [['MI','M1'],['М1','M1'],['Мl','M1'],['MІ','M1'],['M 1','M1'],['N1','N1'],['N1G','N1G'],['NlG','N1G'],['N2','N2'],['N3','N3'],['M2','M2']]) {
    assert.equal(parseVehicleDocument(document(input)).category,expected,input);
  }
});

test('missing or unknown technical category is never inferred from the road category or model',()=>{
  for(const category of ['', 'не определена', 'категория В', 'Ml / N2']) {
    const vehicle=parseVehicleDocument(document(category));
    assert.notEqual(vehicle.category,'M1',category);
    assert.throws(()=>calculateUtil(vehicle,new Date('2026-11-06')),/Категория/);
  }
});
