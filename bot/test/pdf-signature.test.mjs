import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFHexString, PDFNumber } from 'pdf-lib';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { inspectPdfSignature, signatureStatusText } from '../src/pdf-signature.js';

async function fixture(signed = false) {
  const doc = await PDFDocument.create();
  doc.addPage().drawText('TEST DOCUMENT 1997');
  if (signed) {
    const signature = doc.context.obj({ Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: 'adbe.pkcs7.detached',
      ByteRange: [0, 1111111111, 2222222222, 3333333333], Contents: PDFHexString.of('0'.repeat(16384)) });
    const field = doc.context.register(doc.context.obj({ FT: 'Sig', T: PDFHexString.fromText('TestSignature'), V: doc.context.register(signature) }));
    doc.catalog.set(PDFName.of('AcroForm'), doc.context.obj({ Fields: [field] }));
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
let signedPromise;
async function signedFixture() {
  if (!signedPromise) signedPromise = (async()=>{
    const dir = await mkdtemp(`${tmpdir()}/grani-sig-`);
    try {
      let bytes = await fixture(true);
      let text = bytes.toString('latin1');
      const start = text.indexOf('<'+'0'.repeat(100));
      const end = start + 16386;
      const old = '/ByteRange [ 0 1111111111 2222222222 3333333333 ]';
      const range = `/ByteRange [ 0 ${start} ${end} ${bytes.length-end} ]`;
      assert.ok(text.includes(old));
      text = text.replace(old,range.padEnd(old.length,' '));
      bytes = Buffer.from(text,'latin1');
      await writeFile(`${dir}/content`,Buffer.concat([bytes.subarray(0,start),bytes.subarray(end)]));
      execFileSync('openssl',['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:prime256v1','-nodes','-subj','/CN=Synthetic test signer','-days','2','-keyout',`${dir}/key`,'-out',`${dir}/cert`],{stdio:'ignore'});
      execFileSync('openssl',['cms','-sign','-binary','-md','sha256','-in',`${dir}/content`,'-signer',`${dir}/cert`,'-inkey',`${dir}/key`,'-outform','DER','-out',`${dir}/sig`],{stdio:'ignore'});
      const sig=await readFile(`${dir}/sig`);
      bytes.write(sig.toString('hex').padEnd(16384,'0'),start+1,'latin1');
      return bytes;
    } finally { await rm(dir,{recursive:true,force:true}); }
  })();
  return Buffer.from(await signedPromise);
}

test('an unsigned PDF does not become signed because its page says it is', async()=>{
  assert.equal((await inspectPdfSignature(await fixture())).status,'absent');
});
test('valid self-issued CMS verifies integrity but NEVER establishes document authenticity',async()=>{
  const result=await inspectPdfSignature(await signedFixture());
  assert.equal(result.status,'integrity-only'); assert.equal(result.selfIssued,true);
  assert.match(signatureStatusText(result),/не подтверждены/);
  assert.doesNotMatch(signatureStatusText(result),/✅/);
});
test('changing signed bytes fails verification',async()=>{
  const bytes=await signedFixture();const at=bytes.indexOf(Buffer.from('/MediaBox [ 0 0 595.28 841.89 ]'));
  assert.ok(at>=0); bytes[at+'/MediaBox [ 0 0 '.length]=0x36;
  assert.equal((await inspectPdfSignature(bytes)).status,'invalid');
});
test('additional unsigned revisions are reported rather than receiving a green tick',async()=>{
  const bytes=Buffer.concat([await signedFixture(),Buffer.from('\n% added after signing\n')]);
  assert.equal((await inspectPdfSignature(bytes)).status,'changed');
});
test('empty placeholder and malformed files cannot receive a verified status',async()=>{
  assert.equal((await inspectPdfSignature(await fixture(true))).status,'invalid');
  assert.equal((await inspectPdfSignature(Buffer.from('not a PDF'))).status,'unverified');
});

test('signature status is separate from recognition in both document result formats',async()=>{
  const { default: vm }=await import('node:vm');
  const source=await readFile(new URL('../src/index.js',import.meta.url),'utf8');
  const extract=name=>{const start=source.indexOf(`function ${name}(`);assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);};
  const context=vm.createContext({signatureStatusText,escapeHtml:String,formatPower:n=>`${n} кВт`,formatKw:n=>`${n} кВт`,todayUtc:()=>new Date('2026-11-09')});
  vm.runInContext(['formatDocumentResult','declarationVehicleLines','documentAgePrompt'].map(extract).join('\n'),context);
  for(const type of ['sbkts','epts']){
    const v={type,brand:'TEST',model:'CAR',year:2025,category:'M1',totalKw:184,ccm:1997,textLayerRepaired:true,
      signatureCheck:{status:'integrity-only',selfIssued:true}};
    const text=context.formatDocumentResult(v,[]);
    assert.match(text,/Электронная подпись/);assert.match(text,/самовыданный/);assert.match(text,/сверка с оригиналом/);
    assert.match(text,/1997 см³/);assert.match(text,/184 кВт/);
    assert.match(context.declarationVehicleLines(v).join('\n'),/подлинность документа не подтверждены/);
    assert.match(context.documentAgePrompt(v),/Электронная подпись/);
  }
});
