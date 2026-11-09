import { verifyCmsIntegrity } from './cms-integrity.js';
import { PDFDocument, PDFSignature, PDFName, PDFArray, PDFHexString } from 'pdf-lib';
import { fromBER } from 'asn1js';
import { ContentInfo, SignedData } from 'pkijs';

const clean = value => String(value || '').normalize('NFKC').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export function comparePrintedSigner(name, text) {
  const parts = clean(name).split(' ');
  if (parts.length !== 3 || parts.some(part => part.length < 2)) return 'unknown';
  const lines = String(text || '').split('\n');
  const contexts = [];
  for (let i = 0; i < lines.length; i++) {
    if (/кому\s*выдан|владелец\s*сертификата|подписант|руководитель.*лаборатории|инициалы.*фамилия/i.test(lines[i])) {
      contexts.push(lines.slice(Math.max(0,i-1),i+3).join(' '));
    }
  }
  if (!contexts.length) return 'unknown';
  const stampContexts=contexts.filter(context=>/кому\s*выдан|владелец\s*сертификата/i.test(context));
  const selected=stampContexts.length?stampContexts:contexts;
  const full = parts.join(' '), initials = [parts[1][0],parts[2][0]];
  if (stampContexts.length) {
    const names = stampContexts.map(context => context.match(/(?:кому\s*выдан|владелец\s*сертификата)\s*:?\s*([\p{L}-]+)\s+([\p{L}-]+)\s+([\p{L}-]+)/iu)?.slice(1).join(' ')).filter(Boolean);
    if (!names.length) return 'unknown';
    return names.every(name=>clean(name)===full)?'match':'mismatch';
  }
  for (const context of selected) {
    const words=clean(context).split(' ');
    if ((' '+words.join(' ')+' ').includes(' '+full+' ')) return 'match';
    for(let i=0;i<words.length;i++) if(words[i]===parts[0] &&
      ((words[i-2]===initials[0] && words[i-1]===initials[1]) || (words[i+1]===initials[0] && words[i+2]===initials[1]))) return 'match';
  }
  return 'unknown';
}

export async function inspectPdfScreening(input, text = '') {
  const result = { screening: true, presence: 'unknown', identity: 'unknown', additions: 'unknown', integrity: 'unknown' };
  try {
    const bytes = new Uint8Array(input);
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const signatures = pdf.getForm().getFields().filter(field => field instanceof PDFSignature)
      .map(field => pdf.context.lookup(field.acroField.dict.get(PDFName.of('V')))).filter(Boolean);
    if (!signatures.length) return { ...result, presence: 'absent' };
    result.presence = 'present';
    if (signatures.length > 12) return result;
    const identities = [], ends = [], integrity = [];
    let selfIssued = false;
    let unknownRange = false;
    for (const signature of signatures) {
      const range = signature.lookup(PDFName.of('ByteRange'));
      const contents = signature.lookup(PDFName.of('Contents'));
      if (!(range instanceof PDFArray) || !(contents instanceof PDFHexString)) { unknownRange=true; continue; }
      const v = range.asArray().map(item => item.asNumber?.());
      const [start,length,second,rest]=v;
      if (v.length!==4 || v.some(n=>!Number.isSafeInteger(n)||n<0) || start!==0 || length>=second || second+rest>bytes.length) {unknownRange=true;continue;}
      const gap = new TextDecoder('ascii').decode(bytes.subarray(length,second));
      if (!/^<[\da-f\s]+>$/i.test(gap) || gap.slice(1,-1).replace(/\s/g,'').toLowerCase()!==contents.asString().replace(/\s/g,'').toLowerCase()) {unknownRange=true;continue;}
      ends.push(second+rest);
      try {
        const info=new ContentInfo({schema:fromBER(contents.asBytes()).result});
        if(info.contentType!=='1.2.840.113549.1.7.2') {identities.push('unknown');continue;}
        const cms=new SignedData({schema:info.content});
        const data=new Uint8Array(length+rest);
        data.set(bytes.subarray(0,length));data.set(bytes.subarray(second,second+rest),length);
        const checked=await verifyCmsIntegrity(cms,data);
        integrity.push(checked.status);selfIssued ||= checked.selfIssued || false;
        for(const signer of cms.signerInfos) {
          const cert=cms.certificates?.find(c=>c.serialNumber?.isEqual(signer.sid.serialNumber) && c.issuer?.isEqual(signer.sid.issuer));
          const name=cert?.subject.typesAndValues.find(x=>x.type==='2.5.4.3')?.value.valueBlock.value;
          identities.push(comparePrintedSigner(name,text));
        }
      } catch {identities.push('unknown');integrity.push('unsupported');}
    }
    result.integrity=integrity.includes('invalid')?'invalid':!unknownRange && integrity.length===signatures.length && integrity.every(s=>s==='valid')?'valid':'unknown';
    result.selfIssued=selfIssued;
    result.identity=identities.includes('mismatch')?'mismatch':identities.length && identities.every(x=>x==='match')?'match':'unknown';
    // This only checks ByteRange coverage, NOT cryptographic integrity or allowed change types.
    result.additions=unknownRange || !ends.length?'unknown':ends.some(end=>end<bytes.length)?'present':'absent';
    return result;
  } catch {return result;}
}

export function screeningStatusText(check) {
  if(check.presence!=='present') return '❌ Подпись: '+(check.presence==='absent'?'встроенная подпись не найдена.':'наличие подписи не определено.');
  const issues=[];
  if(check.identity!=='match') issues.push(check.identity==='mismatch'?'ФИО не совпадает':'ФИО не сверено');
  if(check.integrity!=='valid') issues.push(check.integrity==='invalid'?'нарушена целостность':'целостность не проверена');
  if(check.additions!=='absent') issues.push(check.additions==='present'?'есть неподписанные дополнения':'дополнения не проверены');
  if(check.selfIssued) issues.push('самовыданный сертификат');
  const status=issues.length
    ? '❌ Подпись: '+issues.join('; ')+'. Нужна ручная проверка.'
    : '🟢 Подпись: ФИО совпадает, целостность подтверждена.';
  return status+'\nДоверие к сертификату и полномочия не проверялись.';
}
