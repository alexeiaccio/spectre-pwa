/**
 * Constants copied from spectre.app/web `js/spectre/spectre-types.js` /
 * Lyndir's Master Password `mpw-types.c`. Byte-for-byte identical.
 * See .wayfinder/research/T3-spectre-algorithm-port.md Appendix A.
 */

/** Algorithm versions (2012:03=0, 2012:07=1, 2014:09=2, 2015:01=3). */
export type AlgorithmVersion = 0 | 1 | 2 | 3

export const DEFAULT_VERSION: AlgorithmVersion = 3

export type Purpose = 'authentication' | 'identification' | 'recovery'

/** Key scopes — the "com.lyndir.masterpassword" namespace (shared with Master Password). */
export const SCOPES: Record<Purpose, string> = {
  authentication: 'com.lyndir.masterpassword',
  identification: 'com.lyndir.masterpassword.login',
  recovery: 'com.lyndir.masterpassword.answer',
}

/** resultType ids (from spectre-types.js). */
export const RESULT_TYPE = {
  Maximum: 16,
  Long: 17,
  Medium: 18,
  Short: 19,
  Basic: 20,
  PIN: 21,
  Name: 30,
  Phrase: 31,
} as const

export const DEFAULT_RESULT_TYPE = {
  password: RESULT_TYPE.Long,
  login: RESULT_TYPE.Name,
  answer: RESULT_TYPE.Phrase,
} as const

export const DEFAULT_COUNTER = 1
export const MAX_COUNTER = 4294967295

/**
 * Password templates, indexed by resultType. `templates[0]`-style lookup uses
 * siteKey[0] % templates.length, so the array length matters — copy verbatim.
 */
export const TEMPLATES: Record<number, string[]> = {
  [RESULT_TYPE.Maximum]: ['anoxxxxxxxxxxxxxxxxx', 'axxxxxxxxxxxxxxxxxno'],
  [RESULT_TYPE.Long]: [
    'CvcvnoCvcvCvcv',
    'CvcvCvcvnoCvcv',
    'CvcvCvcvCvcvno',
    'CvccnoCvcvCvcv',
    'CvccCvcvnoCvcv',
    'CvccCvcvCvcvno',
    'CvcvnoCvccCvcv',
    'CvcvCvccnoCvcv',
    'CvcvCvccCvcvno',
    'CvcvnoCvcvCvcc',
    'CvcvCvcvnoCvcc',
    'CvcvCvcvCvccno',
    'CvccnoCvccCvcv',
    'CvccCvccnoCvcv',
    'CvccCvccCvcvno',
    'CvcvnoCvccCvcc',
    'CvcvCvccnoCvcc',
    'CvcvCvccCvccno',
    'CvccnoCvcvCvcc',
    'CvccCvcvnoCvcc',
    'CvccCvcvCvccno',
  ],
  [RESULT_TYPE.Medium]: ['CvcnoCvc', 'CvcCvcno'],
  [RESULT_TYPE.Short]: ['Cvcn'],
  [RESULT_TYPE.Basic]: ['aaanaaan', 'aannaaan', 'aaannaaa'],
  [RESULT_TYPE.PIN]: ['nnnn'],
  [RESULT_TYPE.Name]: ['cvccvcvcv'],
  [RESULT_TYPE.Phrase]: ['cvcc cvc cvccvcv cvc', 'cvc cvccvcvcv cvcv', 'cv cvccv cvc cvcvccv'],
}

/** Character classes — copy the code's strings, not the paper's typography. */
export const CHARACTER_CLASSES: Record<string, string> = {
  V: 'AEIOU',
  C: 'BCDFGHJKLMNPQRSTVWXYZ',
  v: 'aeiou',
  c: 'bcdfghjklmnpqrstvwxyz',
  A: 'AEIOUBCDFGHJKLMNPQRSTVWXYZ',
  a: 'AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz',
  n: '0123456789',
  o: "@&%?,=[]_:-+*$#!'^~;()/.",
  x: 'AEIOUaeiouBCDFGHJKLMNPQRSTVWXYZbcdfghjklmnpqrstvwxyz0123456789!@#$%^&*()',
  ' ': ' ',
}