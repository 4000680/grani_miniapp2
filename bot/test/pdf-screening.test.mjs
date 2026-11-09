import test from 'node:test';import assert from 'node:assert/strict';
import { comparePrintedSigner, inspectPdfScreening, screeningStatusText } from '../src/pdf-screening.js';
import { PDFDocument } from 'pdf-lib';
test('compares holder stamp and signed-name initials without a registry of people',()=>{
 assert.equal(comparePrintedSigner('Тестов Иван Петрович','Кому выдан: Тестов Иван Петрович'),'match');
 assert.equal(comparePrintedSigner('Тестов Иван Петрович','И. П. Тестов\nРуководитель испытательной лаборатории'),'match');
 assert.equal(comparePrintedSigner('Тестов Иван Петрович','Кому выдан: Другов Петр Иванович\nИ. П. Тестов\nРуководитель испытательной лаборатории'),'mismatch');
 assert.equal(comparePrintedSigner('Тестов Иван Петрович','Заявитель: Тестов Иван Петрович'),'unknown');
 assert.equal(comparePrintedSigner('', 'Кому выдан: Тестов Иван Петрович'),'unknown');
});
test('unknown and missing signature cannot produce matching results',async()=>{
 const doc=await PDFDocument.create();doc.addPage();
 const absent=await inspectPdfScreening(await doc.save());
 assert.equal(absent.presence,'absent');assert.equal(absent.identity,'unknown');assert.equal(absent.additions,'unknown');
 assert.doesNotMatch(screeningStatusText(absent),/🟢/);
 assert.equal((await inspectPdfScreening(new Uint8Array())).presence,'unknown');
});
const passed = { screening:true, presence:'present', identity:'match', integrity:'valid', additions:'absent', selfIssued:false };
test('successful screening is compact and states its limited scope',()=>{
 const text=screeningStatusText(passed);
 assert.equal(text,'🟢 Подпись: ФИО совпадает, целостность подтверждена.\nДоверие к сертификату и полномочия не проверялись.');
});
test('every failed or incomplete check removes the green status and keeps its reason',()=>{
 for(const [change,reason] of [
  [{presence:'absent'},/подпись не найдена/],
  [{presence:'unknown'},/наличие подписи не определено/],
  [{identity:'mismatch'},/ФИО не совпадает/],
  [{identity:'unknown'},/ФИО не сверено/],
  [{integrity:'invalid'},/нарушена целостность/],
  [{integrity:'unknown'},/целостность не проверена/],
  [{additions:'present'},/есть неподписанные дополнения/],
  [{additions:'unknown'},/дополнения не проверены/],
  [{selfIssued:true},/самовыданный сертификат/]
 ]) {
  const text=screeningStatusText({...passed,...change});
  assert.match(text,/^❌/);assert.doesNotMatch(text,/🟢/);assert.match(text,reason);
 }
});
test('multiple problems are retained in one warning, with no successful-check clutter',()=>{
 const text=screeningStatusText({...passed,identity:'unknown',integrity:'invalid',selfIssued:true});
 assert.match(text,/ФИО не сверено; нарушена целостность; самовыданный сертификат/);
 assert.equal(text.split('❌').length,2);
 assert.doesNotMatch(text,/подтверждена|не обнаружены/);
});
