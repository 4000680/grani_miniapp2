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
test('green labels explicitly describe only identity and unsigned additions, never authenticity',()=>{
 const text=screeningStatusText({screening:true,presence:'present',identity:'match',additions:'absent'});
 assert.match(text,/ФИО совпадает/);assert.match(text,/дополнения.*не обнаружены/);
 assert.match(text,/Доверие к сертификату и полномочия подписанта не проверялись/);
});
