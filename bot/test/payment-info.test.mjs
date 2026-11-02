import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {PAYMENT_QR_PAYLOAD,PAYMENT_QR_PNG} from '../src/payment-qr.js';
const source=fs.readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
test('payment QR sends the supplied image with payer instructions and keeps the menu available',async()=>{
 const calls=[];
 const context=vm.createContext({FormData,Blob,Uint8Array,atob,PAYMENT_QR_PNG,
 INFO:{payment_qr:{text:'Укажите сумму и ИНН заявителя'}},
 telegram:async(_env,method,data)=>{calls.push({method,data});return {message_id:2}},
 trackTemporaryMessage:async()=>{}});
 vm.runInContext(source.slice(source.indexOf('async function showInfo('),source.indexOf('async function showServices(')),context);
 await context.showInfo({}, {chat:{id:1},message_id:1},'payment_qr');
 assert.equal(calls.length,1);assert.equal(calls[0].method,'sendPhoto');
 const form=calls[0].data;
 assert.equal(form.get('chat_id'),'1');assert.match(form.get('caption'),/ИНН заявителя/);
 assert.deepEqual(Buffer.from(await form.get('photo').arrayBuffer()),Buffer.from(PAYMENT_QR_PNG,'base64'));
 assert.match(PAYMENT_QR_PAYLOAD,/Purpose=Внесение авансовых платежей/);
 assert.doesNotMatch(PAYMENT_QR_PAYLOAD,/\|(?:Sum|PayerINN)=/);
});
test('text details contain every field from the supplied QR and no placeholders',()=>{
 const block=source.slice(source.indexOf('  payment_details: {'),source.indexOf('  sbkts: {'));
 for(const field of PAYMENT_QR_PAYLOAD.split('|').slice(1)) assert.ok(block.includes(field.split('=')[1]),field);
 assert.match(block,/ИНН заявителя/);assert.doesNotMatch(block,/будут добавлены/);
});
