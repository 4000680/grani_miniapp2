import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {listCatalogModifications, listCatalogSuggestions, parseCatalogQuery, searchCatalog} from '../src/catalog-search.js';

function fixture(brands, modelsByBrand) {
  const models=[], rows=[];
  modelsByBrand.forEach((names,brandIndex)=>names.forEach(name=>{
    rows.push([brandIndex,models.length,2026,-1,120,0,1900,null,null]);
    models.push(name);
  }));
  return {brands,models,rows};
}

test('an exact brand cannot escape to another brand with a better model match', ()=>{
  const catalog=fixture(['ALPHA','OMEGA'],[['ROAD RV','TRUCK'],['ROAD U7']]);
  const query=parseCatalogQuery('Alpha Road U7 2026');
  assert.equal(listCatalogModifications(catalog,query).length,0);
  const suggestions=listCatalogSuggestions(catalog,query);
  assert.deepEqual(suggestions.map(item=>item.model),['ROAD RV']);
  assert.ok(suggestions.every(item=>item.brand==='ALPHA'));
  assert.ok(searchCatalog(catalog,query).every(item=>item.brand==='ALPHA'));
});

test('a confidently corrected brand typo remains fixed even when its model is missing', ()=>{
  const catalog=fixture(['LEXUS','LIXIANG','TOYOTA'],[['RX 350','LM500H'],['U7'],['U7']]);
  for(const brand of ['Lekus','Lexsu','Lexsus']) {
    assert.deepEqual(listCatalogSuggestions(catalog,parseCatalogQuery(`${brand} U7 2026`)),[]);
    const found=listCatalogSuggestions(catalog,parseCatalogQuery(`${brand} RX 350 2026`));
    assert.ok(found.length>0);
    assert.ok(found.every(item=>item.brand==='LEXUS'));
  }
});

test('exact brand recognition does not admit dozens of irrelevant models', ()=>{
  const unrelated=Array.from({length:40},(_,i)=>`TRUCK CODE${i}`);
  const catalog=fixture(['ALPHA','OMEGA'],[['ROAD RV',...unrelated],['ROAD U7']]);
  assert.deepEqual(listCatalogSuggestions(catalog,parseCatalogQuery('ALPHA ROAD U7 2026')).map(item=>item.model),['ROAD RV']);
});

test('a nonexistent model gives no suggestions rather than the whole recognized brand', ()=>{
  const catalog=fixture(['ALPHA','OMEGA'],[['TRUCK','VAN'],['ZZZZZZ']]);
  assert.deepEqual(listCatalogSuggestions(catalog,parseCatalogQuery('ALPHA ZZZZZZ 2026')),[]);
});

test('brand-only searches keep broad results and the existing 25-result limit', ()=>{
  const catalog=fixture(['ALPHA','OMEGA'],[Array.from({length:40},(_,i)=>`ROAD ${i}`),['ROAD']]);
  const found=listCatalogSuggestions(catalog,parseCatalogQuery('ALPHA 2026'));
  assert.equal(found.length,26);
  assert.ok(found.every(item=>item.brand==='ALPHA'));
});

test('reordered words and compound brands preserve the brand boundary', ()=>{
  const catalog=fixture(['ALPHA AND BETA','OMEGA'],[['ROAD RV'],['ROAD U7']]);
  for(const query of ['Alpha & Beta Road U7 2026','Road U7 AlphaBeta 2026']) {
    const found=listCatalogSuggestions(catalog,parseCatalogQuery(query));
    assert.deepEqual(found.map(item=>item.brand),['ALPHA AND BETA']);
  }
});

test('live Foton query keeps only relevant models within Foton', ()=>{
  const path=process.env.GRANI_BRAND_CATALOG || new URL('../../tabs/utilsbor/spravochnik.json.gz.b64',import.meta.url);
  const catalog=JSON.parse(zlib.inflateSync(Buffer.from(fs.readFileSync(path,'utf8').trim(),'base64')));
  const query=parseCatalogQuery('Foton Xiangling U7 2026');
  const exact=listCatalogModifications(catalog,query);
  const found=exact.length?exact:listCatalogSuggestions(catalog,query);
  assert.ok(found.length>0);
  assert.ok(found.length<26);
  assert.ok(found.every(item=>item.brand==='FOTON' && item.model.includes('XIANGLING')));
});
