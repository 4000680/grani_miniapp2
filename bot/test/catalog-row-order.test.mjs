import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import {
  getCatalogCandidate, getCatalogVariants, listCatalogModifications,
  listCatalogNeighborYears, listCatalogSuggestions, parseCatalogQuery, searchCatalog
} from '../src/catalog-search.js';

function fixture() {
  return {
    brands:['ALPHA','BETA','GAMMA','EMPTY'],
    models:['ROAD','VAN','TRUCK'], eco:[],
    rows:[
      [2,2,2026,-1,300,0,18000],
      [0,0,2026,-1,110,0,1900],
      [1,1,2026,-1,140,0,3500],
      [0,0,2024,-1,100,0,1800],
      [2,2,2025,-1,290,0,17000],
      [0,0,2026,-1,120,15,2100],
      [1,1,2026,-1,150,0,4000]
    ]
  };
}

test('unsorted rows are indexed once without moving the original rows',()=>{
  const catalog=fixture();
  const original=structuredClone(catalog);
  for(let iteration=0;iteration<2;iteration++) {
    for(const [query,expected] of [['ALPHA ROAD 2026',[1,5]],['BETA VAN 2026',[2,6]],['GAMMA TRUCK 2026',[0]]]) {
      const found=listCatalogModifications(catalog,parseCatalogQuery(query));
      assert.equal(found.length,1,query);
      assert.deepEqual(found[0].rowIndexes,expected,query);
    }
  }
  assert.deepEqual(catalog,original);
});

test('selection retrieves the original power and mass after an unsorted search',()=>{
  const catalog=fixture(), query=parseCatalogQuery('ALPHA ROAD 2026');
  const [found]=listCatalogModifications(catalog,query);
  const variants=getCatalogVariants(catalog,found.brandIndex,found.modelIndex,found.year);
  assert.deepEqual(variants.map(item=>[item.rowIndex,item.combustionKw,item.electricKw,item.mass]),[
    [1,110,0,1900],[5,120,15,2100]
  ]);
  const selected=searchCatalog(catalog,query,2100);
  assert.equal(selected.length,1);
  assert.equal(selected[0].rowIndex,5);
  assert.equal(getCatalogCandidate(catalog,selected[0].rowIndex).mass,2100);
});

test('fuzzy suggestions and neighboring years use all rows of only the selected brand',()=>{
  const catalog=fixture();
  const suggestions=listCatalogSuggestions(catalog,parseCatalogQuery('ALPHA RAOD 2026'));
  assert.deepEqual(suggestions.map(item=>item.rowIndexes),[[1,5]]);
  const neighbors=listCatalogNeighborYears(catalog,parseCatalogQuery('ALPHA ROAD 2025'));
  assert.deepEqual(neighbors.map(item=>[item.year,item.rowIndexes]),[[2026,[1,5]],[2024,[3]]]);
  assert.deepEqual(listCatalogModifications(catalog,parseCatalogQuery('EMPTY ROAD 2026')),[]);
  assert.deepEqual(listCatalogSuggestions(catalog,parseCatalogQuery('EMPTY ROAD 2026')),[]);
});

test('live Tucson, RAV4 and Sportage include every source row with valid callback indexes',()=>{
  const encoded=fs.readFileSync(new URL('../../tabs/utilsbor/spravochnik.json.gz.b64',import.meta.url),'utf8');
  const catalog=JSON.parse(zlib.inflateSync(Buffer.from(encoded.trim(),'base64')));
  for(const [brand,model] of [['HYUNDAI','TUCSON'],['TOYOTA','RAV4'],['KIA','SPORTAGE']]) {
    const expected=catalog.rows.flatMap((row,index)=>
      catalog.brands[row[0]].toUpperCase()===brand && catalog.models[row[1]].toUpperCase()===model && Number(row[2])===2026 ? [index] : []);
    assert.ok(expected.length>0,`${brand} ${model} fixture must exist`);
    const found=listCatalogModifications(catalog,parseCatalogQuery(`${brand} ${model} 2026`));
    assert.equal(found.length,1,`${brand} ${model}`);
    assert.deepEqual(found[0].rowIndexes,expected);
    for(const index of found[0].rowIndexes) {
      const candidate=getCatalogCandidate(catalog,index), row=catalog.rows[index];
      assert.equal(candidate.brand.toUpperCase(),brand);
      assert.equal(candidate.model.toUpperCase(),model);
      assert.equal(candidate.combustionKw,Number(row[4])||0);
      assert.equal(candidate.mass,Number(row[6])||null);
    }
  }
});
