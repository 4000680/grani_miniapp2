import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString, PDFSignature } from 'pdf-lib';
import { fromBER } from 'asn1js';
import { ContentInfo, SignedData } from 'pkijs';

// This module checks embedded signatures and byte integrity locally. It does NOT
// establish issuer authority, certificate trust, revocation or registry authenticity.
export async function inspectPdfSignature(input) {
  const bytes = new Uint8Array(input);
  try {
    const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
    const fields = pdf.getForm().getFields().filter(field => field instanceof PDFSignature);
    const signed = fields.map(field => pdf.context.lookup(field.acroField.dict.get(PDFName.of('V')))).filter(Boolean);
    if (!signed.length) return { status: 'absent', count: 0 };
    if (signed.length > 12) return { status: 'unverified', count: signed.length };
    const results = [];
    for (const dictionary of signed) results.push(await inspectSignature(dictionary, bytes));
    const status = ['invalid', 'changed', 'unverified', 'integrity-only'].find(value => results.some(result => result.status === value));
    return { status: status || 'unverified', count: signed.length, selfIssued: results.some(result => result.selfIssued) };
  } catch {
    // Unsupported encryption, parser or algorithm errors are NOT evidence of forgery.
    return { status: 'unverified', count: null };
  }
}

async function inspectSignature(dictionary, bytes) {
  if (!(dictionary instanceof PDFDict)) return { status: 'unverified' };
  const range = dictionary.lookup(PDFName.of('ByteRange'));
  const contents = dictionary.lookup(PDFName.of('Contents'));
  if (!(range instanceof PDFArray) || !(contents instanceof PDFHexString)) return { status: 'unverified' };
  const values = range.asArray().map(value => value.asNumber?.());
  const [start, length, second, rest] = values;
  if (values.length !== 4 || values.some(value => !Number.isSafeInteger(value) || value < 0)
    || start !== 0 || length >= second || second + rest > bytes.length) return { status: 'invalid' };
  // ByteRange must exclude exactly the signature's hex string, not arbitrary text.
  const gap = new TextDecoder('ascii').decode(bytes.subarray(length, second));
  if (!/^<[\da-f\s]+>$/i.test(gap) || gap.slice(1, -1).replace(/\s/g, '').toLowerCase() !== contents.asString().replace(/\s/g, '').toLowerCase()) return { status: 'invalid' };
  const subfilter = dictionary.lookup(PDFName.of('SubFilter'))?.toString();
  if (!['/adbe.pkcs7.detached', '/ETSI.CAdES.detached'].includes(subfilter)) return { status: 'unverified' };
  try {
    const asn = fromBER(contents.asBytes());
    if (asn.offset === -1) return { status: 'unverified' };
    const info = new ContentInfo({ schema: asn.result });
    if (info.contentType !== '1.2.840.113549.1.7.2') return { status: 'unverified' };
    const cms = new SignedData({ schema: info.content });
    // Detached PDF signatures must authenticate ByteRange, not embedded CMS data.
    if (cms.encapContentInfo.eContent) return { status: 'unverified' };
    if (!cms.signerInfos.length || cms.signerInfos.length > 12) return { status: 'unverified' };
    const data = new Uint8Array(length + rest);
    data.set(bytes.subarray(0, length)); data.set(bytes.subarray(second, second + rest), length);
    let selfIssued = false;
    for (let signer = 0; signer < cms.signerInfos.length; signer++) {
      const result = await cms.verify({ signer, data: data.buffer, checkChain: false, extendedMode: true });
      if (result.signatureVerified !== true) return { status: 'invalid' };
      const cert = result.signerCertificate;
      selfIssued ||= cert?.issuer?.isEqual(cert.subject) || false;
    }
    return { status: second + rest < bytes.length ? 'changed' : 'integrity-only', selfIssued };
  } catch (error) {
    if (String(error?.message).includes("Message digest doesn't match")) return { status: 'invalid' };
    return { status: 'unverified' };
  }
}

export function signatureStatusText(check) {
  switch (check?.status) {
    case 'absent': return '⚠️ Электронная подпись: встроенная подпись не найдена. Запросите подписанный оригинал (и файл подписи, если она отдельная).';
    case 'invalid': return '❌ Электронная подпись: проверка целостности не пройдена. Требуется проверка оригинала.';
    case 'changed': return '⚠️ Электронная подпись: после подписания в файл добавлены изменения. Требуется проверка оригинала.';
    case 'integrity-only': return check.selfIssued
      ? '⚠️ Электронная подпись: целостность проверена, найден самовыданный сертификат. Полномочия подписанта и подлинность документа не подтверждены.'
      : '⚠️ Электронная подпись: целостность проверена. Доверие к сертификату, полномочия подписанта и подлинность документа не подтверждены.';
    default: return '⚠️ Электронная подпись: проверку выполнить не удалось. Подлинность документа не подтверждена.';
  }
}
