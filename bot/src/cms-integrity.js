import './gost-environment.js';
import gost from 'node-gost-crypto';

const GOST = new Map([
  ['1.2.643.7.1.1.1.1', { length: 256, digest: '1.2.643.7.1.1.2.2' }],
  ['1.2.643.7.1.1.1.2', { length: 512, digest: '1.2.643.7.1.1.2.3' }]
]);
const sameBytes = (a,b) => a.length===b.length && a.every((byte,i)=>byte===b[i]);

async function verifyGost(signer, cert, data, spec, contentType) {
  if (signer.digestAlgorithm.algorithmId !== spec.digest) return 'unsupported';
  const digestAlgorithm = { name: 'GOST R 34.11', version: 2012, length: spec.length };
  let signedData = data;
  if (signer.signedAttrs) {
    const attributes = signer.signedAttrs.attributes;
    const digests = attributes.filter(a=>a.type==='1.2.840.113549.1.9.4');
    const types = attributes.filter(a=>a.type==='1.2.840.113549.1.9.3');
    if (digests.length!==1 || types.length!==1 || digests[0].values.length!==1 || types[0].values.length!==1) return 'invalid';
    const digestValue=digests[0].values[0];
    if (digestValue.idBlock.tagClass!==1 || digestValue.idBlock.tagNumber!==4 || types[0].values[0].valueBlock.toString()!==contentType) return 'invalid';
    const computed = new Uint8Array(await gost.gostCrypto.subtle.digest(digestAlgorithm, data));
    if (!sameBytes(computed, new Uint8Array(digestValue.valueBlock.valueHexView))) return 'invalid';
    signedData=signer.signedAttrs.encodedValue;
    if (!signedData?.byteLength) return 'unsupported';
  }
  const key=await gost.gostCrypto.subtle.importKey('spki',cert.subjectPublicKeyInfo.toSchema().toBER(false),
    {name:'GOST R 34.10',version:2012,length:spec.length},true,['verify']);
  const valid=await gost.gostCrypto.subtle.verify({...key.algorithm,hash:digestAlgorithm},key,signer.signature.valueBlock.valueHexView,signedData);
  return valid?'valid':'invalid';
}

// Checks mathematical integrity ONLY. No chain trust, revocation or authority claim.
export async function verifyCmsIntegrity(cms, input) {
  if (!cms.signerInfos.length || cms.signerInfos.length>12 || cms.encapContentInfo.eContent
    || cms.encapContentInfo.eContentType!=='1.2.840.113549.1.7.1') return { status:'unsupported' };
  const data=new Uint8Array(input);
  const results=[];
  let selfIssued=false;
  for(let i=0;i<cms.signerInfos.length;i++) {
    const signer=cms.signerInfos[i];
    const cert=cms.certificates?.find(c=>c.serialNumber?.isEqual(signer.sid.serialNumber)&&c.issuer?.isEqual(signer.sid.issuer));
    if(!cert) {results.push('unsupported');continue;}
    selfIssued ||= cert.subject.isEqual(cert.issuer);
    try {
      const spec=GOST.get(cert.subjectPublicKeyInfo.algorithm.algorithmId);
      if(spec) {
        if(![cert.subjectPublicKeyInfo.algorithm.algorithmId, spec.length===256?'1.2.643.7.1.1.3.2':'1.2.643.7.1.1.3.3'].includes(signer.signatureAlgorithm.algorithmId)) {results.push('unsupported');continue;}
        results.push(await verifyGost(signer,cert,data,spec,cms.encapContentInfo.eContentType));
      } else {
        const verified=await cms.verify({signer:i,data:data.buffer,checkChain:false,extendedMode:true});
        results.push(verified.signatureVerified===true?'valid':'invalid');
      }
    } catch(error) {
      results.push(String(error?.message).includes("Message digest doesn't match")?'invalid':'unsupported');
    }
  }
  return {status:results.includes('invalid')?'invalid':results.every(s=>s==='valid')?'valid':'unsupported',selfIssued};
}
