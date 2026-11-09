import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import gost from 'node-gost-crypto';import {fromBER,Integer,OctetString,ObjectIdentifier} from 'asn1js';
import {Certificate,PublicKeyInfo,SignerInfo,IssuerAndSerialNumber,AlgorithmIdentifier,Attribute,SignedAndUnsignedAttributes} from 'pkijs';
import {verifyCmsIntegrity} from '../src/cms-integrity.js';
import {inspectPdfScreening} from '../src/pdf-screening.js';

async function syntheticCms(length) {
 const hash={name:'GOST R 34.11',version:2012,length};
 const algorithm={name:'GOST R 34.10',version:2012,length,hash,namedCurve:length===256?'X-256-A':'T-512-A'};
 const keys=await gost.gostCrypto.subtle.generateKey(algorithm,true,['sign','verify']);
 keys.publicKey.algorithm.id=`id-tc26-gost3410-12-${length}`;
 const spki=await gost.gostCrypto.subtle.exportKey('spki',keys.publicKey);
 const cert=new Certificate();cert.serialNumber=new Integer({value:7});cert.subjectPublicKeyInfo=new PublicKeyInfo({schema:fromBER(spki).result});
 const data=new TextEncoder().encode('Synthetic document: engine volume 1997');
 const digest=await gost.gostCrypto.subtle.digest(hash,data);
 const attrs=new SignedAndUnsignedAttributes({type:0,attributes:[
   new Attribute({type:'1.2.840.113549.1.9.4',values:[new OctetString({valueHex:digest})]}),
   new Attribute({type:'1.2.840.113549.1.9.3',values:[new ObjectIdentifier({value:'1.2.840.113549.1.7.1'})]})]});
 attrs.encodedValue=attrs.toSchema().toBER(false);new Uint8Array(attrs.encodedValue)[0]=0x31;
 const signature=await gost.gostCrypto.subtle.sign(algorithm,keys.privateKey,attrs.encodedValue);
 const signer=new SignerInfo({sid:new IssuerAndSerialNumber({issuer:cert.issuer,serialNumber:cert.serialNumber}),signedAttrs:attrs,
 digestAlgorithm:new AlgorithmIdentifier({algorithmId:length===256?'1.2.643.7.1.1.2.2':'1.2.643.7.1.1.2.3'}),
 signatureAlgorithm:new AlgorithmIdentifier({algorithmId:cert.subjectPublicKeyInfo.algorithm.algorithmId}),signature:new OctetString({valueHex:signature})});
 return {data,cms:{signerInfos:[signer],certificates:[cert],encapContentInfo:{eContentType:'1.2.840.113549.1.7.1'}}};
}
for(const length of [256,512]) test(`GOST ${length}: verifies intact CMS; rejects changed data, attributes and signature`,async()=>{
 const {data,cms}=await syntheticCms(length);
 assert.equal((await verifyCmsIntegrity(cms,data)).status,'valid');
 const changed=data.slice();changed[changed.length-1]^=1;
 assert.equal((await verifyCmsIntegrity(cms,changed)).status,'invalid');
 const attrs=new Uint8Array(cms.signerInfos[0].signedAttrs.encodedValue);attrs[attrs.length-1]^=1;
 assert.equal((await verifyCmsIntegrity(cms,data)).status,'invalid');attrs[attrs.length-1]^=1;
 cms.signerInfos[0].signature.valueBlock.valueHexView[0]^=1;
 assert.equal((await verifyCmsIntegrity(cms,data)).status,'invalid');
});
test('original external GOST control and a modified in-memory copy',{skip:!process.env.SBKTS_GOST_PDF},async()=>{
 const original=new Uint8Array(await readFile(process.env.SBKTS_GOST_PDF));
 assert.equal((await inspectPdfScreening(original)).integrity,'valid');
 const copy=original.slice();let index=-1;const marker=new TextEncoder().encode('/MediaBox');
 for(let i=0;i<copy.length-marker.length;i++)if(marker.every((v,j)=>copy[i+j]===v)){index=i;break;}
 assert.ok(index>=0);while(copy[index]!==0x5b)index++;while(copy[index]<0x30||copy[index]>0x39)index++;
 copy[index]=copy[index]===0x30?0x31:0x30;
 assert.equal((await inspectPdfScreening(copy)).integrity,'invalid');
});
