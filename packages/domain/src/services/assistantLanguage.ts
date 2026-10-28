// MS46-TC07 / PRD-F26: fixed reviewed copy; source quotations are never translated.
export type AssistantLanguage = 'en' | 'tl' | 'taglish';
// MS61 v2 / PRD-F26: input understanding and answer language are independent.
export function assistantAnswerLanguage(): 'en' { return 'en'; }
export function assistantLanguage(message: string): AssistantLanguage {
  // MS61-TC02: an English task can explicitly request a localized answer.
  // This selects presentation intent, never certifies translation fidelity.
  const requested = /\b(?:in|sa|into)\s+(tagalog|filipino|taglish|english)\b/ig;
  let explicit: AssistantLanguage | undefined;
  for (const match of message.matchAll(requested)) {
    const prefix = message.slice(0, match.index).split(/[.!?;,]/).at(-1) ?? '';
    if (/\b(?:not|never|don't|huwag)\s+(?:\w+\s+){0,3}$/i.test(prefix)) continue;
    const name = match[1].toLowerCase();
    explicit = name === 'english' ? 'en' : name === 'taglish' ? 'taglish' : 'tl';
  }
  if (explicit) return explicit;
  const words = message.toLowerCase().match(/\p{L}+/gu) ?? [];
  // QAD-TC44: use sentence cues; English "May" and loanwords alone are ambiguous.
  const distinctive = /^(?:bakit|paano|sino|ano|anong|magkano|maaari|puwede|pwede|hindi|mga|ba|kailan|saan|naiwan|ilalagay|pakisabi|pakilinaw|gagawin|gamit|niya|dito)$/;
  const particles = words.filter(word => /^(?:ko|sa|na|ng|ang|ba|lang|naman|po|ito|siya)$/.test(word));
  if (!words.some(word => distinctive.test(word)) && new Set(particles).size < 2) return 'en';
  return /\b(how|can|please|show|report|check|payment|booking|staff|admin)\b/i.test(message) ? 'taglish' : 'tl';
}

// MS61-TC03/05/06: model support flags cannot reopen localization admission.
// Legacy callers retain their existing contract. No runtime switch or client
// claim can authorize translations on the negotiated main-answer path.
export function assistantSynthesisLanguageAdmitted(language: AssistantLanguage, negotiatedMain: boolean): boolean {
  return !negotiatedMain || language === 'en';
}
const copy = {
  en: {
    amountGap: 'The requested amount could not be verified from the retrieved published passages. Ask an administrator for the approved facility policy; do not promise an unauthorized amount.',
    sourceLanguage: 'Quotations retain the language of the published source.',
    verified: 'Verified results are shown below. Review the filters and coverage limitations.',
    clarify: 'Could you clarify what you want to know or do?',
    unsupported: 'This assistant supports published documentation and read-only aggregate inquiries. It cannot execute business changes or look up individual guests.',
    gap: 'I could not verify this point from the retrieved published passages.',
    documentClarify: 'Please name a specific procedure or section. A document-wide summary or comparison requires broader reviewed coverage.',
    context: 'Required section context could not be verified. Ask an administrator to review the structure and reprocess the source.',
    reprocess: 'This published version needs reprocessing. Ask an administrator to upload a replacement, review its section context, and publish it.',
    documentUnavailable: 'I could not prepare a verified document answer.',
    modelOutput: 'The answer service returned an incomplete or invalid response. Please retry.',
    modelTimeout: 'The answer service took too long to prepare the answer. Please retry.',
    conflict: 'Published sources disagree. Ask an administrator to reconcile the rule.',
    incomplete: 'The required evidence exceeds the supported answer budget. A narrower question may help.',
  },
  tl: {
    amountGap: 'Hindi maberipika ang hinihinging halaga mula sa mga nakuhang inilathalang sipi. Humingi sa administrator ng aprubadong patakaran; huwag mangako ng halagang walang pahintulot.',
    sourceLanguage: 'Nananatili sa wika ng inilathalang sanggunian ang mga sipi. Humingi sa administrator ng nasuring salin.',
    verified: 'Nasa ibaba ang beripikadong resulta. Suriin ang mga filter at limitasyon ng saklaw.',
    clarify: 'Maaari mong linawin kung ano ang gusto mong malaman o gawin?',
    unsupported: 'Sinusuportahan ng assistant ang inilathalang dokumentasyon at pagbasa ng pinagsamang datos. Hindi ito maaaring magbago ng operasyon o maghanap ng indibidwal na bisita.',
    gap: 'Hindi ko maberipika ang puntong ito mula sa mga nakuhang inilathalang sipi.',
    documentClarify: 'Tukuyin ang isang pamamaraan o seksyon. Kailangan ng mas malawak na nasuring saklaw para sa buod o paghahambing ng buong dokumento.',
    context: 'Hindi maberipika ang kinakailangang konteksto ng seksyon. Ipasuri sa administrator ang istruktura at iproseso muli ang sanggunian.',
    reprocess: 'Kailangang iproseso muli ang bersyong ito. Hilingin sa administrator na mag-upload ng kapalit, suriin ang konteksto ng mga seksyon, at ilathala ito.',
    documentUnavailable: 'Hindi ako nakapaghanda ng beripikadong sagot mula sa dokumento.',
    modelOutput: 'Hindi kumpleto o hindi wasto ang tugon ng serbisyo ng sagot. Subukan muli.',
    modelTimeout: 'Masyadong matagal ang paghahanda ng sagot ng serbisyo. Subukan muli.',
    conflict: 'Magkasalungat ang mga inilathalang sanggunian. Ipasuri sa administrator ang patakaran.',
    incomplete: 'Lumampas ang kinakailangang ebidensya sa suportadong saklaw ng sagot. Maaaring makatulong ang mas tiyak na tanong.',
  },
  taglish: {
    amountGap: 'Hindi ma-verify ang requested amount mula sa retrieved published passages. Humingi sa administrator ng approved facility policy; huwag mangako ng unauthorized amount.',
    sourceLanguage: 'Nasa original published language ang quotations. Humingi sa administrator ng reviewed translation.',
    verified: 'Nasa ibaba ang verified results. Suriin ang filters at coverage limitations.',
    clarify: 'Pakilinaw kung ano ang gusto mong malaman o gawin.',
    unsupported: 'Published documentation at read-only aggregate inquiries ang supported. Hindi maaaring gumawa ng business changes o maglookup ng individual guests.',
    gap: 'Hindi ko ma-verify ang puntong ito mula sa retrieved published passages.',
    documentClarify: 'Pakispecify ang procedure o section. Kailangan ng broader reviewed coverage para sa document summary o comparison.',
    context: 'Hindi ma-verify ang required section context. Ipareview sa administrator ang structure at iprocess muli ang source.',
    reprocess: 'Kailangan ng reprocessing ang published version. Ipa-upload sa administrator ang replacement, ipareview ang section context, at ipapublish ito.',
    documentUnavailable: 'Hindi ako nakapaghanda ng verified document answer.',
    modelOutput: 'Incomplete o invalid ang response ng answer service. Pakisubukan muli.',
    modelTimeout: 'Masyadong matagal ang answer service sa paghahanda ng answer. Pakisubukan muli.',
    conflict: 'Magkasalungat ang published sources. Ipareconcile sa administrator ang rule.',
    incomplete: 'Lampas sa supported answer budget ang required evidence. Maaaring makatulong ang mas specific na tanong.',
  },
} satisfies Record<AssistantLanguage, Record<string, string>>;
export function assistantCopy(language: AssistantLanguage) { return copy[language]; }
