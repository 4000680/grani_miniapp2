import '../../shared/catalog-match.js';

const DEFAULT_CATALOG_URL = 'https://4000680.github.io/grani_miniapp2/tabs/utilsbor/spravochnik.json.gz.b64';
const { normalize, similarity, tokenSimilarity, tokens: searchTokens, transliterate } = globalThis.GraniCatalogMatch;
const BRAND_ALIASES = {
  'КИА':'KIA','БМВ':'BMW','МЕРСЕДЕС':'MERCEDES-BENZ','АУДИ':'AUDI','ТОЙОТА':'TOYOTA','ХОНДА':'HONDA','НИССАН':'NISSAN','МАЗДА':'MAZDA',
  'ХЕНДАЙ':'HYUNDAI','ХЮНДАЙ':'HYUNDAI','ФОЛЬКСВАГЕН':'VOLKSWAGEN','ШКОДА':'SKODA','РЕНО':'RENAULT','ФОРД':'FORD','ЛЕКСУС':'LEXUS',
  'ВОЛЬВО':'VOLVO','ПОРШЕ':'PORSCHE','ДЖИЛИ':'GEELY','ЧЕРИ':'CHERY','ХАВАЛ':'HAVAL','ХАВЕЙЛ':'HAVAL','БАЙДИ':'BYD','ЗИКР':'ZEEKR',
  'ГАК':'GAC','GAK':'GAC','ТРАМЧИ':'TRUMPCHI','ТРАНЧИ':'TRUMPCHI'
};
const RELATED_BRANDS = { GAC: new Set(['GAC','TRUMPCHI']), TRUMPCHI: new Set(['GAC','TRUMPCHI']) };
let catalogPromise = null;
let catalogLoadedAt = 0;
const catalogIndexes = new WeakMap();

export function normalizeCatalogText(value) { return normalize(value).toUpperCase(); }

export function parseCatalogQuery(text) {
  const source = String(text || '').trim();
  const years = [...source.matchAll(/\b((?:19|20)\d{2})\b/g)];
  if (years.length > 1) return null;
  const year = years.length ? Number(years[0][1]) : null;
  const withoutYear = years.length ? source.replace(years[0][0], ' ') : source;
  const words = normalizeCatalogText(withoutYear).split(' ').filter(word => word && !['ГОД','ГОДА','Г','YEAR'].includes(word));
  if (!words.length) return null;
  if (BRAND_ALIASES[words[0]]) words[0] = BRAND_ALIASES[words[0]];
  return { year, vehicleText: words.join(' '), tokens: words };
}

function base64Bytes(value) {
  const binary = atob(value), bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
async function inflateJson(base64) {
  const stream = new Blob([base64Bytes(base64.trim())]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).json();
}
export async function loadCatalog(url = DEFAULT_CATALOG_URL) {
  if (catalogPromise && Date.now() - catalogLoadedAt < 60 * 60 * 1000) return catalogPromise;
  catalogLoadedAt = Date.now();
  catalogPromise = fetch(url, { headers:{accept:'text/plain'}, cf:{cacheTtl:3600,cacheEverything:true} }).then(async response => {
    if (!response.ok) throw new Error(`шаблон СЭП недоступен (HTTP ${response.status})`);
    const parsed = await inflateJson(await response.text());
    if (!Array.isArray(parsed?.brands) || !Array.isArray(parsed?.models) || !Array.isArray(parsed?.rows)) throw new Error('неверный формат шаблона СЭП');
    return parsed;
  }).catch(error => { catalogPromise = null; catalogLoadedAt = 0; throw error; });
  return catalogPromise;
}

function candidateFromRow(catalog, row, rowIndex) {
  return { rowIndex, brandIndex:row[0], modelIndex:row[1], brand:catalog.brands[row[0]]||'', model:catalog.models[row[1]]||'', year:Number(row[2]),
    eco:row[3]>=0?catalog.eco?.[row[3]]||'':'', combustionKw:Number(row[4])||0, electricKw:Number(row[5])||0,
    mass:Number(row[6])||null, massFrom:Number(row[7])||null, massTo:Number(row[8])||null };
}
export function getCatalogCandidate(catalog, rowIndex) {
  const row = catalog.rows[Number(rowIndex)];
  return row ? candidateFromRow(catalog, row, Number(rowIndex)) : null;
}

function catalogIndex(catalog) {
  if (catalogIndexes.has(catalog)) return catalogIndexes.get(catalog);
  const entries = new Map();
  for (let rowIndex=0; rowIndex<catalog.rows.length; rowIndex++) {
    const row=catalog.rows[rowIndex], key=`${row[0]}:${row[1]}:${row[2]}`;
    let entry=entries.get(key);
    if (!entry) {
      const brand=catalog.brands[row[0]]||'', model=catalog.models[row[1]]||'';
      entry={key,brandIndex:row[0],modelIndex:row[1],brand,model,year:Number(row[2]),rowIndexes:[],brandTokens:searchTokens(brand),modelTokens:searchTokens(model),brandCanonical:transliterate(brand).replace(/\s/g,'')};
      entries.set(key,entry);
    }
    entry.rowIndexes.push(rowIndex);
  }
  const result=[...entries.values()]; catalogIndexes.set(catalog,result); return result;
}

function brandMatch(queryTokens, entry) {
  let best={score:0,start:0,count:1,queryBrand:queryTokens[0]||'',related:false};
  const count=Math.min(Math.max(1,entry.brandTokens.length),queryTokens.length);
  for (let start=0; start<=queryTokens.length-count; start++) {
    const part=queryTokens.slice(start,start+count).join(' '), canonical=transliterate(part).replace(/\s/g,'');
    const related=RELATED_BRANDS[normalizeCatalogText(part)]?.has(normalizeCatalogText(entry.brand))||false;
    let score=related?1:similarity(canonical,entry.brandCanonical);
    if (canonical===entry.brandCanonical) score=1;
    else if (canonical.length>=3 && (canonical.startsWith(entry.brandCanonical)||entry.brandCanonical.startsWith(canonical))) score=Math.max(score,0.88);
    if (score>best.score) best={score,start,count,queryBrand:part,related};
  }
  return best;
}

function scoreEntry(parsedQuery, entry) {
  const queryTokens=searchTokens(parsedQuery.vehicleText), brand=brandMatch(queryTokens,entry);
  const modelQuery=queryTokens.filter((_,index)=>index<brand.start||index>=brand.start+brand.count);
  if (!modelQuery.length) return {score:brand.score*0.78,brandScore:brand.score,modelScore:0,exact:false,broad:true,strongMatches:0,relatedBrand:brand.related};
  const queryScores=modelQuery.map(token=>Math.max(0,...entry.modelTokens.map(candidate=>tokenSimilarity(token,candidate))));
  const candidateScores=entry.modelTokens.map(token=>Math.max(0,...modelQuery.map(candidate=>tokenSimilarity(token,candidate))));
  const queryCoverage=queryScores.reduce((s,v)=>s+v,0)/queryScores.length;
  const candidateCoverage=candidateScores.reduce((s,v)=>s+v,0)/Math.max(1,candidateScores.length);
  const strongest=Math.max(0,...queryScores), strongMatches=queryScores.filter(value=>value>=0.78).length;
  let modelScore=Math.max(queryCoverage*0.55+candidateCoverage*0.45,strongest*0.8);
  modelScore-=Math.min(0.12,Math.max(0,modelQuery.length-strongMatches)*0.025);
  const directedTokenMatch = queryToken => entry.modelTokens.some(candidateToken => {
    if (queryToken === candidateToken) return true;
    return queryToken.length >= 2 && candidateToken.length >= queryToken.length && candidateToken.includes(queryToken);
  });
  const exact=brand.score>=0.86 && modelQuery.every(directedTokenMatch);
  return {score:brand.score*0.4+Math.max(0,modelScore)*0.6,brandScore:brand.score,modelScore:Math.max(0,modelScore),exact,broad:false,strongMatches,relatedBrand:brand.related};
}

function rankedEntries(catalog, parsedQuery, mode) {
  if (!parsedQuery) return [];
  const matches=[];
  for (const entry of catalogIndex(catalog)) {
    if (parsedQuery.year && entry.year!==parsedQuery.year) continue;
    const rank=scoreEntry(parsedQuery,entry);
    if (mode==='exact') { if (!rank.exact) continue; }
    else {
      if (rank.brandScore<0.35 && !rank.strongMatches) continue;
      if (!rank.broad && !rank.strongMatches && rank.modelScore<0.48 && rank.brandScore<0.95) continue;
      if (rank.score<0.52 && rank.brandScore<0.95) continue;
    }
    matches.push({...entry,...rank,rowsCount:entry.rowIndexes.length});
  }
  return matches.sort((a,b)=>b.score-a.score||b.year-a.year||a.model.localeCompare(b.model,'ru'));
}

export function listCatalogSuggestions(catalog, parsedQuery, limit=26) {
  const ranked = rankedEntries(catalog,parsedQuery,'fuzzy');
  const top = ranked[0];
  const safeRanked = top?.brandScore >= 0.95
    ? ranked.filter(item => item.brandIndex === top.brandIndex || item.relatedBrand)
    : ranked.filter(item => !top || item.score >= top.score - 0.18);
  return safeRanked.slice(0,Math.max(1,Number(limit)||26))
    .map(item=>({...item,relatedBrand:Boolean(item.relatedBrand&&normalizeCatalogText(item.brand)!==normalizeCatalogText(parsedQuery.tokens?.[0]))}));
}
export function listCatalogModifications(catalog, parsedQuery) { return rankedEntries(catalog,parsedQuery,'exact'); }

export function paginateCatalogModifications(modifications,page=0,pageSize=8) {
  const size=Math.max(1,Math.floor(Number(pageSize))||8), pageCount=Math.max(1,Math.ceil(modifications.length/size));
  const currentPage=Math.min(Math.max(0,Math.floor(Number(page))||0),pageCount-1), startIndex=currentPage*size;
  return {items:modifications.slice(startIndex,startIndex+size),currentPage,pageCount,total:modifications.length,startIndex};
}
export function getCatalogVariants(catalog,brandIndex,modelIndex,year) {
  const variants=[],seen=new Set();
  for(let rowIndex=0;rowIndex<catalog.rows.length;rowIndex++){
    const row=catalog.rows[rowIndex];
    if(row[0]!==Number(brandIndex)||row[1]!==Number(modelIndex)||Number(row[2])!==Number(year))continue;
    const key=[Number(row[4])||0,Number(row[5])||0,Number(row[6])||0,Number(row[7])||0,Number(row[8])||0].join(':');
    if(seen.has(key))continue; seen.add(key); variants.push(candidateFromRow(catalog,row,rowIndex));
  }
  return variants.sort((a,b)=>(a.mass||a.massFrom||Infinity)-(b.mass||b.massFrom||Infinity)||(a.combustionKw+a.electricKw)-(b.combustionKw+b.electricKw));
}
export function paginateCatalogVariants(variants,page=0,pageSize=8) {
  const selectable=variants.filter(candidate=>candidate.mass),size=Math.max(1,Math.floor(Number(pageSize))||8),pageCount=Math.max(1,Math.ceil(selectable.length/size));
  const currentPage=Math.min(Math.max(0,Math.floor(Number(page))||0),pageCount-1);
  return {items:selectable.slice(currentPage*size,(currentPage+1)*size),currentPage,pageCount,total:selectable.length};
}
export function searchCatalog(catalog,parsedQuery,weight=null,limit=8) {
  let entries=listCatalogModifications(catalog,parsedQuery); if(!entries.length)entries=rankedEntries(catalog,parsedQuery,'fuzzy');
  const rows=entries.flatMap(entry=>entry.rowIndexes.map(rowIndex=>({entry,rowIndex,row:catalog.rows[rowIndex]})));
  let selected=rows;
  if(weight!==null&&weight!==undefined){const value=Number(weight),exact=rows.filter(item=>Number(item.row[6])&&Math.abs(Number(item.row[6])-value)<1),ranged=rows.filter(item=>Number(item.row[7])&&Number(item.row[8])&&value>=Number(item.row[7])&&value<=Number(item.row[8]));selected=exact.length?exact:ranged;}
  const seen=new Set();
  return selected.filter(item=>{const key=[item.row[0],item.row[1],item.row[2],Number(item.row[4])||0,Number(item.row[5])||0].join(':');if(seen.has(key))return false;seen.add(key);return true;})
    .map(item=>({...candidateFromRow(catalog,item.row,item.rowIndex),score:item.entry.score})).sort((a,b)=>b.score-a.score||a.model.localeCompare(b.model,'ru')).slice(0,limit);
}
export function parseCatalogWeight(value){const match=String(value||'').replace(/\s+/g,'').match(/\d{3,5}/);if(!match)return null;const weight=Number(match[0]);return weight>=500&&weight<=10000?weight:null;}
export function calculationPower(candidate,electric){if(electric){if(!candidate.electricKw)throw new Error('В шаблоне СЭП не указана 30-минутная мощность для электрорасчёта');return Math.round(candidate.electricKw*100)/100;}const total=candidate.combustionKw+candidate.electricKw;if(!total)throw new Error('В шаблоне СЭП не указана мощность автомобиля');return Math.round(total*100)/100;}
